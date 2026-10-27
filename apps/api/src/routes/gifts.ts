/**
 * One-time giving, end to end (spec §8, first block).
 *
 *   POST /api/gifts                     create a PENDING Gift + a PayPal order
 *   POST /api/gifts/:orderId/capture    capture, then record Gift + Transaction
 *   GET  /api/gifts                     recent gifts for the demo table
 *
 * Both the create and the capture happen server-side. The browser only ever
 * holds an order id.
 */
import { Router } from 'express';
import { z } from 'zod';
import { GiftFrequency, GiftStatus, TransactionDirection, Prisma } from '@prisma/client';

import { prisma } from '../db/client.js';
import { createOrder, captureOrder, completedCapture } from '../paypal/orders.js';
import { payPalValueToCents } from '../money.js';

export const giftsRouter = Router();

const createGiftSchema = z.object({
  donorId: z.string().min(1),
  fundId: z.string().min(1),
  // Cents, so the wire format cannot carry a rounding error.
  amountCents: z.number().int().positive().max(1_000_000),
});

giftsRouter.post('/gifts', async (req, res, next) => {
  try {
    const parsed = createGiftSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
    }
    const { donorId, fundId, amountCents } = parsed.data;

    const [donor, fund] = await Promise.all([
      prisma.user.findUnique({ where: { id: donorId }, include: { church: true } }),
      prisma.fund.findUnique({ where: { id: fundId } }),
    ]);
    if (!donor) return res.status(404).json({ error: 'donor_not_found' });
    if (!fund) return res.status(404).json({ error: 'fund_not_found' });

    const gift = await prisma.gift.create({
      data: {
        donorId,
        fundId,
        amountCents,
        frequency: GiftFrequency.ONE_TIME,
        status: GiftStatus.PENDING,
      },
    });

    const order = await createOrder({
      amountCents,
      customId: gift.id,
      fundName: fund.name,
      churchName: donor.church.name,
    });

    await prisma.gift.update({ where: { id: gift.id }, data: { paypalOrderId: order.id } });
    await prisma.auditLog.create({
      data: {
        actor: donor.email,
        action: 'gift.order_created',
        entity: 'Gift',
        entityId: gift.id,
        payload: { orderId: order.id, amountCents, fundId },
      },
    });

    res.status(201).json({ giftId: gift.id, orderId: order.id, status: order.status });
  } catch (error) {
    next(error);
  }
});

giftsRouter.post('/gifts/:orderId/capture', async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const gift = await prisma.gift.findUnique({ where: { paypalOrderId: orderId } });
    if (!gift) return res.status(404).json({ error: 'gift_not_found_for_order' });

    // Idempotent: a double-click, a retried webhook and a refreshed tab all land here.
    if (gift.status === GiftStatus.COMPLETED) {
      return res.json({ giftId: gift.id, status: gift.status, alreadyCaptured: true });
    }

    const order = await captureOrder(orderId);
    const capture = completedCapture(order);

    if (!capture) {
      await prisma.gift.update({
        where: { id: gift.id },
        data: { status: GiftStatus.FAILED },
      });
      return res.status(502).json({ error: 'capture_not_completed', orderStatus: order.status });
    }

    const amountCents = payPalValueToCents(capture.amount.value);
    const occurredAt = capture.create_time ? new Date(capture.create_time) : new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const g = await tx.gift.update({
        where: { id: gift.id },
        data: { status: GiftStatus.COMPLETED, completedAt: occurredAt },
      });

      // `@@unique([direction, paypalRef])` makes a replayed capture a no-op.
      await tx.transaction.createMany({
        data: [
          {
            fundId: g.fundId,
            giftId: g.id,
            direction: TransactionDirection.IN,
            amountCents,
            currency: capture.amount.currency_code,
            paypalRef: capture.id,
            description: 'One-time gift captured via PayPal Orders API',
            occurredAt,
          },
        ],
        skipDuplicates: true,
      });

      await tx.auditLog.create({
        data: {
          actor: 'system:paypal-capture',
          action: 'gift.captured',
          entity: 'Gift',
          entityId: g.id,
          payload: { orderId, captureId: capture.id, amountCents },
        },
      });

      return g;
    });

    res.json({
      giftId: updated.id,
      status: updated.status,
      captureId: capture.id,
      amountCents,
    });
  } catch (error) {
    next(error);
  }
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(25),
  fundId: z.string().min(1).optional(),
});

giftsRouter.get('/gifts', async (req, res, next) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
    }
    const { limit, fundId } = parsed.data;

    const where: Prisma.GiftWhereInput = fundId ? { fundId } : {};
    const gifts = await prisma.gift.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        donor: { select: { id: true, name: true } },
        fund: { select: { id: true, name: true, slug: true } },
      },
    });

    res.json({
      gifts: gifts.map((g) => ({
        id: g.id,
        donor: g.donor.name,
        fund: g.fund.name,
        fundSlug: g.fund.slug,
        amountCents: g.amountCents,
        currency: g.currency,
        frequency: g.frequency,
        status: g.status,
        paypalOrderId: g.paypalOrderId,
        createdAt: g.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});
