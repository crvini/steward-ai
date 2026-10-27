/**
 * GET /api/paypal/reconcile?days=31
 *
 * Side-by-side of PayPal's own record and our ledger. Anything PayPal knows
 * about that we never wrote down shows up in `missingLocally` — that is the
 * number a treasurer actually cares about.
 */
import { Router } from 'express';
import { z } from 'zod';
import { TransactionDirection } from '@prisma/client';

import { prisma } from '../db/client.js';
import { searchTransactions, TRANSACTION_SEARCH_MAX_DAYS } from '../paypal/reconcile.js';

export const reconcileRouter = Router();

const querySchema = z.object({
  days: z.coerce.number().int().positive().max(TRANSACTION_SEARCH_MAX_DAYS).default(30),
});

reconcileRouter.get('/paypal/reconcile', async (req, res, next) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
    }

    const end = new Date();
    const start = new Date(end.getTime() - parsed.data.days * 86_400_000);

    const [remote, local] = await Promise.all([
      searchTransactions(start, end),
      prisma.transaction.findMany({
        where: { direction: TransactionDirection.IN, occurredAt: { gte: start, lte: end } },
        select: { paypalRef: true, amountCents: true, occurredAt: true },
      }),
    ]);

    const localRefs = new Set(local.map((t) => t.paypalRef).filter(Boolean));
    const missingLocally = remote.filter((t) => !localRefs.has(t.transactionId));

    res.json({
      window: { start: start.toISOString(), end: end.toISOString(), days: parsed.data.days },
      paypalCount: remote.length,
      localCount: local.length,
      missingLocally,
      inSync: missingLocally.length === 0,
    });
  } catch (error) {
    next(error);
  }
});
