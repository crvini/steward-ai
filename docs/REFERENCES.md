# Integration references

What we studied before writing the PayPal integration, and what we took from it.
Nothing here is copied code — these are the patterns we adopted, re-implemented
against our own stack (Express + Prisma + React/Vite + Anthropic).

## `paypaldev/hackathon-paypal-ag-grid-boilerplate`

Reviewed 2026-10-26. The official PayPal hackathon template.

**Stack mismatch (so we did not adopt it):** Next.js 15 App Router with server
components, OpenAI for the AI layer, AG Studio for the dashboard. Our spec calls for
Express + React/Vite and Anthropic, so we only took integration patterns.

### PayPal patterns we adopted (`lib/paypal.ts`)

| Pattern | Why we took it |
|---|---|
| Plain `fetch` REST client, no PayPal server SDK | Fewer dependencies, and the REST surface is what the docs document. |
| Module-level cached OAuth token, refreshed 60s before `expires_in` | An in-flight request never carries an expired token. |
| On `401`, drop the cached token and retry once | Survives a revoked token without failing the user's request. |
| On `429` or `5xx`, exponential backoff (`2^attempt * 250ms`, 4 attempts) | PayPal sandbox rate-limits and flakes. |
| Typed `PayPalApiError(status, path, truncatedBody)` | Errors stay debuggable without dumping full payloads into logs. |
| Pagination helper that follows `total_pages` | Transaction Search and invoice listing both need it. |
| Amounts travel as decimal strings (`{ value, currency_code }`) | Never let a float round a donation. We store cents as integers. |
| Transaction Search: max 31-day ranges, no fractional seconds in timestamps | Hard API constraints; matters for the reconciliation view (spec §4). |

### AG Grid patterns we adopted (`app/(endpoints)/data-grid.tsx`)

- AG Grid v33+ **modular registration** — import only the modules used
  (`ClientSideRowModelModule`, `TextFilterModule`, `NumberFilterModule`,
  `DateFilterModule`, `QuickFilterModule`, `ColumnAutoSizeModule`) instead of the
  all-modules bundle.
- The **Theming API** (`themeQuartz.withParams({...})`) driven by CSS custom
  properties — no legacy `ag-grid.css` / `ag-theme-*.css` imports.
- `columnTypes` for money and `cellDataType: 'dateString' | 'dateTimeString'` for
  dates, so column definitions stay plain serializable data.
- `enableDevValidations()` in development only.

## PayPal JavaScript SDK v6

Reviewed 2026-10-26 — <https://developer.paypal.com/sdk/js/set-up>.

v6 differs enough from v5 that the old `paypal.Buttons({...}).render()` pattern does
not apply.

- **Script:** `https://www.sandbox.paypal.com/web-sdk/v6/core` (sandbox) /
  `https://www.paypal.com/web-sdk/v6/core` (live). It fires a
  `paypal-web-sdk-loaded` window event when ready.
- **Browser-safe client token:** minted server-side with
  `POST /v1/oauth2/token` using Basic auth and
  `grant_type=client_credentials&response_type=client_token`. The browser never sees
  `PAYPAL_CLIENT_SECRET`. We expose it at `GET /api/paypal/client-token`.
- **Instance:** `await window.paypal.createInstance({ clientToken, components: ['paypal-payments'], pageType: 'checkout' })`.
- **Eligibility:** `await sdkInstance.findEligibleMethods({ currencyCode: 'USD' })`,
  then `paymentMethods.isEligible('paypal')`.
- **Session:** `sdkInstance.createPayPalOneTimePaymentSession({ onApprove, onCancel, onError })`,
  rendered through the `<paypal-button>` custom element, started on click with
  `session.start({ presentationMode: 'auto' }, createOrderPromise)`.
- **Important shape change:** the promise passed to `start()` must resolve to
  `{ orderId }` — not the full order object v5 expected.
- Order **create** and **capture** both happen on our server (Orders API v2), per
  spec §4.
