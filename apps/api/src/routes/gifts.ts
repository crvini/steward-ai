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
import { GiftFrequency, GiftStatus, TransactionSource, Prisma } from '@prisma/client';

import { prisma } from '../db/client.js';
import { createOrder, captureOrder } from '../paypal/orders.js';
import { captureFactsFromOrder, recordCapturedGift } from '../gifts/record.js';

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

    await prisma.gift.update({
      where: { id: gift.id },
      data: { paypalOrderId: order.id, rawOrder: order as unknown as Prisma.InputJsonValue },
    });
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
    const facts = captureFactsFromOrder(order);

    if (!facts) {
      await prisma.gift.update({
        where: { id: gift.id },
        data: { status: GiftStatus.FAILED },
      });
      return res.status(502).json({ error: 'capture_not_completed', orderStatus: order.status });
    }

    const { gift: updated, created } = await recordCapturedGift({
      gift,
      facts,
      source: TransactionSource.CAPTURE,
      rawCapture: order,
      actor: 'system:paypal-capture',
    });

    res.json({
      giftId: updated.id,
      status: updated.status,
      captureId: facts.captureId,
      amountCents: updated.amountCents,
      recordedByWebhookFirst: !created,
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
        transactions: {
          select: { paypalRef: true, feeCents: true, netCents: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
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
        payerEmail: g.payerEmail,
        captureId: g.transactions[0]?.paypalRef ?? null,
        feeCents: g.transactions[0]?.feeCents ?? null,
        netCents: g.transactions[0]?.netCents ?? null,
        createdAt: g.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});
