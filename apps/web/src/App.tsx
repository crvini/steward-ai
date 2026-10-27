import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, formatCents, type ChurchResponse, type GiftRow } from './api';
import { GiveCard } from './GiveCard';
import { GiftsTable } from './GiftsTable';

export default function App() {
  const { t, i18n } = useTranslation();
  const [church, setChurch] = useState<ChurchResponse | null>(null);
  const [gifts, setGifts] = useState<GiftRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [churchData, giftData] = await Promise.all([api.church(), api.gifts()]);
      setChurch(churchData);
      setGifts(giftData.gifts);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{t('app.name')}</h1>
            <p className="text-xs text-neutral-500">{church?.church.name ?? '…'}</p>
          </div>
          <div className="flex gap-1">
            {(['en', 'es'] as const).map((lng) => (
              <button
                key={lng}
                type="button"
                onClick={() => void i18n.changeLanguage(lng)}
                className={`rounded px-2.5 py-1 text-xs font-medium uppercase ${
                  i18n.resolvedLanguage === lng
                    ? 'bg-neutral-900 text-white'
                    : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                {lng}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-8">
        <p className="text-neutral-600">{t('app.tagline')}</p>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        )}

        {church && (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {church.funds.map((fund) => (
                <div
                  key={fund.id}
                  className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm"
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    {fund.name}
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {formatCents(fund.balanceCents, church.church.currency, i18n.language)}
                  </p>
                </div>
              ))}
            </section>

            <GiveCard church={church} onGiftCaptured={() => void refresh()} />

            <section>
              <h2 className="mb-3 text-xl font-semibold">{t('table.title')}</h2>
              <GiftsTable gifts={gifts} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
