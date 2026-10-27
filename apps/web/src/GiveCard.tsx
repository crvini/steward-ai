/**
 * One-time giving with the PayPal JS SDK v6.
 *
 * Flow: pick donor, fund and amount -> click the PayPal button -> our server
 * creates the order -> PayPal checkout -> our server captures it. The browser
 * only ever holds an order id.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, formatCents, type ChurchResponse, type SessionUser } from './api';
import type { PayPalSdkInstance } from './types/paypal';

const PRESET_AMOUNTS = [25, 50, 100, 250];

type Status =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'ineligible' }
  | { kind: 'error'; message: string };

/**
 * Resolves once the v6 script has put `paypal` on window.
 *
 * The documented signal is the `paypal-web-sdk-loaded` event, but it does not
 * reliably reach `window`: the async script often finishes before React mounts,
 * and in that race the listener is attached after the event has already been
 * dispatched, so it never fires and the card hangs on "loading" forever.
 * Polling the global is the only signal that cannot be missed, so the event is
 * kept purely as a fast path and the poll is what guarantees progress.
 */
const SDK_POLL_INTERVAL_MS = 50;

function whenSdkLoaded(): Promise<void> {
  if (window.paypal) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      window.removeEventListener('paypal-web-sdk-loaded', finish);
      resolve();
    };

    const poll = setInterval(() => {
      if (window.paypal) finish();
    }, SDK_POLL_INTERVAL_MS);

    window.addEventListener('paypal-web-sdk-loaded', finish, { once: true });
  });
}

/** Rejects instead of hanging forever when a PayPal call never settles. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

type Bootstrap = { sdk: PayPalSdkInstance; eligible: boolean };

/**
 * `createInstance` and `findEligibleMethods` each tolerate exactly one call per
 * page session — a concurrent second call never settles, which left the card
 * stuck on "loading" with no error. StrictMode invokes every effect twice in
 * development, so the whole bootstrap is memoized as a single promise that both
 * invocations share. Only a page reload gets a fresh one.
 */
let bootstrapPromise: Promise<Bootstrap> | null = null;

const BOOTSTRAP_TIMEOUT_MS = 20_000;

function bootstrapPayPal(currencyCode: string): Promise<Bootstrap> {
  const t0 = performance.now();
  const mark = (stage: string) => {
    if (import.meta.env.DEV) console.log(`[paypal] ${stage} +${Math.round(performance.now() - t0)}ms`);
  };

  bootstrapPromise ??= withTimeout(
    (async (): Promise<Bootstrap> => {
      mark('bootstrap:start');
      await whenSdkLoaded();
      mark('script:loaded');
      if (!window.paypal) throw new Error('PayPal SDK script loaded but exposed no global');

      const { clientToken } = await api.clientToken();
      mark('token:received');
      const sdk = await window.paypal.createInstance({
        clientToken,
        components: ['paypal-payments'],
        pageType: 'checkout',
      });
      mark('instance:created');

      const methods = await sdk.findEligibleMethods({ currencyCode });
      mark('eligibility:resolved');
      return { sdk, eligible: methods.isEligible('paypal') };
    })(),
    BOOTSTRAP_TIMEOUT_MS,
    'PayPal setup',
  ).catch((error: unknown) => {
    // Clear the memo so a reload can start clean. Retrying in place would call
    // createInstance a second time on the same page session, which hangs.
    bootstrapPromise = null;
    throw error;
  });

  return bootstrapPromise;
}

export function GiveCard({
  church,
  user,
  onGiftCaptured,
}: {
  church: ChurchResponse;
  user: SessionUser;
  onGiftCaptured: (giftId: string) => void;
}) {
  const { t } = useTranslation();
  const [fundId, setFundId] = useState(church.funds[0]?.id ?? '');
  const [amount, setAmount] = useState(50);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [result, setResult] = useState<string | null>(null);
  // The capture is a round trip to PayPal and takes a second or two. Without
  // this the popup just closes and nothing visibly happens.
  const [capturing, setCapturing] = useState(false);

  const buttonRef = useRef<HTMLElement | null>(null);
  const sdkRef = useRef<PayPalSdkInstance | null>(null);
  // The click handler must read the latest selections, but the PayPal session is
  // created once — a ref keeps the handler from going stale.
  const selection = useRef({ fundId, amount });
  selection.current = { fundId, amount };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { sdk, eligible } = await bootstrapPayPal(church.church.currency);
        if (cancelled) return;
        sdkRef.current = sdk;
        setStatus(eligible ? { kind: 'ready' } : { kind: 'ineligible' });
      } catch (error) {
        if (!cancelled) {
          setStatus({ kind: 'error', message: (error as Error).message });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [church.church.currency]);

  useEffect(() => {
    const sdk = sdkRef.current;
    const button = buttonRef.current;
    if (status.kind !== 'ready' || !sdk || !button) return;

    const session = sdk.createPayPalOneTimePaymentSession({
      async onApprove(data) {
        setCapturing(true);
        setResult(null);
        try {
          const captured = await api.captureGift(data.orderId);
          onGiftCaptured(captured.giftId);
        } catch (error) {
          setResult(t('give.failed', { message: (error as Error).message }));
        } finally {
          setCapturing(false);
        }
      },
      onCancel() {
        setCapturing(false);
        setResult(t('give.cancelled'));
      },
      onError(error) {
        setCapturing(false);
        setResult(t('give.failed', { message: String(error) }));
      },
    });

    const handleClick = () => {
      setResult(null);
      const { fundId: f, amount: a } = selection.current;
      const order = api
        .createGift({ fundId: f, amountCents: Math.round(a * 100) })
        .then(({ orderId }) => ({ orderId }));

      // v6 wants the promise itself, so the checkout opens inside the click gesture.
      void session.start({ presentationMode: 'auto' }, order);
    };

    button.addEventListener('click', handleClick);
    return () => button.removeEventListener('click', handleClick);
  }, [status.kind, t, onGiftCaptured]);

  const selectedFund = church.funds.find((f) => f.id === fundId);

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold">{t('give.title')}</h2>
      <p className="mt-1 text-sm text-neutral-600">{t('give.subtitle')}</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('give.donor')}</span>
          <p className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-neutral-700">
            {user.name}
          </p>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('give.fund')}</span>
          <select
            value={fundId}
            onChange={(e) => setFundId(e.target.value)}
            className="rounded border border-neutral-300 px-3 py-2"
          >
            {church.funds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedFund?.description && (
        <p className="mt-2 text-xs text-neutral-500">{selectedFund.description}</p>
      )}

      <div className="mt-5">
        <span className="text-sm font-medium">{t('give.amount')}</span>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {PRESET_AMOUNTS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setAmount(preset)}
              className={`rounded-full border px-4 py-1.5 text-sm ${
                amount === preset
                  ? 'border-blue-600 bg-blue-50 font-semibold text-blue-700'
                  : 'border-neutral-300'
              }`}
            >
              {formatCents(preset * 100)}
            </button>
          ))}
          <input
            type="number"
            min="1"
            step="1"
            value={amount}
            onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 0))}
            className="w-28 rounded border border-neutral-300 px-3 py-1.5 text-sm"
            aria-label={t('give.amount')}
          />
        </div>
      </div>

      <div className="mt-6">
        {status.kind === 'loading' && (
          <p className="text-sm text-neutral-500">{t('give.loadingSdk')}</p>
        )}
        {status.kind === 'ineligible' && (
          <p className="text-sm text-amber-700">{t('give.ineligible')}</p>
        )}
        {status.kind === 'error' && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-red-700">{t('give.failed', { message: status.message })}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium"
            >
              {t('give.retry')}
            </button>
          </div>
        )}
        <paypal-button
          ref={buttonRef}
          type="pay"
          style={{ display: status.kind === 'ready' ? 'block' : 'none', maxWidth: '20rem' }}
        />
      </div>

      {capturing && (
        <p className="mt-4 flex items-center gap-2 text-sm font-medium text-neutral-700">
          <span
            aria-hidden="true"
            className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700"
          />
          {t('give.capturing')}
        </p>
      )}

      {!capturing && result && <p className="mt-4 text-sm font-medium">{result}</p>}
    </section>
  );
}
