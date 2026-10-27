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
import {
  DistributionItemStatus,
  DistributionStatus,
  GiftStatus,
  Prisma,
  TransactionDirection,
  TransactionSource,
} from '@prisma/client';

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
    /** PAYMENT.SALE.COMPLETED carries the subscription here. */
    billing_agreement_id?: string;
    /** BILLING.SUBSCRIPTION.* resources. */
    plan_id?: string;
    quantity?: string;
    subscriber?: { email_address?: string };
    billing_info?: { next_billing_time?: string };
    /** PAYMENT.PAYOUTS-ITEM.* resources. */
    payout_item_id?: string;
    payout_item?: { sender_item_id?: string; receiver?: string };
    payout_batch_id?: string;
    transaction_status?: string;
    errors?: { name?: string; message?: string };
    batch_header?: {
      payout_batch_id?: string;
      batch_status?: string;
      sender_batch_header?: { sender_batch_id?: string };
    };
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

/**
 * The donor finished approving at PayPal. The Gift moves to ACTIVE; the money
 * itself arrives later as PAYMENT.SALE.COMPLETED.
 */
async function handleSubscriptionActivated(event: PayPalEvent): Promise<string> {
  const resource = event.resource;
  if (!resource?.id) return 'subscription resource has no id';

  const gift =
    (resource.custom_id
      ? await prisma.gift.findUnique({ where: { id: resource.custom_id } })
      : null) ?? (await prisma.gift.findUnique({ where: { paypalSubscriptionId: resource.id } }));

  if (!gift) return `no gift for subscription ${resource.id}`;

  await prisma.gift.update({
    where: { id: gift.id },
    data: {
      status: GiftStatus.ACTIVE,
      completedAt: gift.completedAt ?? new Date(),
      paypalSubscriptionId: gift.paypalSubscriptionId ?? resource.id,
      payerEmail: resource.subscriber?.email_address ?? gift.payerEmail,
    },
  });
  await prisma.auditLog.create({
    data: {
      actor: 'system:paypal-webhook',
      action: 'gift.subscription_activated',
      entity: 'Gift',
      entityId: gift.id,
      payload: { subscriptionId: resource.id },
    },
  });

  return `subscription ${resource.id} active for gift ${gift.id}`;
}

/** The donor stopped giving, or PayPal stopped the agreement. */
async function handleSubscriptionEnded(event: PayPalEvent, status: GiftStatus): Promise<string> {
  const resource = event.resource;
  if (!resource?.id) return 'subscription resource has no id';

  const gift = await prisma.gift.findUnique({ where: { paypalSubscriptionId: resource.id } });
  if (!gift) return `no gift for subscription ${resource.id}`;

  await prisma.gift.update({ where: { id: gift.id }, data: { status } });
  return `subscription ${resource.id} -> ${status}`;
}

/**
 * One monthly charge actually went through. Each is its own ledger row against
 * the same Gift, idempotent on the sale id so a redelivery cannot double-count.
 */
async function handleRecurringPayment(event: PayPalEvent): Promise<string> {
  const resource = event.resource;
  if (!resource?.id || !resource.amount) return 'sale resource incomplete';

  const subscriptionId = resource.billing_agreement_id;
  const gift =
    (resource.custom_id
      ? await prisma.gift.findUnique({ where: { id: resource.custom_id } })
      : null) ??
    (subscriptionId
      ? await prisma.gift.findUnique({ where: { paypalSubscriptionId: subscriptionId } })
      : null);

  // A one-off sale with no subscription behind it is not ours to record here.
  if (!gift) return `no gift for sale ${resource.id} (subscription ${subscriptionId ?? '-'})`;

  const amountCents = payPalValueToCents(resource.amount.value);
  const occurredAt = resource.create_time ? new Date(resource.create_time) : new Date();

  const existing = await prisma.transaction.findFirst({
    where: { direction: TransactionDirection.IN, paypalRef: resource.id },
    select: { id: true },
  });
  if (existing) return `sale ${resource.id} already recorded`;

  const fee = resource.seller_receivable_breakdown?.paypal_fee?.value;
  const net = resource.seller_receivable_breakdown?.net_amount?.value;

  await prisma.transaction.create({
    data: {
      fundId: gift.fundId,
      giftId: gift.id,
      direction: TransactionDirection.IN,
      amountCents,
      currency: resource.amount.currency_code,
      paypalRef: resource.id,
      feeCents: fee ? payPalValueToCents(fee) : null,
      netCents: net ? payPalValueToCents(net) : null,
      source: TransactionSource.SUBSCRIPTION,
      description: 'Monthly gift charged via PayPal Subscriptions',
      occurredAt,
    },
  });

  // The first charge is also what proves the subscription is really running.
  if (gift.status !== GiftStatus.ACTIVE) {
    await prisma.gift.update({
      where: { id: gift.id },
      data: { status: GiftStatus.ACTIVE, completedAt: gift.completedAt ?? occurredAt },
    });
  }

  return `recorded ${amountCents} cents for gift ${gift.id} (sale ${resource.id})`;
}

/**
 * One payout reached its recipient, or failed to.
 *
 * `sender_item_id` is our DistributionItem id, set when the batch was sent.
 * A failed item reverses its ledger row: the money never left, so leaving the
 * OUT transaction standing would understate the fund.
 */
async function handlePayoutItem(event: PayPalEvent, succeeded: boolean): Promise<string> {
  const resource = event.resource;
  const itemId = resource?.payout_item?.sender_item_id;
  if (!itemId) return 'payout item carries no sender_item_id';

  const item = await prisma.distributionItem.findUnique({ where: { id: itemId } });
  if (!item) return `no distribution item ${itemId}`;

  await prisma.distributionItem.update({
    where: { id: item.id },
    data: {
      status: succeeded ? DistributionItemStatus.SUCCEEDED : DistributionItemStatus.FAILED,
      paypalItemId: resource?.payout_item_id ?? item.paypalItemId,
      blockedReason: succeeded ? null : (resource?.errors?.message ?? 'PayPal reported a failure'),
    },
  });

  if (!succeeded) {
    // Undo the ledger entry: this money is still in the fund.
    await prisma.transaction.deleteMany({
      where: { distributionItemId: item.id, direction: TransactionDirection.OUT },
    });
  }

  await prisma.auditLog.create({
    data: {
      actor: 'system:paypal-webhook',
      action: succeeded ? 'payout.item_succeeded' : 'payout.item_failed',
      entity: 'DistributionItem',
      entityId: item.id,
      payload: {
        amountCents: item.amountCents,
        payoutItemId: resource?.payout_item_id ?? null,
        error: resource?.errors?.message ?? null,
      },
    },
  });

  return `item ${item.id} -> ${succeeded ? 'SUCCEEDED' : 'FAILED'}`;
}

/** The whole batch finished. Used to mark a distribution that fully failed. */
async function handlePayoutBatch(event: PayPalEvent): Promise<string> {
  const batchId = event.resource?.batch_header?.payout_batch_id;
  if (!batchId) return 'batch event carries no payout_batch_id';

  const distribution = await prisma.distribution.findUnique({
    where: { paypalBatchId: batchId },
    include: { items: true },
  });
  if (!distribution) return `no distribution for batch ${batchId}`;

  const allFailed =
    distribution.items.length > 0 &&
    distribution.items.every((i) => i.status === DistributionItemStatus.FAILED);

  if (allFailed && distribution.status !== DistributionStatus.FAILED) {
    await prisma.distribution.update({
      where: { id: distribution.id },
      data: { status: DistributionStatus.FAILED },
    });
    return `batch ${batchId}: every item failed`;
  }

  return `batch ${batchId}: ${event.resource?.batch_header?.batch_status ?? 'reported'}`;
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
      switch (event.event_type) {
        case 'PAYMENT.CAPTURE.COMPLETED':
          note = await handleCaptureCompleted(event);
          break;
        case 'BILLING.SUBSCRIPTION.ACTIVATED':
          note = await handleSubscriptionActivated(event);
          break;
        case 'BILLING.SUBSCRIPTION.CANCELLED':
          note = await handleSubscriptionEnded(event, GiftStatus.CANCELLED);
          break;
        case 'BILLING.SUBSCRIPTION.EXPIRED':
        case 'BILLING.SUBSCRIPTION.SUSPENDED':
          note = await handleSubscriptionEnded(event, GiftStatus.FAILED);
          break;
        case 'PAYMENT.SALE.COMPLETED':
          note = await handleRecurringPayment(event);
          break;
        case 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED':
          note = await handlePayoutItem(event, true);
          break;
        case 'PAYMENT.PAYOUTS-ITEM.FAILED':
        case 'PAYMENT.PAYOUTS-ITEM.DENIED':
        case 'PAYMENT.PAYOUTS-ITEM.RETURNED':
        case 'PAYMENT.PAYOUTS-ITEM.BLOCKED':
          note = await handlePayoutItem(event, false);
          break;
        case 'PAYMENT.PAYOUTSBATCH.SUCCESS':
        case 'PAYMENT.PAYOUTSBATCH.DENIED':
        case 'PAYMENT.PAYOUTSBATCH.PROCESSING':
          note = await handlePayoutBatch(event);
          break;
        default:
          break;
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
