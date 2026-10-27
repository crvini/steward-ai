# Steward AI

[![CI](https://github.com/crvini/steward-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/crvini/steward-ai/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Generosity with transparency — from the moment someone gives to the moment they see the fruit.**

Steward AI is an AI generosity assistant for churches. Money comes in through PayPal,
gets distributed with human two-key approval, and every donor sees what their gift
accomplished. Built for the PayPal AI Hackathon 2026.

Small and mid-sized churches — especially in Latin America — run tithes, offerings and
designated funds on cash, loose transfers and spreadsheets. The treasurer loses hours
reconciling, money for missions or benevolence takes weeks to move, and donors almost
never learn what their gift did. Steward AI closes that loop.

## What makes it different

- **Designated fund accounting.** Every dollar knows which fund it belongs to, from
  intake to payout.
- **Two-key approval.** No distribution leaves without both the treasurer's and the
  pastor's signature.
- **Deterministic rules before PayPal.** The AI only *proposes*. Code validates amount
  limits, allowed recipients and fund balance. The AI can never approve or skip a rule.
- **Impact loop.** Donors get a personal report of what their gift accomplished, based
  on what was actually distributed.
- **Bilingual (EN/ES)** from day one.

## Getting started

> Work in progress — this section is completed as the project is built.

**Requirements:** Node 22+, pnpm 9+, Docker (for PostgreSQL).

```bash
# 1. Clone
git clone https://github.com/crvini/steward-ai.git
cd steward-ai

# 2. Configure environment
cp .env.example .env     # then fill in your PayPal sandbox and Anthropic keys

# 3. Install, start the database, migrate, seed and run
pnpm install
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The API runs on <http://localhost:4000> and the web app on <http://localhost:5173>.

The Postgres container publishes **port 5434** on the host, so `DATABASE_URL` must read:

```
DATABASE_URL=postgresql://steward:steward@localhost:5434/steward_ai?schema=public
```

### Checking the setup

`GET http://localhost:4000/health` verifies all three live dependencies and returns
`200` only when every one answers:

```json
{
  "status": "ok",
  "services": {
    "database":  { "ok": true, "detail": "PostgreSQL 16.14 …, 4 funds seeded" },
    "paypal":    { "ok": true, "detail": "OAuth token issued (sandbox)" },
    "anthropic": { "ok": true, "detail": "models reachable: …" }
  }
}
```

It never returns a key, a token, or any part of one.

### Trying a one-time gift

Open <http://localhost:5173>, pick a donor, a fund and an amount, then click the PayPal
button. The server creates the order (Orders API v2), PayPal checkout opens, and on
approval the server captures it and writes a `Gift` plus an `IN` `Transaction`. Sign in
at the checkout with a **PayPal sandbox Personal account** from your developer dashboard
— never a live account.

## How we use PayPal

Everything below is wired to the live PayPal sandbox — no mocks, no stubs.

| PayPal product | Where it runs | What it does here |
|---|---|---|
| **JavaScript SDK v6** | `apps/web/src/GiveCard.tsx` | `createInstance` + `createPayPalOneTimePaymentSession` behind a `<paypal-button>`. The browser only ever holds an order id. |
| **OAuth 2.0 client credentials** | `apps/api/src/paypal/client.ts` | Server token cached and refreshed 60s early, one retry on `401`, exponential backoff on `429`/`5xx`. |
| **Browser-safe client token** | `GET /api/paypal/client-token` | `response_type=client_token`, domain-bound and short-lived, so `PAYPAL_CLIENT_SECRET` never reaches the browser. |
| **Orders API v2 — create** | `POST /api/gifts` | Server-side, with the Gift id as `custom_id` **and** as the `PayPal-Request-Id` idempotency key, so a retried create cannot double-charge. |
| **Orders API v2 — capture** | `POST /api/gifts/:orderId/capture` | Server-side. Persists the capture id, `paypal_fee`, `net_amount` and payer identity, plus the verbatim payload. |
| **Catalog Products + Billing Plans** | `apps/api/src/paypal/subscriptions.ts` | One plan per fund at **$1.00 per unit** with `quantity_supported`, created on demand and remembered, so any monthly amount works without a plan per amount. |
| **Subscriptions API v1** | `POST /api/subscriptions` | Monthly giving. The donor's dollars ride in `quantity`; the Gift id is the `custom_id` echoed on every recurring charge. |
| **Webhooks** | `POST /api/webhooks/paypal` | Mounted ahead of the JSON body parser so signature verification sees PayPal's exact bytes. |
| **Webhook signature verification** | `apps/api/src/paypal/webhooks.ts` | Every notification goes through `verify-webhook-signature`. `cert_url` is checked against PayPal hosts first, so a forged header cannot redirect the certificate lookup. |
| **Transaction Search** | `GET /api/paypal/reconcile?days=30` | Compares PayPal's own record against our ledger and reports anything we never wrote down. Respects the 31-day cap and the no-fractional-seconds rule. |

Webhook events handled: `PAYMENT.CAPTURE.COMPLETED`, `BILLING.SUBSCRIPTION.ACTIVATED`,
`BILLING.SUBSCRIPTION.CANCELLED` / `EXPIRED` / `SUSPENDED`, and `PAYMENT.SALE.COMPLETED`
(each monthly charge, recorded as its own ledger row against the same gift).

Still to come, per [`docs/SPEC.md`](docs/SPEC.md) §4: Payouts API for distributions,
and the PayPal Agent Toolkit behind the two-key approval gate.

**One honest limitation:** PayPal billing plans carry a fixed price, so monthly
giving is expressed as `quantity` × $1.00 and therefore only supports whole
dollars. The API rejects cents on a monthly gift rather than quietly rounding.

### How money is kept honest

- **Integer cents everywhere.** The database never stores a float. Conversion to and
  from PayPal's decimal strings happens in exactly one module, `apps/api/src/money.ts`,
  which is unit-tested on both directions including the classic `0.1 + 0.2` case.
- **One writer, two legs.** The inline capture call and the `PAYMENT.CAPTURE.COMPLETED`
  webhook both record through `apps/api/src/gifts/record.ts`. Whichever arrives first
  wins; the other is a no-op. A unique index on `(direction, paypalRef)` is the backstop.
- **Replay-proof webhooks.** A unique index on `WebhookEvent.paypalEventId` makes a
  redelivery a no-op. Unverified events are still stored — for forensics — but never
  acted on.
- **Audited.** Every order creation and capture writes an `AuditLog` row with actor,
  action and amounts.

## How we use AI

> To be completed — see [`docs/SPEC.md`](docs/SPEC.md) §5.

## License

[MIT](LICENSE) © E-Ministry / Vinicio Cruz
