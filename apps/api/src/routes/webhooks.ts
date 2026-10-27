/**
 * POST /api/webhooks/paypal
 *
 * Every notification is stored before it is acted on, verified against
 * `verify-webhook-signature`, and de-duplicated on PayPal's event id so a
 * redelivery can never double-post to the ledger (spec §4).
 *
 * Always answers 200 once the event is persisted: a non-2xx makes PayPal retry,
 * and retrying will not fix a payload we have already stored and rejected.
 */
import { Router, raw } from 'express';
import { Prisma, TransactionSource } from '@prisma/client';

import { prisma } from '../db/client.js';
import { readTransmissionHeaders, verifyWebhookSignature } from '../paypal/webhooks.js';
import { getOrder } from '../paypal/orders.js';
import { captureFactsFromOrder, recordCapturedGift } from '../gifts/record.js';
import { payPalValueToCents } from '../money.js';

export const webhooksRouter = Router();

type PayPalEvent = {
  id: string;
  event_type: string;
  resource?: {
    id?: string;
    custom_id?: string;
    status?: string;
    create_time?: string;
    amount?: { value: string; currency_code: string };
    seller_receivable_breakdown?: {
      paypal_fee?: { value: string };
      net_amount?: { value: string };
    };
    supplementary_data?: { related_ids?: { order_id?: string } };
  };
};

/**
 * `PAYMENT.CAPTURE.COMPLETED` carries the capture, not the order. The Gift is
 * found by `custom_id` (we set it to the Gift id when creating the order) and
 * falls back to the related order id.
 */
async function handleCaptureCompleted(event: PayPalEvent): Promise<string> {
  const resource = event.resource;
  if (!resource?.id || !resource.amount) return 'capture resource incomplete';

  const giftId = resource.custom_id;
  const orderId = resource.supplementary_data?.related_ids?.order_id;

  const gift = giftId
    ? await prisma.gift.findUnique({ where: { id: giftId } })
    : orderId
      ? await prisma.gift.findUnique({ where: { paypalOrderId: orderId } })
      : null;

  if (!gift) return `no gift for custom_id=${giftId ?? '-'} order=${orderId ?? '-'}`;

  // The webhook omits payer identity, so it is fetched from the order when we
  // know one. A failure here must not block recording the money.
  let payer: Awaited<ReturnType<typeof getOrder>> | null = null;
  if (gift.paypalOrderId) {
    payer = await getOrder(gift.paypalOrderId).catch(() => null);
  }
  const fromOrder = payer ? captureFactsFromOrder(payer) : null;

  const { created } = await recordCapturedGift({
    gift,
    facts: {
      captureId: resource.id,
      amountValue: resource.amount.value,
      currency: resource.amount.currency_code,
      occurredAt: resource.create_time ? new Date(resource.create_time) : new Date(),
      feeValue: resource.seller_receivable_breakdown?.paypal_fee?.value ?? null,
      netValue: resource.seller_receivable_breakdown?.net_amount?.value ?? null,
      payerEmail: fromOrder?.payerEmail ?? null,
      payerName: fromOrder?.payerName ?? null,
      payerId: fromOrder?.payerId ?? null,
    },
    source: TransactionSource.WEBHOOK,
    rawCapture: resource,
    actor: 'system:paypal-webhook',
  });

  const amount = payPalValueToCents(resource.amount.value);
  return created
    ? `recorded ${amount} cents for gift ${gift.id}`
    : `already recorded by the capture call`;
}

webhooksRouter.post(
  '/webhooks/paypal',
  // Raw body: signature verification needs PayPal's exact bytes.
  raw({ type: '*/*', limit: '1mb' }),
  async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';

    let event: PayPalEvent;
    try {
      event = JSON.parse(rawBody) as PayPalEvent;
    } catch {
      return res.status(400).json({ error: 'invalid_json' });
    }
    if (!event.id || !event.event_type) {
      return res.status(400).json({ error: 'not_a_paypal_event' });
    }

    // Idempotency gate: the unique index makes a redelivery a no-op.
    try {
      await prisma.webhookEvent.create({
        data: {
          paypalEventId: event.id,
          type: event.event_type,
          payload: JSON.parse(rawBody) as Prisma.InputJsonValue,
          resourceId: event.resource?.id ?? null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        console.log(`[webhook] duplicate ${event.event_type} ${event.id} ignored`);
        return res.json({ received: true, duplicate: true });
      }
      throw error;
    }

    const headers = readTransmissionHeaders(req.headers);
    const verification = headers
      ? await verifyWebhookSignature(headers, rawBody)
      : ({ verified: false, reason: 'missing transmission headers' } as const);

    if (!verification.verified) {
      console.warn(`[webhook] rejected ${event.event_type} ${event.id}: ${verification.reason}`);
      await prisma.webhookEvent.update({
        where: { paypalEventId: event.id },
        data: { processingError: `unverified: ${verification.reason}` },
      });
      return res.status(401).json({ error: 'signature_not_verified' });
    }

    let note = `no handler for ${event.event_type}`;
    let failure: string | null = null;
    try {
      if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
        note = await handleCaptureCompleted(event);
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      console.error(`[webhook] handler failed for ${event.id}:`, failure);
    }

    await prisma.webhookEvent.update({
      where: { paypalEventId: event.id },
      data: {
        verified: true,
        processedAt: failure ? null : new Date(),
        processingError: failure,
      },
    });

    console.log(`[webhook] ${event.event_type} ${event.id}: ${failure ?? note}`);
    res.json({ received: true, verified: true, note: failure ?? note });
  },
);

/** Recent events, so the treasurer dashboard can show delivery health. */
webhooksRouter.get('/webhooks/paypal/recent', async (_req, res, next) => {
  try {
    const events = await prisma.webhookEvent.findMany({
      orderBy: { receivedAt: 'desc' },
      take: 25,
      select: {
        paypalEventId: true,
        type: true,
        verified: true,
        resourceId: true,
        receivedAt: true,
        processedAt: true,
        processingError: true,
      },
    });
    res.json({ events });
  } catch (error) {
    next(error);
  }
});
