/**
 * The ledger behind the treasurer dashboard, and the question box over it.
 *
 * The agent can only reach this data through `LedgerFilter`, which is a fixed
 * set of typed fields. There is no path from a model response to arbitrary
 * SQL — the filter is validated with Zod before it touches Prisma.
 */
import { Router } from 'express';
import { z } from 'zod';
import { FundSlug, Prisma, TransactionDirection, UserRole } from '@prisma/client';

import { prisma } from '../db/client.js';
import { env } from '../config/env.js';
import { requireRole } from '../auth/session.js';
import { RateLimiter } from '../ai/rateLimit.js';
import {
  answerTreasurerQuestion,
  type LedgerFilter,
  type LedgerSummary,
} from '../ai/treasurerAgent.js';

export const ledgerRouter = Router();

const aiLimiter = new RateLimiter(env.AI_RATE_LIMIT_PER_HOUR, 3_600_000);

const filterSchema = z.object({
  fundSlug: z.nativeEnum(FundSlug).optional(),
  direction: z.nativeEnum(TransactionDirection).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  minAmountCents: z.number().int().nonnegative().optional(),
});

/** Turns a validated filter into a Prisma where-clause. The only translation. */
function whereFrom(filter: z.infer<typeof filterSchema>): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = {};
  if (filter.direction) where.direction = filter.direction;
  if (filter.fundSlug) where.fund = { slug: filter.fundSlug };
  if (filter.minAmountCents !== undefined) where.amountCents = { gte: filter.minAmountCents };
  if (filter.from || filter.to) {
    where.occurredAt = {
      ...(filter.from ? { gte: new Date(`${filter.from}T00:00:00.000Z`) } : {}),
      // Inclusive end-of-day: "to: 2026-10-31" must include that Sunday.
      ...(filter.to ? { lte: new Date(`${filter.to}T23:59:59.999Z`) } : {}),
    };
  }
  return where;
}

async function summarize(filter: z.infer<typeof filterSchema>): Promise<LedgerSummary> {
  const where = whereFrom(filter);

  const [rows, byFundRows] = await Promise.all([
    prisma.transaction.findMany({
      where,
      select: { direction: true, amountCents: true, occurredAt: true },
      orderBy: { occurredAt: 'asc' },
    }),
    prisma.transaction.groupBy({
      by: ['fundId'],
      _sum: { amountCents: true },
      where,
    }),
  ]);

  const funds = await prisma.fund.findMany({ select: { id: true, name: true } });
  const fundName = new Map(funds.map((f) => [f.id, f.name]));

  return {
    rowCount: rows.length,
    totalInCents: rows
      .filter((r) => r.direction === TransactionDirection.IN)
      .reduce((s, r) => s + r.amountCents, 0),
    totalOutCents: rows
      .filter((r) => r.direction === TransactionDirection.OUT)
      .reduce((s, r) => s + r.amountCents, 0),
    firstDate: rows[0]?.occurredAt.toISOString().slice(0, 10) ?? null,
    lastDate: rows.at(-1)?.occurredAt.toISOString().slice(0, 10) ?? null,
    byFund: byFundRows.map((r) => ({
      fund: fundName.get(r.fundId) ?? r.fundId,
      totalCents: r._sum.amountCents ?? 0,
    })),
  };
}

/** Every ledger row, for the grid. */
ledgerRouter.get(
  '/ledger',
  requireRole(UserRole.TREASURER, UserRole.PASTOR),
  async (_req, res, next) => {
    try {
      const rows = await prisma.transaction.findMany({
        orderBy: { occurredAt: 'desc' },
        take: 1000,
        include: {
          fund: { select: { name: true, slug: true } },
          gift: { select: { donor: { select: { name: true } } } },
          distributionItem: { select: { recipient: { select: { name: true } } } },
        },
      });

      res.json({
        rows: rows.map((t) => ({
          id: t.id,
          date: t.occurredAt.toISOString().slice(0, 10),
          fund: t.fund.name,
          fundSlug: t.fund.slug,
          direction: t.direction,
          // One column the treasurer actually reads: who it came from or went to.
          party:
            t.gift?.donor.name ?? t.distributionItem?.recipient.name ?? '—',
          amount: t.amountCents / 100,
          fee: t.feeCents === null ? null : t.feeCents / 100,
          net: t.netCents === null ? null : t.netCents / 100,
          source: t.source,
          reference: t.paypalRef,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

const askSchema = z.object({ question: z.string().min(2).max(500) });

ledgerRouter.post(
  '/ledger/ask',
  requireRole(UserRole.TREASURER, UserRole.PASTOR),
  async (req, res, next) => {
    try {
      const parsed = askSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
      }

      const limit = aiLimiter.check(req.user!.id);
      if (!limit.allowed) {
        res.setHeader('Retry-After', String(limit.retryAfterSeconds));
        return res.status(429).json({ error: 'rate_limited', ...limit });
      }

      const result = await answerTreasurerQuestion({
        question: parsed.data.question,
        today: new Date().toISOString().slice(0, 10),
        runQuery: async (filter: LedgerFilter) => {
          // Validate again: what the model produced is input, not truth.
          const safe = filterSchema.safeParse(filter);
          return summarize(safe.success ? safe.data : {});
        },
      });

      await prisma.auditLog.create({
        data: {
          actor: req.user!.email,
          action: 'ai.ledger_question',
          entity: 'Church',
          entityId: req.user!.churchId,
          payload: { question: parsed.data.question, filter: result.filter as Prisma.InputJsonValue },
        },
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);
