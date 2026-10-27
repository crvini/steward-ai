import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  api,
  formatCents,
  type ChurchResponse,
  type GiftRow,
  type Receipt,
  type RolesResponse,
  type SessionUser,
} from './api';
import { GiveCard } from './GiveCard';
import { GiftsTable } from './GiftsTable';
import { GiftReceipt } from './GiftReceipt';
import { RoleChooser } from './RoleChooser';
import { DemoBanner } from './DemoBanner';
import { Distributions } from './Distributions';
import { LedgerGrid } from './LedgerGrid';

/** Survives a reload so a refreshed receipt is not lost. */
const LAST_GIFT_KEY = 'steward:lastGiftId';

export default function App() {
  const { t, i18n } = useTranslation();

  const [user, setUser] = useState<SessionUser | null>(null);
  const [roles, setRoles] = useState<RolesResponse | null>(null);
  const [church, setChurch] = useState<ChurchResponse | null>(null);
  const [gifts, setGifts] = useState<GiftRow[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const [booted, setBooted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadChurch = useCallback(async () => {
    const [churchData, giftData] = await Promise.all([api.church(), api.gifts()]);
    setChurch(churchData);
    setGifts(giftData.gifts);
  }, []);

  const showReceipt = useCallback(async (giftId: string) => {
    try {
      setReceipt(await api.receipt(giftId));
      sessionStorage.setItem(LAST_GIFT_KEY, giftId);
    } catch {
      // A receipt we cannot load is not worth blocking the page over.
      sessionStorage.removeItem(LAST_GIFT_KEY);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [{ user: current }, roleData] = await Promise.all([api.session(), api.roles()]);
        setRoles(roleData);
        setUser(current);
        if (current) {
          await loadChurch();
          const last = sessionStorage.getItem(LAST_GIFT_KEY);
          if (last) await showReceipt(last);
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBooted(true);
      }
    })();
  }, [loadChurch, showReceipt]);

  const signIn = async (picked: SessionUser) => {
    setSigningIn(picked.id);
    setError(null);
    try {
      const { user: signed } = await api.signIn(picked.id);
      setUser(signed);
      await i18n.changeLanguage(signed.locale);
      await loadChurch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSigningIn(null);
    }
  };

  const switchTo = async (userId: string) => {
    sessionStorage.removeItem(LAST_GIFT_KEY);
    setReceipt(null);
    const target = roles?.users.find((u) => u.id === userId);
    if (target) await signIn(target);
  };

  const signOut = async () => {
    await api.signOut();
    sessionStorage.removeItem(LAST_GIFT_KEY);
    setUser(null);
    setReceipt(null);
  };

  if (!booted) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-neutral-500">
        {t('app.loading')}
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-neutral-50 text-neutral-900">
        <DemoBanner />
        {error && (
          <p className="mx-auto mt-4 max-w-2xl rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        )}
        {roles && <RoleChooser roles={roles} onPick={signIn} busyId={signingIn} />}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <DemoBanner />

      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{t('app.name')}</h1>
            <p className="text-xs text-neutral-500">{church?.church.name ?? '…'}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Switching role is the fastest way to show two-key approval. */}
            <label className="flex items-center gap-2 text-xs text-neutral-600">
              <span>{t('header.viewingAs')}</span>
              <select
                value={user.id}
                onChange={(e) => void switchTo(e.target.value)}
                className="rounded border border-neutral-300 px-2 py-1 text-xs"
              >
                {roles?.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {t(`role.${u.role}`)}
                  </option>
                ))}
              </select>
            </label>

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

            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-medium"
            >
              {t('header.exit')}
            </button>
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

            {/* El tesorero y el pastor trabajan sobre repartos; el miembro da. */}
            {user.role === 'DONOR' ? (
              receipt ? (
                <GiftReceipt
                  receipt={receipt}
                  onGiveAgain={() => {
                    sessionStorage.removeItem(LAST_GIFT_KEY);
                    setReceipt(null);
                  }}
                />
              ) : (
                <GiveCard
                  church={church}
                  user={user}
                  onGiftCaptured={(giftId) => {
                    void showReceipt(giftId);
                    void loadChurch();
                  }}
                />
              )
            ) : (
              <>
                <Distributions church={church} user={user} onChanged={() => void loadChurch()} />
                <LedgerGrid locale={i18n.language} />
              </>
            )}

            {user.role === 'DONOR' && (
              <section>
                <h2 className="mb-3 text-xl font-semibold">{t('table.title')}</h2>
                <GiftsTable gifts={gifts} />
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
