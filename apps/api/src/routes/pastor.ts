/**
 * The pastor's screen: what happened, what needs their key, and the rules
 * they set.
 *
 *   GET  /api/stats          the month so far, from the ledger
 *   GET  /api/brief          this week's brief, if one has been written
 *   POST /api/brief          write (or rewrite) it
 */
import { Router } from 'express';
import { GiftFrequency, GiftStatus, Prisma, TransactionDirection, UserRole } from '@prisma/client';

import { prisma } from '../db/client.js';
import { env } from '../config/env.js';
import { requireRole } from '../auth/session.js';
import { RateLimiter } from '../ai/rateLimit.js';
import { writeWeeklyBrief } from '../ai/weeklyBrief.js';
import { checkDistribution } from '../rules/distribution.js';

export const pastorRouter = Router();

const limiter = new RateLimiter(env.AI_RATE_LIMIT_PER_HOUR, 3_600_000);

/** Monday 00:00 UTC of the week a date falls in. */
function mondayOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay: 0 is Sunday, so Sunday belongs to the week that started six days back.
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d;
}

async function monthStats(churchId: string) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [funds, inMonth, allTimeBefore, monthly] = await Promise.all([
    prisma.fund.findMany({ where: { churchId }, orderBy: { slug: 'asc' } }),
    prisma.transaction.findMany({
      where: { direction: TransactionDirection.IN, occurredAt: { gte: monthStart } },
      include: { gift: { select: { donorId: true } } },
    }),
    prisma.gift.findMany({
      where: { completedAt: { lt: monthStart } },
      select: { donorId: true },
      distinct: ['donorId'],
    }),
    prisma.gift.findMany({
      where: { frequency: GiftFrequency.MONTHLY, status: { in: [GiftStatus.ACTIVE, GiftStatus.COMPLETED] } },
      select: { amountCents: true },
    }),
  ]);

  const giversThisMonth = new Set(
    inMonth.map((t) => t.gift?.donorId).filter((id): id is string => Boolean(id)),
  );
  const gaveBefore = new Set(allTimeBefore.map((g) => g.donorId));

  const balances = await prisma.transaction.groupBy({
    by: ['fundId', 'direction'],
    _sum: { amountCents: true },
  });
  const balanceOf = (fundId: string) => {
    const pick = (d: TransactionDirection) =>
      balances.find((b) => b.fundId === fundId && b.direction === d)?._sum.amountCents ?? 0;
    return pick(TransactionDirection.IN) - pick(TransactionDirection.OUT);
  };

  const unconfirmed = await prisma.transaction.findMany({
    where: { direction: TransactionDirection.IN, paypalRef: null },
    select: { amountCents: true },
  });

  return {
    receivedCents: inMonth.reduce((s, t) => s + t.amountCents, 0),
    giftCount: inMonth.length,
    givers: giversThisMonth.size,
    newGivers: [...giversThisMonth].filter((id) => !gaveBefore.has(id)).length,
    monthlyGifts: monthly.length,
    recurringMonthlyCents: monthly.reduce((s, g) => s + g.amountCents, 0),
    funds: funds.map((f) => ({
      id: f.id,
      slug: f.slug,
      name: f.name,
      goalCents: f.goalCents,
      balanceCents: balanceOf(f.id),
    })),
    unconfirmed: {
      count: unconfirmed.length,
      cents: unconfirmed.reduce((s, t) => s + t.amountCents, 0),
    },
    limits: {
      maxPerItemCents: Math.round(env.MAX_PAYOUT_ITEM_USD * 100),
      maxPerBatchCents: Math.round(env.MAX_PAYOUT_BATCH_USD * 100),
    },
  };
}

pastorRouter.get(
  '/stats',
  requireRole(UserRole.TREASURER, UserRole.PASTOR),
  async (req, res, next) => {
    try {
      const [stats, recipients] = await Promise.all([
        monthStats(req.user!.churchId),
        prisma.recipient.count({ where: { churchId: req.user!.churchId, active: true } }),
      ]);
      res.json({ ...stats, approvedRecipients: recipients });
    } catch (error) {
      next(error);
    }
  },
);

pastorRouter.get(
  '/brief',
  requireRole(UserRole.TREASURER, UserRole.PASTOR),
  async (req, res, next) => {
    try {
      const weekOf = mondayOf(new Date());
      const brief = await prisma.weeklyBrief.findUnique({
        where: { churchId_weekOf: { churchId: req.user!.churchId, weekOf } },
      });
      res.json({
        brief: brief
          ? { body: brief.body, weekOf: brief.weekOf.toISOString(), writtenAt: brief.createdAt.toISOString() }
          : null,
      });
    } catch (error) {
      next(error);
    }
  },
);

pastorRouter.post(
  '/brief',
  requireRole(UserRole.TREASURER, UserRole.PASTOR),
  async (req, res, next) => {
    try {
      const limit = limiter.check(req.user!.id);
      if (!limit.allowed) {
        res.setHeader('Retry-After', String(limit.retryAfterSeconds));
        return res.status(429).json({ error: 'rate_limited', ...limit });
      }

      const churchId = req.user!.churchId;
      const church = await prisma.church.findUnique({ where: { id: churchId } });
      if (!church) return res.status(404).json({ error: 'church_not_found' });

      const weekOf = mondayOf(new Date());
      const stats = await monthStats(churchId);

      const weekGifts = await prisma.transaction.findMany({
        where: { direction: TransactionDirection.IN, occurredAt: { gte: weekOf } },
        include: { fund: { select: { name: true } }, gift: { select: { donorId: true, frequency: true } } },
      });

      const byFund = new Map<string, number>();
      for (const t of weekGifts) {
        byFund.set(t.fund.name, (byFund.get(t.fund.name) ?? 0) + t.amountCents);
      }
      const topFund = [...byFund.entries()].sort((a, b) => b[1] - a[1])[0];

      const awaiting = await prisma.distribution.findMany({
        where: { status: 'TREASURER_APPROVED' },
        include: { fund: { select: { id: true, name: true } }, items: true },
      });

      // What would actually be sent, not what was proposed: a brief that says
      // $700 while the pastor's screen shows $400 teaches them not to trust it.
      const awaitingPayable = await Promise.all(
        awaiting.map(async (d) => {
          const recipients = await prisma.recipient.findMany({ where: { fundId: d.fundId } });
          const verdict = checkDistribution({
            fundId: d.fundId,
            fundBalanceCents: stats.funds.find((f) => f.id === d.fundId)?.balanceCents ?? 0,
            recipients: recipients.map((r) => ({
              id: r.id,
              name: r.name,
              fundId: r.fundId,
              active: r.active,
              maxPerPayoutCents: r.maxPerPayoutCents,
              paypalEmail: r.paypalEmail,
            })),
            lines: d.items.map((i) => ({ recipientId: i.recipientId, amountCents: i.amountCents })),
            limits: {
              maxPerItemCents: stats.limits.maxPerItemCents,
              maxPerBatchCents: stats.limits.maxPerBatchCents,
            },
          });
          return { fund: d.fund.name, totalCents: verdict.payableCents };
        }),
      );

      const facts = {
        churchName: church.name,
        weekLabel: weekOf.toISOString().slice(0, 10),
        receivedCents: weekGifts.reduce((s, t) => s + t.amountCents, 0),
        giftCount: weekGifts.length,
        newGivers: stats.newGivers,
        monthlyStarted: weekGifts.filter((t) => t.gift?.frequency === GiftFrequency.MONTHLY).length,
        topFund: topFund ? { name: topFund[0], cents: topFund[1] } : null,
        awaitingPastor: awaitingPayable,
        unconfirmed: stats.unconfirmed,
        locale: req.user!.locale,
      };

      const body = await writeWeeklyBrief(facts);

      const saved = await prisma.weeklyBrief.upsert({
        where: { churchId_weekOf: { churchId, weekOf } },
        create: { churchId, weekOf, body, facts: facts as unknown as Prisma.InputJsonValue },
        update: { body, facts: facts as unknown as Prisma.InputJsonValue },
      });

      await prisma.auditLog.create({
        data: {
          actor: req.user!.email,
          action: 'ai.brief_written',
          entity: 'Church',
          entityId: churchId,
          payload: { weekOf: weekOf.toISOString(), model: env.ANTHROPIC_MODEL_FAST },
        },
      });

      res.status(201).json({
        brief: { body: saved.body, weekOf: saved.weekOf.toISOString(), writtenAt: saved.createdAt.toISOString() },
      });
    } catch (error) {
      next(error);
    }
  },
);
