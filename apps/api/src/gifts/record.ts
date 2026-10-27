/**
 * Recording a captured gift.
 *
 * Two legs can report the same capture: the inline `/capture` call the browser
 * makes, and the `PAYMENT.CAPTURE.COMPLETED` webhook. Either may arrive first,
 * and either may arrive twice. This function is the single writer for both, and
 * it is idempotent on the PayPal capture id.
 */
import {
  GiftStatus,
  TransactionDirection,
  TransactionSource,
  type Prisma,
  type Gift,
} from '@prisma/client';

import { prisma } from '../db/client.js';
import { payPalValueToCents } from '../money.js';
import type { Order } from '../paypal/orders.js';

export type CaptureFacts = {
  captureId: string;
  amountValue: string;
  currency: string;
  occurredAt: Date;
  feeValue?: string | null;
  netValue?: string | null;
  payerEmail?: string | null;
  payerName?: string | null;
  payerId?: string | null;
};

/** Everything worth keeping out of an Orders API capture response. */
export function captureFactsFromOrder(order: Order): CaptureFacts | null {
  const capture = order.purchase_units
    ?.flatMap((unit) => unit.payments?.captures ?? [])
    .find((c) => c.status === 'COMPLETED');
  if (!capture) return null;

  const breakdown = capture.seller_receivable_breakdown;
  const payerName = [order.payer?.name?.given_name, order.payer?.name?.surname]
    .filter(Boolean)
    .join(' ');

  return {
    captureId: capture.id,
    amountValue: capture.amount.value,
    currency: capture.amount.currency_code,
    occurredAt: capture.create_time ? new Date(capture.create_time) : new Date(),
    feeValue: breakdown?.paypal_fee?.value ?? null,
    netValue: breakdown?.net_amount?.value ?? null,
    payerEmail: order.payer?.email_address ?? null,
    payerName: payerName || null,
    payerId: order.payer?.payer_id ?? null,
  };
}

const centsOrNull = (value?: string | null) =>
  value === null || value === undefined ? null : payPalValueToCents(value);

export type RecordResult = {
  gift: Gift;
  /** False when this capture had already been recorded by the other leg. */
  created: boolean;
};

export async function recordCapturedGift(options: {
  gift: Gift;
  facts: CaptureFacts;
  source: TransactionSource;
  rawCapture?: unknown;
  actor: string;
}): Promise<RecordResult> {
  const { gift, facts, source, rawCapture, actor } = options;
  const amountCents = payPalValueToCents(facts.amountValue);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.transaction.findFirst({
      where: { direction: TransactionDirection.IN, paypalRef: facts.captureId },
      select: { id: true },
    });

    const updated = await tx.gift.update({
      where: { id: gift.id },
      data: {
        status: GiftStatus.COMPLETED,
        completedAt: facts.occurredAt,
        payerEmail: facts.payerEmail,
        payerName: facts.payerName,
        payerId: facts.payerId,
        ...(rawCapture === undefined
          ? {}
          : { rawCapture: rawCapture as Prisma.InputJsonValue }),
      },
    });

    if (existing) return { gift: updated, created: false };

    await tx.transaction.create({
      data: {
        fundId: updated.fundId,
        giftId: updated.id,
        direction: TransactionDirection.IN,
        amountCents,
        currency: facts.currency,
        paypalRef: facts.captureId,
        feeCents: centsOrNull(facts.feeValue),
        netCents: centsOrNull(facts.netValue),
        source,
        description: `One-time gift captured via PayPal (${source.toLowerCase()})`,
        occurredAt: facts.occurredAt,
      },
    });

    await tx.auditLog.create({
      data: {
        actor,
        action: 'gift.captured',
        entity: 'Gift',
        entityId: updated.id,
        payload: {
          captureId: facts.captureId,
          amountCents,
          feeCents: centsOrNull(facts.feeValue),
          netCents: centsOrNull(facts.netValue),
          source,
        },
      },
    });

    return { gift: updated, created: true };
  });
}
