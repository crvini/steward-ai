/**
 * One-time giving with the PayPal JS SDK v6.
 *
 * Flow: pick donor, fund and amount -> click the PayPal button -> our server
 * creates the order -> PayPal checkout -> our server captures it. The browser
 * only ever holds an order id.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, formatCents, type ChurchResponse } from './api';
import type { PayPalSdkInstance } from './types/paypal';

const PRESET_AMOUNTS = [25, 50, 100, 250];

type Status =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'ineligible' }
  | { kind: 'error'; message: string };

/** Resolves once the v6 script has put `paypal` on window. */
function whenSdkLoaded(): Promise<void> {
  if (window.paypal) return Promise.resolve();
  return new Promise((resolve) => {
    window.addEventListener('paypal-web-sdk-loaded', () => resolve(), { once: true });
  });
}

/**
 * `createInstance` tolerates exactly one call per page session — a second one
 * never settles. StrictMode mounts every effect twice in development, so the
 * instance is memoized here rather than created inside the effect.
 */
let sdkInstancePromise: Promise<PayPalSdkInstance> | null = null;

function getSdkInstance(): Promise<PayPalSdkInstance> {
  sdkInstancePromise ??= (async () => {
    await whenSdkLoaded();
    if (!window.paypal) throw new Error('PayPal SDK failed to load');

    const { clientToken } = await api.clientToken();
    return window.paypal.createInstance({
      clientToken,
      components: ['paypal-payments'],
      pageType: 'checkout',
    });
  })().catch((error: unknown) => {
    // Let a later mount retry instead of caching the failure forever.
    sdkInstancePromise = null;
    throw error;
  });

  return sdkInstancePromise;
}

export function GiveCard({
  church,
  onGiftCaptured,
}: {
  church: ChurchResponse;
  onGiftCaptured: () => void;
}) {
  const { t } = useTranslation();
  const [donorId, setDonorId] = useState(church.donors[0]?.id ?? '');
  const [fundId, setFundId] = useState(church.funds[0]?.id ?? '');
  const [amount, setAmount] = useState(50);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [result, setResult] = useState<string | null>(null);

  const buttonRef = useRef<HTMLElement | null>(null);
  const sdkRef = useRef<PayPalSdkInstance | null>(null);
  // The click handler must read the latest selections, but the PayPal session is
  // created once — a ref keeps the handler from going stale.
  const selection = useRef({ donorId, fundId, amount });
  selection.current = { donorId, fundId, amount };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const sdk = await getSdkInstance();
        if (cancelled) return;
        sdkRef.current = sdk;

        const methods = await sdk.findEligibleMethods({ currencyCode: church.church.currency });
        if (cancelled) return;
        setStatus(methods.isEligible('paypal') ? { kind: 'ready' } : { kind: 'ineligible' });
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
        try {
          const captured = await api.captureGift(data.orderId);
          setResult(t('give.captured', { id: captured.captureId ?? captured.giftId }));
          onGiftCaptured();
        } catch (error) {
          setResult(t('give.failed', { message: (error as Error).message }));
        }
      },
      onCancel() {
        setResult(t('give.cancelled'));
      },
      onError(error) {
        setResult(t('give.failed', { message: String(error) }));
      },
    });

    const handleClick = () => {
      setResult(null);
      const { donorId: d, fundId: f, amount: a } = selection.current;
      const order = api
        .createGift({ donorId: d, fundId: f, amountCents: Math.round(a * 100) })
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
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('give.donor')}</span>
          <select
            value={donorId}
            onChange={(e) => setDonorId(e.target.value)}
            className="rounded border border-neutral-300 px-3 py-2"
          >
            {church.donors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>

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
          <p className="text-sm text-red-700">{t('give.failed', { message: status.message })}</p>
        )}
        <paypal-button
          ref={buttonRef}
          type="pay"
          style={{ display: status.kind === 'ready' ? 'block' : 'none', maxWidth: '20rem' }}
        />
      </div>

      {result && <p className="mt-4 text-sm font-medium">{result}</p>}
    </section>
  );
}
