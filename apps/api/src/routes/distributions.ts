/**
 * Distributions: propose → check → treasurer approves → pastor approves → pay.
 *
 * The two-key rule is enforced here, in code, with the database as the record
 * of who signed what. The AI appears only in `propose`, and its output is
 * never trusted: every line is re-checked by the rules engine on proposal and
 * again at execution, because approvals and balances can change in between.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  DistributionItemStatus,
  DistributionStatus,
  Prisma,
  TransactionDirection,
  TransactionSource,
  UserRole,
} from '@prisma/client';

import { prisma } from '../db/client.js';
import { env } from '../config/env.js';
import { requireRole } from '../auth/session.js';
import { checkDistribution, type RecipientFacts } from '../rules/distribution.js';
import { proposeDistribution } from '../ai/distributionAgent.js';
import { sendPayoutBatch } from '../paypal/payouts.js';
import { RateLimiter } from '../ai/rateLimit.js';

export const distributionsRouter = Router();

const aiLimiter = new RateLimiter(env.AI_RATE_LIMIT_PER_HOUR, 3_600_000);

/**
 * Express widens `req.params` once a route carries middleware, so `:id` stops
 * being a plain string. This narrows it back without a cast that could hide a
 * genuinely missing parameter.
 */
function pathId(req: Request): string {
  const value = req.params.id;
  return typeof value === 'string' ? value : '';
}

const LIMITS = {
  maxPerItemCents: Math.round(env.MAX_PAYOUT_ITEM_USD * 100),
  maxPerBatchCents: Math.round(env.MAX_PAYOUT_BATCH_USD * 100),
};

async function fundBalanceCents(fundId: string): Promise<number> {
  const sums = await prisma.transaction.groupBy({
    by: ['direction'],
    _sum: { amountCents: true },
    where: { fundId },
  });
  const total = (d: TransactionDirection) =>
    sums.find((s) => s.direction === d)?._sum.amountCents ?? 0;
  return total(TransactionDirection.IN) - total(TransactionDirection.OUT);
}

async function recipientFacts(fundId: string): Promise<RecipientFacts[]> {
  const rows = await prisma.recipient.findMany({ where: { fundId } });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    fundId: r.fundId,
    active: r.active,
    maxPerPayoutCents: r.maxPerPayoutCents,
    paypalEmail: r.paypalEmail,
  }));
}

/** Re-runs the rules against current data. Never trust a stored verdict. */
async function verdictFor(distributionId: string) {
  const distribution = await prisma.distribution.findUnique({
    where: { id: distributionId },
    include: { items: true, fund: true },
  });
  if (!distribution) return null;

  const [balance, recipients] = await Promise.all([
    fundBalanceCents(distribution.fundId),
    recipientFacts(distribution.fundId),
  ]);

  const verdict = checkDistribution({
    fundId: distribution.fundId,
    fundBalanceCents: balance,
    recipients,
    lines: distribution.items.map((i) => ({
      recipientId: i.recipientId,
      amountCents: i.amountCents,
    })),
    limits: LIMITS,
  });

  return { distribution, verdict, balance };
}

// ── Propose (treasurer) ─────────────────────────────────────────────────────

const proposeSchema = z.object({ fundId: z.string().min(1) });

distributionsRouter.post(
  '/distributions/propose',
  requireRole(UserRole.TREASURER),
  async (req, res, next) => {
    try {
      const parsed = proposeSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
      }

      const limit = aiLimiter.check(req.user!.id);
      if (!limit.allowed) {
        res.setHeader('Retry-After', String(limit.retryAfterSeconds));
        return res.status(429).json({ error: 'rate_limited', ...limit });
      }

      const fund = await prisma.fund.findUnique({ where: { id: parsed.data.fundId } });
      if (!fund) return res.status(404).json({ error: 'fund_not_found' });

      const [balance, recipients] = await Promise.all([
        fundBalanceCents(fund.id),
        prisma.recipient.findMany({ where: { fundId: fund.id, active: true } }),
      ]);

      // What each recipient got last time, so support stays steady.
      const briefs = await Promise.all(
        recipients.map(async (r) => {
          const last = await prisma.distributionItem.findFirst({
            where: { recipientId: r.id, status: DistributionItemStatus.SUCCEEDED },
            orderBy: { createdAt: 'desc' },
          });
          return {
            id: r.id,
            name: r.name,
            maxPerPayoutCents: r.maxPerPayoutCents,
            note: r.note,
            lastPaidCents: last?.amountCents ?? null,
            lastPaidAt: last?.createdAt.toISOString().slice(0, 10) ?? null,
          };
        }),
      );

      const plan = await proposeDistribution({
        fundName: fund.name,
        fundBalanceCents: balance,
        recipients: briefs,
        limits: LIMITS,
      });

      const distribution = await prisma.distribution.create({
        data: {
          fundId: fund.id,
          status: DistributionStatus.PROPOSED,
          aiRationale: plan.rationale,
          items: {
            create: plan.lines.map((line) => ({
              recipientId: line.recipientId,
              amountCents: line.amountCents,
            })),
          },
        },
      });

      await prisma.auditLog.create({
        data: {
          actor: req.user!.email,
          action: 'distribution.proposed_by_ai',
          entity: 'Distribution',
          entityId: distribution.id,
          payload: {
            fundId: fund.id,
            lines: plan.lines.length,
            model: env.ANTHROPIC_MODEL_MAIN,
          },
        },
      });

      const result = await verdictFor(distribution.id);
      res.status(201).json({ id: distribution.id, rationale: plan.rationale, ...result });
    } catch (error) {
      next(error);
    }
  },
);

// ── Read ────────────────────────────────────────────────────────────────────

distributionsRouter.get(
  '/distributions',
  requireRole(UserRole.TREASURER, UserRole.PASTOR),
  async (_req, res, next) => {
    try {
      const rows = await prisma.distribution.findMany({
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: {
          fund: { select: { name: true, slug: true } },
          items: { include: { recipient: { select: { name: true } } } },
        },
      });

      res.json({
        distributions: rows.map((d) => ({
          id: d.id,
          fund: d.fund.name,
          status: d.status,
          aiRationale: d.aiRationale,
          treasurerApprovedBy: d.treasurerApprovedBy,
          pastorApprovedBy: d.pastorApprovedBy,
          totalCents: d.items.reduce((s, i) => s + i.amountCents, 0),
          items: d.items.map((i) => ({
            id: i.id,
            recipient: i.recipient.name,
            amountCents: i.amountCents,
            status: i.status,
            blockedReason: i.blockedReason,
          })),
          createdAt: d.createdAt.toISOString(),
          executedAt: d.executedAt?.toISOString() ?? null,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

distributionsRouter.get(
  '/distributions/:id',
  requireRole(UserRole.TREASURER, UserRole.PASTOR),
  async (req, res, next) => {
    try {
      const result = await verdictFor(pathId(req));
      if (!result) return res.status(404).json({ error: 'distribution_not_found' });

      const { distribution, verdict, balance } = result;
      res.json({
        id: distribution.id,
        fund: distribution.fund.name,
        fundBalanceCents: balance,
        status: distribution.status,
        aiRationale: distribution.aiRationale,
        treasurerApprovedBy: distribution.treasurerApprovedBy,
        pastorApprovedBy: distribution.pastorApprovedBy,
        paypalBatchId: distribution.paypalBatchId,
        verdict,
      });
    } catch (error) {
      next(error);
    }
  },
);

// ── Adjust (treasurer, before approving) ────────────────────────────────────

const adjustSchema = z.object({
  lines: z
    .array(
      z.object({
        recipientId: z.string().min(1),
        amountCents: z.number().int().nonnegative(),
      }),
    )
    .max(50),
});

distributionsRouter.put(
  '/distributions/:id/lines',
  requireRole(UserRole.TREASURER),
  async (req, res, next) => {
    try {
      const parsed = adjustSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
      }

      const distribution = await prisma.distribution.findUnique({ where: { id: pathId(req) } });
      if (!distribution) return res.status(404).json({ error: 'distribution_not_found' });
      if (distribution.status !== DistributionStatus.PROPOSED) {
        // Editing after an approval would make that signature meaningless.
        return res.status(409).json({ error: 'already_approved', status: distribution.status });
      }

      await prisma.$transaction([
        prisma.distributionItem.deleteMany({ where: { distributionId: distribution.id } }),
        prisma.distributionItem.createMany({
          data: parsed.data.lines
            .filter((l) => l.amountCents > 0)
            .map((l) => ({
              distributionId: distribution.id,
              recipientId: l.recipientId,
              amountCents: l.amountCents,
            })),
        }),
        prisma.auditLog.create({
          data: {
            actor: req.user!.email,
            action: 'distribution.adjusted',
            entity: 'Distribution',
            entityId: distribution.id,
            payload: { lines: parsed.data.lines.length },
          },
        }),
      ]);

      res.json(await verdictFor(distribution.id));
    } catch (error) {
      next(error);
    }
  },
);

// ── Approve ─────────────────────────────────────────────────────────────────

distributionsRouter.post(
  '/distributions/:id/approve',
  requireRole(UserRole.TREASURER, UserRole.PASTOR),
  async (req, res, next) => {
    try {
      const result = await verdictFor(pathId(req));
      if (!result) return res.status(404).json({ error: 'distribution_not_found' });

      const { distribution, verdict } = result;
      const user = req.user!;

      // State first, rules second. An executed distribution has already moved
      // the money, so the rules would now refuse it for "insufficient
      // balance" — true but misleading. The honest answer is that it is done.
      const terminal: DistributionStatus[] = [
        DistributionStatus.EXECUTED,
        DistributionStatus.FAILED,
      ];
      if (terminal.includes(distribution.status)) {
        return res.status(409).json({ error: 'wrong_state', status: distribution.status });
      }

      // Nobody signs something the rules refuse, not even the pastor.
      if (!verdict.executable) {
        return res.status(422).json({ error: 'rules_not_satisfied', verdict });
      }

      if (user.role === UserRole.TREASURER) {
        if (distribution.status !== DistributionStatus.PROPOSED) {
          return res.status(409).json({ error: 'wrong_state', status: distribution.status });
        }
        const updated = await prisma.distribution.update({
          where: { id: distribution.id },
          data: {
            status: DistributionStatus.TREASURER_APPROVED,
            treasurerApprovedBy: user.email,
            treasurerApprovedAt: new Date(),
          },
        });
        await prisma.auditLog.create({
          data: {
            actor: user.email,
            action: 'distribution.treasurer_approved',
            entity: 'Distribution',
            entityId: distribution.id,
            payload: { totalCents: verdict.payableCents },
          },
        });
        return res.json({ id: updated.id, status: updated.status });
      }

      // Pastor: the second key.
      if (distribution.status !== DistributionStatus.TREASURER_APPROVED) {
        return res.status(409).json({
          error: 'needs_treasurer_first',
          status: distribution.status,
        });
      }
      // The same person cannot hold both keys.
      if (distribution.treasurerApprovedBy === user.email) {
        return res.status(409).json({ error: 'same_person_cannot_hold_both_keys' });
      }

      const updated = await prisma.distribution.update({
        where: { id: distribution.id },
        data: {
          status: DistributionStatus.APPROVED,
          pastorApprovedBy: user.email,
          pastorApprovedAt: new Date(),
        },
      });
      await prisma.auditLog.create({
        data: {
          actor: user.email,
          action: 'distribution.pastor_approved',
          entity: 'Distribution',
          entityId: distribution.id,
          payload: { totalCents: verdict.payableCents },
        },
      });
      res.json({ id: updated.id, status: updated.status });
    } catch (error) {
      next(error);
    }
  },
);

const rejectSchema = z.object({ note: z.string().min(1).max(500) });

distributionsRouter.post(
  '/distributions/:id/reject',
  requireRole(UserRole.TREASURER, UserRole.PASTOR),
  async (req, res, next) => {
    try {
      const parsed = rejectSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
      }

      const distribution = await prisma.distribution.findUnique({ where: { id: pathId(req) } });
      if (!distribution) return res.status(404).json({ error: 'distribution_not_found' });
      if (distribution.status === DistributionStatus.EXECUTED) {
        return res.status(409).json({ error: 'already_executed' });
      }

      const updated = await prisma.distribution.update({
        where: { id: distribution.id },
        data: { status: DistributionStatus.FAILED },
      });
      await prisma.auditLog.create({
        data: {
          actor: req.user!.email,
          action: 'distribution.rejected',
          entity: 'Distribution',
          entityId: distribution.id,
          payload: { note: parsed.data.note, role: req.user!.role },
        },
      });

      res.json({ id: updated.id, status: updated.status });
    } catch (error) {
      next(error);
    }
  },
);

// ── Execute ─────────────────────────────────────────────────────────────────

/**
 * The only path to Payouts in the whole codebase.
 *
 * Requires both approvals and a passing rules check at this moment, not at
 * approval time: balances move, and a distribution approved yesterday may be
 * unpayable today.
 */
distributionsRouter.post(
  '/distributions/:id/execute',
  requireRole(UserRole.TREASURER, UserRole.PASTOR),
  async (req, res, next) => {
    try {
      const result = await verdictFor(pathId(req));
      if (!result) return res.status(404).json({ error: 'distribution_not_found' });

      const { distribution, verdict } = result;

      if (distribution.status === DistributionStatus.EXECUTED) {
        return res.json({
          id: distribution.id,
          status: distribution.status,
          paypalBatchId: distribution.paypalBatchId,
          alreadyExecuted: true,
        });
      }
      if (distribution.status !== DistributionStatus.APPROVED) {
        return res.status(409).json({ error: 'needs_two_approvals', status: distribution.status });
      }
      if (!distribution.treasurerApprovedBy || !distribution.pastorApprovedBy) {
        return res.status(409).json({ error: 'missing_an_approval' });
      }
      if (!verdict.executable) {
        return res.status(422).json({ error: 'rules_not_satisfied', verdict });
      }

      // Stable per distribution: a retried execute cannot pay twice.
      const senderBatchId = distribution.senderBatchId ?? `steward-${distribution.id}`;
      await prisma.distribution.update({
        where: { id: distribution.id },
        data: { senderBatchId },
      });

      const items = await prisma.distributionItem.findMany({
        where: { distributionId: distribution.id },
        include: { recipient: true },
      });

      const batch = await sendPayoutBatch({
        senderBatchId,
        emailSubject: `${distribution.fund.name} — from your church`,
        items: items.map((i) => ({
          recipientEmail: i.recipient.paypalEmail,
          amountCents: i.amountCents,
          currency: i.currency,
          senderItemId: i.id,
          note: `${distribution.fund.name} distribution`,
        })),
      });

      const executedAt = new Date();
      await prisma.$transaction([
        prisma.distribution.update({
          where: { id: distribution.id },
          data: {
            status: DistributionStatus.EXECUTED,
            paypalBatchId: batch.batch_header.payout_batch_id,
            executedAt,
          },
        }),
        prisma.distributionItem.updateMany({
          where: { distributionId: distribution.id },
          data: { status: DistributionItemStatus.SENT },
        }),
        // The ledger moves now; the item webhooks confirm each one later.
        prisma.transaction.createMany({
          data: items.map((i) => ({
            fundId: distribution.fundId,
            distributionItemId: i.id,
            direction: TransactionDirection.OUT,
            amountCents: i.amountCents,
            currency: i.currency,
            paypalRef: `${batch.batch_header.payout_batch_id}:${i.id}`,
            source: TransactionSource.PAYOUT,
            description: `Payout to ${i.recipient.name}`,
            occurredAt: executedAt,
          })),
          skipDuplicates: true,
        }),
        prisma.auditLog.create({
          data: {
            actor: req.user!.email,
            action: 'distribution.executed',
            entity: 'Distribution',
            entityId: distribution.id,
            payload: {
              paypalBatchId: batch.batch_header.payout_batch_id,
              totalCents: verdict.payableCents,
              treasurer: distribution.treasurerApprovedBy,
              pastor: distribution.pastorApprovedBy,
            } as Prisma.InputJsonValue,
          },
        }),
      ]);

      res.json({
        id: distribution.id,
        status: DistributionStatus.EXECUTED,
        paypalBatchId: batch.batch_header.payout_batch_id,
        batchStatus: batch.batch_header.batch_status,
      });
    } catch (error) {
      next(error);
    }
  },
);
