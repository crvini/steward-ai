/**
 * Impact updates: the loop closes here.
 *
 *   POST /api/impact/:distributionId/draft   write a note per donor (treasurer)
 *   GET  /api/impact/review                  the treasurer's review queue
 *   POST /api/impact/:id/approve             approve one note
 *   GET  /api/impact/mine                    what the donor sees
 *
 * Nothing reaches a donor without a person approving it. The AI writes; the
 * treasurer decides whether it is true enough to send.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  DistributionItemStatus,
  DistributionStatus,
  ImpactUpdateStatus,
  TransactionDirection,
  UserRole,
} from '@prisma/client';

import { prisma } from '../db/client.js';
import { env } from '../config/env.js';
import { requireRole } from '../auth/session.js';
import { draftImpactNote } from '../ai/impactWriter.js';
import { RateLimiter } from '../ai/rateLimit.js';

export const impactRouter = Router();

const limiter = new RateLimiter(env.AI_RATE_LIMIT_PER_HOUR, 3_600_000);

impactRouter.post(
  '/impact/:distributionId/draft',
  requireRole(UserRole.TREASURER),
  async (req, res, next) => {
    try {
      const distributionId = String(req.params.distributionId ?? '');

      const limit = limiter.check(req.user!.id);
      if (!limit.allowed) {
        res.setHeader('Retry-After', String(limit.retryAfterSeconds));
        return res.status(429).json({ error: 'rate_limited', ...limit });
      }

      const distribution = await prisma.distribution.findUnique({
        where: { id: distributionId },
        include: { fund: true, items: { include: { recipient: true } } },
      });
      if (!distribution) return res.status(404).json({ error: 'distribution_not_found' });
      if (distribution.status !== DistributionStatus.EXECUTED) {
        // Telling donors what their gift did before it did it would be a lie.
        return res.status(409).json({ error: 'not_executed_yet', status: distribution.status });
      }

      const paid = distribution.items.filter(
        (i) => i.status !== DistributionItemStatus.FAILED && i.status !== DistributionItemStatus.BLOCKED_BY_RULE,
      );
      const distributedCents = paid.reduce((s, i) => s + i.amountCents, 0);

      // Everyone who gave to this fund, with what they gave.
      const givers = await prisma.transaction.groupBy({
        by: ['giftId'],
        _sum: { amountCents: true },
        where: {
          fundId: distribution.fundId,
          direction: TransactionDirection.IN,
          giftId: { not: null },
        },
      });

      const gifts = await prisma.gift.findMany({
        where: { id: { in: givers.map((g) => g.giftId!).filter(Boolean) } },
        include: { donor: true },
      });

      const perDonor = new Map<string, { name: string; locale: string; cents: number }>();
      for (const row of givers) {
        const gift = gifts.find((g) => g.id === row.giftId);
        if (!gift) continue;
        const current = perDonor.get(gift.donorId);
        perDonor.set(gift.donorId, {
          name: gift.donor.name,
          locale: gift.donor.locale,
          cents: (current?.cents ?? 0) + (row._sum.amountCents ?? 0),
        });
      }

      const created: string[] = [];
      for (const [donorId, donor] of perDonor) {
        const existing = await prisma.impactUpdate.findUnique({
          where: { donorId_distributionId: { donorId, distributionId } },
        });
        if (existing) continue;

        const body = await draftImpactNote({
          donorName: donor.name,
          donorLocale: donor.locale,
          fundName: distribution.fund.name,
          donorGaveCents: donor.cents,
          distributedCents,
          recipients: paid.map((i) => ({ name: i.recipient.name, amountCents: i.amountCents })),
        });

        await prisma.impactUpdate.create({
          data: { donorId, distributionId, locale: donor.locale, body },
        });
        created.push(donorId);
      }

      await prisma.auditLog.create({
        data: {
          actor: req.user!.email,
          action: 'ai.impact_drafted',
          entity: 'Distribution',
          entityId: distributionId,
          payload: { notes: created.length, model: env.ANTHROPIC_MODEL_FAST },
        },
      });

      res.status(201).json({ drafted: created.length });
    } catch (error) {
      next(error);
    }
  },
);

impactRouter.get('/impact/review', requireRole(UserRole.TREASURER), async (_req, res, next) => {
  try {
    const rows = await prisma.impactUpdate.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        donor: { select: { name: true } },
        distribution: { include: { fund: { select: { name: true } } } },
      },
    });

    res.json({
      updates: rows.map((u) => ({
        id: u.id,
        donor: u.donor.name,
        fund: u.distribution.fund.name,
        locale: u.locale,
        body: u.body,
        status: u.status,
        createdAt: u.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});

const editSchema = z.object({ body: z.string().min(1).max(2000).optional() });

impactRouter.post('/impact/:id/approve', requireRole(UserRole.TREASURER), async (req, res, next) => {
  try {
    const parsed = editSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
    }

    const id = String(req.params.id ?? '');
    const update = await prisma.impactUpdate.findUnique({ where: { id } });
    if (!update) return res.status(404).json({ error: 'impact_update_not_found' });

    const approved = await prisma.impactUpdate.update({
      where: { id },
      data: {
        // The treasurer may rewrite before approving; their words win.
        body: parsed.data.body ?? update.body,
        status: ImpactUpdateStatus.SENT,
        approvedAt: new Date(),
        sentAt: new Date(),
      },
    });

    await prisma.auditLog.create({
      data: {
        actor: req.user!.email,
        action: 'impact.approved',
        entity: 'ImpactUpdate',
        entityId: id,
        payload: { edited: parsed.data.body !== undefined },
      },
    });

    res.json({ id: approved.id, status: approved.status });
  } catch (error) {
    next(error);
  }
});

/** What the donor sees. Only approved notes. */
impactRouter.get('/impact/mine', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'not_signed_in' });

    const rows = await prisma.impactUpdate.findMany({
      where: { donorId: req.user.id, status: ImpactUpdateStatus.SENT },
      orderBy: { sentAt: 'desc' },
      include: { distribution: { include: { fund: { select: { name: true } } } } },
    });

    res.json({
      updates: rows.map((u) => ({
        id: u.id,
        fund: u.distribution.fund.name,
        body: u.body,
        sentAt: u.sentAt?.toISOString() ?? u.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});
