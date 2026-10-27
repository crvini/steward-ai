/**
 * Orders API v2 — create and capture. Both run on the server, per spec §4.
 */
import { paypal } from './client.js';
import { centsToPayPalValue } from '../money.js';

export type Money = { currency_code: string; value: string };

export type Order = {
  id: string;
  status: 'CREATED' | 'SAVED' | 'APPROVED' | 'VOIDED' | 'COMPLETED' | 'PAYER_ACTION_REQUIRED';
  purchase_units?: {
    reference_id?: string;
    custom_id?: string;
    payments?: {
      captures?: {
        id: string;
        status: string;
        amount: Money;
        create_time?: string;
        seller_receivable_breakdown?: { paypal_fee?: Money; net_amount?: Money };
      }[];
    };
  }[];
  payer?: {
    payer_id?: string;
    email_address?: string;
    name?: { given_name?: string; surname?: string };
  };
};

export type CreateOrderInput = {
  amountCents: number;
  currency?: string;
  /** Our Gift id, echoed back by PayPal on capture and in webhooks. */
  customId: string;
  fundName: string;
  churchName: string;
};

export async function createOrder(input: CreateOrderInput): Promise<Order> {
  const { amountCents, currency = 'USD', customId, fundName, churchName } = input;

  return paypal.post<Order>(
    '/v2/checkout/orders',
    {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: customId,
          custom_id: customId,
          description: `${fundName} gift`.slice(0, 127),
          soft_descriptor: churchName.slice(0, 22),
          amount: { currency_code: currency, value: centsToPayPalValue(amountCents) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            shipping_preference: 'NO_SHIPPING',
            user_action: 'PAY_NOW',
          },
        },
      },
    },
    // Our Gift id doubles as the idempotency key: a retried create cannot
    // produce a second order for the same gift.
    `gift-${customId}`,
  );
}

export function captureOrder(orderId: string): Promise<Order> {
  return paypal.post<Order>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`);
}

export function getOrder(orderId: string): Promise<Order> {
  return paypal.get<Order>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}

/** The single completed capture on an order, if the capture succeeded. */
export function completedCapture(order: Order) {
  return order.purchase_units
    ?.flatMap((unit) => unit.payments?.captures ?? [])
    .find((capture) => capture.status === 'COMPLETED');
}
