/** Thin typed wrapper over the API. Vite proxies /api to the Express server. */

export type Fund = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  balanceCents: number;
};

export type Donor = { id: string; name: string; locale: string };

export type Role = 'DONOR' | 'TREASURER' | 'PASTOR';

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  locale: string;
};

export type RolesResponse = {
  church: { id: string; name: string };
  featured: SessionUser[];
  users: SessionUser[];
};

export type SubscriptionRow = {
  id: string;
  fund: string;
  fundSlug: string;
  amountCents: number;
  currency: string;
  status: string;
  subscriptionId: string | null;
  chargesSoFar: number;
  givenSoFarCents: number;
  createdAt: string;
};

export type Receipt = {
  id: string;
  donor: string;
  fund: string;
  fundSlug: string;
  fundBalanceCents: number;
  amountCents: number;
  currency: string;
  frequency: 'ONE_TIME' | 'MONTHLY';
  status: string;
  captureId: string | null;
  feeCents: number | null;
  netCents: number | null;
  occurredAt: string;
};

export type ChurchResponse = {
  church: { id: string; name: string; currency: string };
  funds: Fund[];
  donors: Donor[];
};

export type GiftRow = {
  id: string;
  donor: string;
  fund: string;
  fundSlug: string;
  amountCents: number;
  currency: string;
  frequency: 'ONE_TIME' | 'MONTHLY';
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  paypalOrderId: string | null;
  createdAt: string;
};

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    // The demo session rides in a cookie; without this it is never sent.
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  church: () => json<ChurchResponse>('/api/church'),
  clientToken: () => json<{ clientToken: string }>('/api/paypal/client-token'),
  gifts: () => json<{ gifts: GiftRow[] }>('/api/gifts'),
  // The donor is taken from the signed session, never sent by the browser.
  createGift: (body: { fundId: string; amountCents: number }) =>
    json<{ giftId: string; orderId: string }>('/api/gifts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  receipt: (giftId: string) => json<Receipt>(`/api/gifts/${encodeURIComponent(giftId)}`),
  createSubscription: (body: { fundId: string; amountDollars: number }) =>
    json<{ giftId: string; subscriptionId: string }>('/api/subscriptions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  confirmSubscription: (subscriptionId: string) =>
    json<{ giftId: string; status: string; nextBillingTime: string | null }>(
      `/api/subscriptions/${encodeURIComponent(subscriptionId)}/confirm`,
      { method: 'POST' },
    ),
  cancelSubscription: (subscriptionId: string) =>
    json<{ giftId: string; status: string }>(
      `/api/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
      { method: 'POST' },
    ),
  subscriptions: () => json<{ subscriptions: SubscriptionRow[] }>('/api/subscriptions'),
  roles: () => json<RolesResponse>('/api/session/roles'),
  session: () => json<{ user: SessionUser | null }>('/api/session'),
  signIn: (userId: string) =>
    json<{ user: SessionUser }>('/api/session', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),
  signOut: () => json<{ user: null }>('/api/session', { method: 'DELETE' }),
  captureGift: (orderId: string) =>
    json<{ giftId: string; status: string; captureId?: string }>(
      `/api/gifts/${encodeURIComponent(orderId)}/capture`,
      { method: 'POST' },
    ),
};

export const formatCents = (cents: number, currency = 'USD', locale = 'en-US') =>
  (cents / 100).toLocaleString(locale, { style: 'currency', currency });
