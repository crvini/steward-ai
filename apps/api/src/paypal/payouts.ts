/**
 * Payouts API v1 — the only place money leaves the church (docs/SPEC.md §4).
 *
 * Nothing in the AI layer may import this module. It is called from exactly
 * one place: the execute endpoint, after two approvals and a passing rules
 * check.
 */
import { paypal } from './client.js';
import { centsToPayPalValue } from '../money.js';

export type PayoutItem = {
  recipientEmail: string;
  amountCents: number;
  currency: string;
  /** Our DistributionItem id, echoed back in the item webhooks. */
  senderItemId: string;
  note: string;
};

export type PayoutBatch = {
  batch_header: {
    payout_batch_id: string;
    batch_status: 'DENIED' | 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'CANCELED';
    sender_batch_header?: { sender_batch_id?: string };
  };
  items?: {
    payout_item_id: string;
    transaction_status: string;
    payout_item: { sender_item_id?: string; receiver?: string };
  }[];
};

export async function sendPayoutBatch(options: {
  /** Must be unique and stable: PayPal uses it to refuse a duplicate batch. */
  senderBatchId: string;
  emailSubject: string;
  items: PayoutItem[];
}): Promise<PayoutBatch> {
  const { senderBatchId, emailSubject, items } = options;
  if (items.length === 0) throw new RangeError('A payout batch needs at least one item');

  return paypal.post<PayoutBatch>(
    '/v1/payments/payouts',
    {
      sender_batch_header: {
        sender_batch_id: senderBatchId,
        email_subject: emailSubject.slice(0, 255),
        email_message: 'Thank you for serving. Sent through Steward AI.',
      },
      items: items.map((item) => ({
        recipient_type: 'EMAIL',
        receiver: item.recipientEmail,
        amount: {
          value: centsToPayPalValue(item.amountCents),
          currency: item.currency,
        },
        note: item.note.slice(0, 1000),
        sender_item_id: item.senderItemId,
      })),
    },
    // Second layer of idempotency, on top of sender_batch_id.
    `payout-${senderBatchId}`,
  );
}

export function getPayoutBatch(batchId: string): Promise<PayoutBatch> {
  return paypal.get<PayoutBatch>(`/v1/payments/payouts/${encodeURIComponent(batchId)}`);
}
