/**
 * Read-only lookups the demo UI needs: who can give, which funds exist, and
 * what each fund currently holds.
 */
import { Router } from 'express';
import { TransactionDirection, UserRole } from '@prisma/client';

import { prisma } from '../db/client.js';

export const churchRouter = Router();

churchRouter.get('/church', async (_req, res, next) => {
  try {
    const church = await prisma.church.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!church) return res.status(404).json({ error: 'no_church_seeded' });

    const [funds, donors] = await Promise.all([
      prisma.fund.findMany({ where: { churchId: church.id }, orderBy: { slug: 'asc' } }),
      prisma.user.findMany({
        where: { churchId: church.id, role: UserRole.DONOR },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, locale: true },
      }),
    ]);

    const sums = await prisma.transaction.groupBy({
      by: ['fundId', 'direction'],
      _sum: { amountCents: true },
      where: { fundId: { in: funds.map((f) => f.id) } },
    });

    const balanceOf = (fundId: string) => {
      const pick = (direction: TransactionDirection) =>
        sums.find((s) => s.fundId === fundId && s.direction === direction)?._sum.amountCents ?? 0;
      return pick(TransactionDirection.IN) - pick(TransactionDirection.OUT);
    };

    res.json({
      church: { id: church.id, name: church.name, currency: church.currency },
      funds: funds.map((f) => ({
        id: f.id,
        slug: f.slug,
        name: f.name,
        description: f.description,
        goalCents: f.goalCents,
        balanceCents: balanceOf(f.id),
      })),
      donors,
    });
  } catch (error) {
    next(error);
  }
});
