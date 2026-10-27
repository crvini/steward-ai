/**
 * GET /api/activity — the AI activity log.
 *
 * Every proposal the AI made, every rule verdict, every signature and every
 * payout, in order. This exists so the guardrail is something a person can
 * read rather than something the README claims: you can see that a proposal
 * was made by a model, that two different people signed it, and when the
 * money actually left.
 */
import { Router } from 'express';
import { UserRole } from '@prisma/client';

import { prisma } from '../db/client.js';
import { requireRole } from '../auth/session.js';

export const activityRouter = Router();

/** Actions worth showing, in the order a reader would expect them. */
const INTERESTING = [
  'ai.gift_proposed',
  'ai.ledger_question',
  'ai.impact_drafted',
  'ai.brief_written',
  'distribution.proposed_by_ai',
  'ai.distribution_revised',
  'distribution.adjusted',
  'distribution.treasurer_approved',
  'distribution.pastor_approved',
  'distribution.rejected',
  'distribution.executed',
  'impact.approved',
  'payout.item_succeeded',
  'payout.item_failed',
  'gift.captured',
  'gift.subscription_activated',
];

activityRouter.get(
  '/activity',
  requireRole(UserRole.TREASURER, UserRole.PASTOR),
  async (_req, res, next) => {
    try {
      const rows = await prisma.auditLog.findMany({
        where: { action: { in: INTERESTING } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      res.json({
        entries: rows.map((row) => ({
          id: row.id,
          at: row.createdAt.toISOString(),
          actor: row.actor,
          action: row.action,
          /** True when a model produced this, rather than a person. */
          byAi: row.action.startsWith('ai.') || row.action.endsWith('proposed_by_ai'),
          entity: row.entity,
          entityId: row.entityId,
          payload: row.payload,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);
