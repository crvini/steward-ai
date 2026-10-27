/** Thin typed wrapper over the API. Vite proxies /api to the Express server. */

export type Fund = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  /** Null for a fund that runs continuously, like the general tithe. */
  goalCents: number | null;
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

export type RuleViolation = { code: string; detail: string };

export type CheckedLine = {
  recipientId: string;
  recipientName: string | null;
  amountCents: number;
  ok: boolean;
  violations: RuleViolation[];
};

export type RuleOutcome = {
  code: string;
  label: string;
  passed: boolean;
  detail?: string;
};

export type RulesVerdict = {
  lines: CheckedLine[];
  batchViolations: RuleViolation[];
  /** Every rule evaluated, passed or not. */
  checks: RuleOutcome[];
  payableCents: number;
  executable: boolean;
};

export type DistributionDetail = {
  id: string;
  fund: string;
  fundBalanceCents: number;
  status:
    | 'PROPOSED'
    | 'TREASURER_APPROVED'
    | 'APPROVED'
    | 'EXECUTED'
    | 'FAILED';
  aiRationale: string | null;
  treasurerApprovedBy: string | null;
  pastorApprovedBy: string | null;
  paypalBatchId: string | null;
  limits: Limits;
  verdict: RulesVerdict;
};

export type DistributionRow = {
  id: string;
  fund: string;
  status: DistributionDetail['status'];
  aiRationale: string | null;
  treasurerApprovedBy: string | null;
  pastorApprovedBy: string | null;
  totalCents: number;
  items: {
    id: string;
    recipient: string;
    amountCents: number;
    status: string;
    blockedReason: string | null;
  }[];
  createdAt: string;
  executedAt: string | null;
};

export type LedgerRow = {
  id: string;
  date: string;
  fund: string;
  fundSlug: string;
  direction: 'IN' | 'OUT';
  party: string;
  type: 'ONE_TIME' | 'MONTHLY' | null;
  /** False when the book has a row PayPal cannot confirm. */
  inPayPal: boolean;
  amount: number;
  fee: number | null;
  net: number | null;
  source: string;
  reference: string | null;
};

export type LedgerFilter = {
  fundSlug?: string;
  direction?: 'IN' | 'OUT';
  from?: string;
  to?: string;
  minAmountCents?: number;
};

export type ImpactUpdate = {
  id: string;
  donor?: string;
  fund: string;
  locale?: string;
  body: string;
  status?: string;
  createdAt?: string;
  sentAt?: string;
};

export type ActivityEntry = {
  id: string;
  at: string;
  actor: string;
  action: string;
  byAi: boolean;
  entity: string;
  entityId: string;
  payload: unknown;
};

export type MonthStats = {
  receivedCents: number;
  giftCount: number;
  givers: number;
  newGivers: number;
  monthlyGifts: number;
  recurringMonthlyCents: number;
  funds: { id: string; slug: string; name: string; goalCents: number | null; balanceCents: number }[];
  unconfirmed: { count: number; cents: number };
  limits: Limits;
  approvedRecipients: number;
};

export type WeeklyBrief = { body: string; weekOf: string; writtenAt: string };

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

export type Limits = { maxPerItemCents: number; maxPerBatchCents: number };

export type ChurchResponse = {
  church: { id: string; name: string; currency: string };
  /** Enforced by the rules engine; read, never hardcoded in the UI. */
  limits: Limits;
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
  activity: () => json<{ entries: ActivityEntry[] }>('/api/activity'),
  stats: () => json<MonthStats>('/api/stats'),
  brief: () => json<{ brief: WeeklyBrief | null }>('/api/brief'),
  writeBrief: () => json<{ brief: WeeklyBrief }>('/api/brief', { method: 'POST' }),
  ledger: () => json<{ rows: LedgerRow[] }>('/api/ledger'),
  draftImpact: (distributionId: string) =>
    json<{ drafted: number }>(`/api/impact/${encodeURIComponent(distributionId)}/draft`, {
      method: 'POST',
    }),
  impactReview: () => json<{ updates: ImpactUpdate[] }>('/api/impact/review'),
  approveImpact: (id: string, body?: string) =>
    json<{ id: string; status: string }>(`/api/impact/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      body: JSON.stringify(body === undefined ? {} : { body }),
    }),
  myImpact: () => json<{ updates: ImpactUpdate[] }>('/api/impact/mine'),
  askLedger: (question: string) =>
    json<{ filter: LedgerFilter; answer: string }>('/api/ledger/ask', {
      method: 'POST',
      body: JSON.stringify({ question }),
    }),
  distributions: () => json<{ distributions: DistributionRow[] }>('/api/distributions'),
  distribution: (id: string) =>
    json<DistributionDetail>(`/api/distributions/${encodeURIComponent(id)}`),
  proposeDistribution: (fundId: string) =>
    json<{ id: string }>('/api/distributions/propose', {
      method: 'POST',
      body: JSON.stringify({ fundId }),
    }),
  approveDistribution: (id: string) =>
    json<{ id: string; status: string }>(
      `/api/distributions/${encodeURIComponent(id)}/approve`,
      { method: 'POST' },
    ),
  rejectDistribution: (id: string, note: string) =>
    json<{ id: string; status: string }>(`/api/distributions/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),
  executeDistribution: (id: string) =>
    json<{ id: string; status: string; paypalBatchId?: string }>(
      `/api/distributions/${encodeURIComponent(id)}/execute`,
      { method: 'POST' },
    ),
  reviseDistribution: (id: string) =>
    json<DistributionDetail>(`/api/distributions/${encodeURIComponent(id)}/revise`, {
      method: 'POST',
    }),
  adjustDistribution: (id: string, lines: { recipientId: string; amountCents: number }[]) =>
    json<{ verdict: RulesVerdict }>(`/api/distributions/${encodeURIComponent(id)}/lines`, {
      method: 'PUT',
      body: JSON.stringify({ lines }),
    }),
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

export type GiftProposal = {
  fundId: string;
  fundName: string;
  amountCents: number;
  frequency: 'ONE_TIME' | 'MONTHLY';
};

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'proposal'; proposal: GiftProposal }
  | { type: 'done' }
  | { type: 'error'; message: string };

/**
 * Streams the giving agent's reply. Server-Sent Events over fetch rather than
 * EventSource, because EventSource cannot POST and the conversation has to go
 * in the body.
 */
export async function* streamGivingAgent(
  messages: { role: 'user' | 'assistant'; content: string }[],
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const res = await fetch('/api/ai/giving', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      retryAfterSeconds?: number;
    };
    yield {
      type: 'error',
      message:
        body.error === 'rate_limited'
          ? `rate_limited:${body.retryAfterSeconds ?? 0}`
          : (body.error ?? `HTTP ${res.status}`),
    };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    // SSE frames are separated by a blank line; a partial frame waits.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        yield JSON.parse(line.slice(6)) as AgentEvent;
      } catch {
        // A truncated frame is not worth killing the conversation over.
      }
    }
  }
}

export const formatCents = (cents: number, currency = 'USD', locale = 'en-US') =>
  (cents / 100).toLocaleString(locale, { style: 'currency', currency });

/**
 * Same amount without cents, for the at-a-glance tiles.
 *
 * A stat someone reads in half a second does not need two decimals, and in
 * Spanish "2.070,00 US$" is wide enough to get truncated in a narrow column —
 * which loses more information than dropping the cents does.
 */
export const formatCentsShort = (cents: number, currency = 'USD', locale = 'en-US') =>
  (cents / 100).toLocaleString(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  });
