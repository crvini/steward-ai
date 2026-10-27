/** Thin typed wrapper over the API. Vite proxies /api to the Express server. */

export type Fund = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  balanceCents: number;
};

export type Donor = { id: string; name: string; locale: string };

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
  createGift: (body: { donorId: string; fundId: string; amountCents: number }) =>
    json<{ giftId: string; orderId: string }>('/api/gifts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  captureGift: (orderId: string) =>
    json<{ giftId: string; status: string; captureId?: string }>(
      `/api/gifts/${encodeURIComponent(orderId)}/capture`,
      { method: 'POST' },
    ),
};

export const formatCents = (cents: number, currency = 'USD', locale = 'en-US') =>
  (cents / 100).toLocaleString(locale, { style: 'currency', currency });
