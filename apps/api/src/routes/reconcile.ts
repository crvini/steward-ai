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

    // The other direction: rows the book claims that PayPal cannot confirm.
    // A null reference means no capture ever arrived — recorded by hand, or
    // a capture that was lost. It is the difference a treasurer must chase.
    const unconfirmedRows = await prisma.transaction.findMany({
      where: {
        direction: TransactionDirection.IN,
        paypalRef: null,
        occurredAt: { gte: start, lte: end },
      },
      include: {
        fund: { select: { name: true } },
        gift: { select: { donor: { select: { name: true } } } },
      },
      orderBy: { occurredAt: 'desc' },
    });

    const unconfirmedLocally = unconfirmedRows.map((t) => ({
      id: t.id,
      date: t.occurredAt.toISOString().slice(0, 10),
      fund: t.fund.name,
      party: t.gift?.donor.name ?? '—',
      amountCents: t.amountCents,
      description: t.description,
    }));

    res.json({
      window: { start: start.toISOString(), end: end.toISOString(), days: parsed.data.days },
      paypalCount: remote.length,
      localCount: local.length,
      missingLocally,
      unconfirmedLocally,
      differences: missingLocally.length + unconfirmedLocally.length,
      inSync: missingLocally.length === 0 && unconfirmedLocally.length === 0,
    });
  } catch (error) {
    next(error);
  }
});
