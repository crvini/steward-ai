/**
 * Subscriptions API v1 — monthly giving (docs/SPEC.md §4).
 *
 * PayPal billing plans carry a fixed price, but a donor picks their own
 * amount. The shape that solves this without creating a plan per amount is
 * one plan per fund priced at **$1.00 per unit**, with the donor's amount
 * riding in the subscription's `quantity`. $50 a month is quantity 50.
 *
 * Consequence worth knowing: amounts are whole dollars. Monthly giving of
 * $12.50 is not expressible this way, and the UI only offers whole dollars
 * for monthly gifts because of it.
 */
import { paypal } from './client.js';
import { prisma } from '../db/client.js';

/** The unit price every plan is built on. Changing it changes what quantity means. */
export const PLAN_UNIT_PRICE = '1.00';

type Product = { id: string; name: string };
type Plan = { id: string; status: string; name: string };

export type Subscription = {
  id: string;
  status: 'APPROVAL_PENDING' | 'APPROVED' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED';
  plan_id?: string;
  quantity?: string;
  custom_id?: string;
  subscriber?: { email_address?: string; name?: { given_name?: string; surname?: string } };
  billing_info?: {
    last_payment?: { amount?: { value: string; currency_code: string }; time?: string };
    next_billing_time?: string;
  };
  links?: { rel: string; href: string }[];
};

/**
 * The catalog product every plan hangs off. Created once per church and then
 * remembered, so a restart does not litter the PayPal account with duplicates.
 */
async function ensureProduct(churchId: string, churchName: string): Promise<string> {
  const church = await prisma.church.findUnique({
    where: { id: churchId },
    select: { paypalProductId: true },
  });
  if (church?.paypalProductId) return church.paypalProductId;

  const product = await paypal.post<Product>(
    '/v1/catalogs/products',
    {
      name: `${churchName} — Giving`.slice(0, 127),
      description: 'Recurring giving to designated church funds',
      type: 'SERVICE',
      category: 'NONPROFIT',
    },
    // Idempotency: a retry cannot create a second product for this church.
    `product-${churchId}`,
  );

  await prisma.church.update({
    where: { id: churchId },
    data: { paypalProductId: product.id },
  });
  return product.id;
}

/** The $1.00-per-unit monthly plan for one fund, created on first use. */
export async function ensurePlanForFund(fundId: string): Promise<string> {
  const fund = await prisma.fund.findUnique({
    where: { id: fundId },
    include: { church: { select: { id: true, name: true, currency: true } } },
  });
  if (!fund) throw new Error(`Fund ${fundId} not found`);
  if (fund.paypalPlanId) return fund.paypalPlanId;

  const productId = await ensureProduct(fund.church.id, fund.church.name);

  const plan = await paypal.post<Plan>(
    '/v1/billing/plans',
    {
      product_id: productId,
      name: `${fund.name} — monthly giving`.slice(0, 127),
      description: `Monthly gift to ${fund.name}. Priced per $1 unit.`.slice(0, 127),
      status: 'ACTIVE',
      // Lets one plan serve every amount: the donor's dollars are the quantity.
      quantity_supported: true,
      billing_cycles: [
        {
          frequency: { interval_unit: 'MONTH', interval_count: 1 },
          tenure_type: 'REGULAR',
          sequence: 1,
          // 0 = until the donor cancels. A gift should not quietly expire.
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: { value: PLAN_UNIT_PRICE, currency_code: fund.church.currency },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee_failure_action: 'CONTINUE',
        payment_failure_threshold: 3,
      },
    },
    `plan-${fund.id}`,
  );

  await prisma.fund.update({ where: { id: fund.id }, data: { paypalPlanId: plan.id } });
  return plan.id;
}

export async function createSubscription(options: {
  planId: string;
  /** Whole dollars per month; the plan charges $1.00 per unit. */
  quantity: number;
  /** Our Gift id, echoed back on every recurring payment. */
  customId: string;
  donorName: string;
  donorEmail: string;
  returnUrl: string;
  cancelUrl: string;
}): Promise<Subscription> {
  const { planId, quantity, customId, donorName, donorEmail, returnUrl, cancelUrl } = options;

  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError(`Monthly giving must be a whole number of dollars, got ${quantity}`);
  }

  const [given, ...rest] = donorName.split(' ');

  return paypal.post<Subscription>(
    '/v1/billing/subscriptions',
    {
      plan_id: planId,
      quantity: String(quantity),
      custom_id: customId,
      subscriber: {
        email_address: donorEmail,
        name: { given_name: given ?? donorName, surname: rest.join(' ') || given || donorName },
      },
      application_context: {
        shipping_preference: 'NO_SHIPPING',
        user_action: 'SUBSCRIBE_NOW',
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    },
    `subscription-${customId}`,
  );
}

export function getSubscription(subscriptionId: string): Promise<Subscription> {
  return paypal.get<Subscription>(
    `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
  );
}

export async function cancelSubscription(subscriptionId: string, reason: string): Promise<void> {
  await paypal.post<void>(
    `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
    { reason: reason.slice(0, 127) },
  );
}
