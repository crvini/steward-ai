/**
 * Monthly giving.
 *
 *   POST /api/subscriptions             create a PENDING Gift + a PayPal subscription
 *   POST /api/subscriptions/:id/confirm the donor approved; record it
 *   POST /api/subscriptions/:id/cancel  stop a recurring gift
 *
 * The donor's monthly charges arrive later as PAYMENT.SALE.COMPLETED webhooks,
 * each one a Transaction against the same Gift.
 */
import { Router } from 'express';
import { z } from 'zod';
import { GiftFrequency, GiftStatus, Prisma } from '@prisma/client';

import { prisma } from '../db/client.js';
import { env } from '../config/env.js';
import {
  cancelSubscription,
  createSubscription,
  ensurePlanForFund,
  getSubscription,
} from '../paypal/subscriptions.js';

export const subscriptionsRouter = Router();

const createSchema = z.object({
  fundId: z.string().min(1),
  /**
   * Whole dollars. The plan charges $1.00 per unit and the amount rides in
   * `quantity`, so cents are not expressible for monthly gifts.
   */
  amountDollars: z.number().int().positive().max(10_000),
});

subscriptionsRouter.post('/subscriptions', async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
    }
    if (!req.user) return res.status(401).json({ error: 'not_signed_in' });

    const { fundId, amountDollars } = parsed.data;
    const fund = await prisma.fund.findUnique({ where: { id: fundId } });
    if (!fund) return res.status(404).json({ error: 'fund_not_found' });

    const gift = await prisma.gift.create({
      data: {
        donorId: req.user.id,
        fundId,
        amountCents: amountDollars * 100,
        frequency: GiftFrequency.MONTHLY,
        status: GiftStatus.PENDING,
      },
    });

    const planId = await ensurePlanForFund(fundId);
    const subscription = await createSubscription({
      planId,
      quantity: amountDollars,
      customId: gift.id,
      donorName: req.user.name,
      donorEmail: req.user.email,
      returnUrl: `${env.WEB_URL}/?subscribed=1`,
      cancelUrl: `${env.WEB_URL}/?subscription_cancelled=1`,
    });

    await prisma.gift.update({
      where: { id: gift.id },
      data: {
        paypalSubscriptionId: subscription.id,
        rawOrder: subscription as unknown as Prisma.InputJsonValue,
      },
    });
    await prisma.auditLog.create({
      data: {
        actor: req.user.email,
        action: 'gift.subscription_created',
        entity: 'Gift',
        entityId: gift.id,
        payload: { subscriptionId: subscription.id, planId, amountDollars, fundId },
      },
    });

    res.status(201).json({
      giftId: gift.id,
      subscriptionId: subscription.id,
      status: subscription.status,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Called once the donor comes back from PayPal. The authoritative signal is
 * still the BILLING.SUBSCRIPTION.ACTIVATED webhook; this just means the donor
 * does not stare at a stale screen while it arrives.
 */
subscriptionsRouter.post('/subscriptions/:id/confirm', async (req, res, next) => {
  try {
    const subscriptionId = req.params.id;
    const gift = await prisma.gift.findUnique({ where: { paypalSubscriptionId: subscriptionId } });
    if (!gift) return res.status(404).json({ error: 'gift_not_found_for_subscription' });

    const subscription = await getSubscription(subscriptionId);
    const active = subscription.status === 'ACTIVE' || subscription.status === 'APPROVED';

    const updated = await prisma.gift.update({
      where: { id: gift.id },
      data: {
        status: active ? GiftStatus.ACTIVE : gift.status,
        completedAt: active ? (gift.completedAt ?? new Date()) : gift.completedAt,
        payerEmail: subscription.subscriber?.email_address ?? gift.payerEmail,
        rawCapture: subscription as unknown as Prisma.InputJsonValue,
      },
    });

    res.json({
      giftId: updated.id,
      status: updated.status,
      paypalStatus: subscription.status,
      nextBillingTime: subscription.billing_info?.next_billing_time ?? null,
    });
  } catch (error) {
    next(error);
  }
});

subscriptionsRouter.post('/subscriptions/:id/cancel', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'not_signed_in' });

    const gift = await prisma.gift.findUnique({ where: { paypalSubscriptionId: req.params.id } });
    if (!gift) return res.status(404).json({ error: 'gift_not_found_for_subscription' });
    // A donor may only stop their own giving.
    if (gift.donorId !== req.user.id) return res.status(403).json({ error: 'not_your_gift' });

    await cancelSubscription(req.params.id, 'Cancelled by the donor');

    const updated = await prisma.gift.update({
      where: { id: gift.id },
      data: { status: GiftStatus.CANCELLED },
    });
    await prisma.auditLog.create({
      data: {
        actor: req.user.email,
        action: 'gift.subscription_cancelled',
        entity: 'Gift',
        entityId: gift.id,
        payload: { subscriptionId: req.params.id },
      },
    });

    res.json({ giftId: updated.id, status: updated.status });
  } catch (error) {
    next(error);
  }
});

/** The donor's own recurring gifts, for the "monthly giving" list. */
subscriptionsRouter.get('/subscriptions', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'not_signed_in' });

    const gifts = await prisma.gift.findMany({
      where: { donorId: req.user.id, frequency: GiftFrequency.MONTHLY },
      orderBy: { createdAt: 'desc' },
      include: {
        fund: { select: { name: true, slug: true } },
        transactions: { select: { amountCents: true, occurredAt: true } },
      },
    });

    res.json({
      subscriptions: gifts.map((g) => ({
        id: g.id,
        fund: g.fund.name,
        fundSlug: g.fund.slug,
        amountCents: g.amountCents,
        currency: g.currency,
        status: g.status,
        subscriptionId: g.paypalSubscriptionId,
        chargesSoFar: g.transactions.length,
        givenSoFarCents: g.transactions.reduce((sum, t) => sum + t.amountCents, 0),
        createdAt: g.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});
