import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  api,
  formatCents,
  type ChurchResponse,
  type DistributionRow,
  type GiftRow,
  type Receipt,
  type RolesResponse,
  type SessionUser,
} from './api';
import { GiveCard } from './GiveCard';
import { GiftsTable } from './GiftsTable';
import { GiftReceipt } from './GiftReceipt';
import { RoleChooser } from './RoleChooser';
import { Distributions } from './Distributions';
import { LedgerGrid } from './LedgerGrid';
import { MyImpact } from './MyImpact';
import { ImpactReview } from './ImpactReview';
import { AiActivity } from './AiActivity';
import { PastorWeek } from './PastorWeek';
import { Audit } from './Audit';
import { TopBar, TABS_BY_ROLE } from './TopBar';
import { FundThread } from './FundThread';
import { Card } from './ui';

/** Survives a reload so a refreshed receipt is not lost. */
const LAST_GIFT_KEY = 'steward:lastGiftId';

/** The fund cards that sit above every signed-in screen. */
function FundStrip({ church }: { church: ChurchResponse }) {
  const { t, i18n } = useTranslation();
  const money = (c: number) => formatCents(c, church.church.currency, i18n.language);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {church.funds.map((fund) => (
        <Card key={fund.id} className="p-4">
          <p className="text-sm font-semibold">{fund.name}</p>
          <p className="amount mt-1 text-2xl">{money(fund.balanceCents)}</p>
          <FundThread
            slug={fund.slug}
            progress={fund.goalCents ? fund.balanceCents / fund.goalCents : undefined}
            className="mt-2.5"
            label={fund.name}
          />
          <p className="mt-2 text-xs text-ink-muted">
            {fund.goalCents
              ? t('fund.ofGoal', {
                  percent: Math.round((fund.balanceCents / fund.goalCents) * 100),
                  goal: money(fund.goalCents),
                })
              : t('fund.readyToDistribute')}
          </p>
        </Card>
      ))}
    </div>
  );
}

export default function App() {
  const { t, i18n } = useTranslation();

  const [user, setUser] = useState<SessionUser | null>(null);
  const [roles, setRoles] = useState<RolesResponse | null>(null);
  const [church, setChurch] = useState<ChurchResponse | null>(null);
  const [gifts, setGifts] = useState<GiftRow[]>([]);
  const [distributions, setDistributions] = useState<DistributionRow[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [tab, setTab] = useState<string>('give');
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const [booted, setBooted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadChurch = useCallback(async () => {
    const [churchData, giftData] = await Promise.all([api.church(), api.gifts()]);
    setChurch(churchData);
    setGifts(giftData.gifts);
    // Only the treasurer and pastor may read these; for a donor it is a 403
    // and that is not an error worth showing.
    setDistributions(await api.distributions().then((d) => d.distributions).catch(() => []));
  }, []);

  const showReceipt = useCallback(async (giftId: string) => {
    try {
      setReceipt(await api.receipt(giftId));
      sessionStorage.setItem(LAST_GIFT_KEY, giftId);
    } catch {
      sessionStorage.removeItem(LAST_GIFT_KEY);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [{ user: current }, roleData, churchData] = await Promise.all([
          api.session(),
          api.roles(),
          api.church(),
        ]);
        setRoles(roleData);
        setChurch(churchData);
        setUser(current);
        if (current) {
          setTab(TABS_BY_ROLE[current.role][0]!);
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
      setTab(TABS_BY_ROLE[signed.role][0]!);
      await i18n.changeLanguage(signed.locale);
      await loadChurch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSigningIn(null);
    }
  };

  if (!booted) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-ink-muted">
        {t('app.loading')}
      </div>
    );
  }

  if (!user) {
    return (
      <>
        {error && (
          <p className="bg-fund-missions/10 px-6 py-3 text-center text-sm text-fund-missions">
            {error}
          </p>
        )}
        {roles && (
          <RoleChooser roles={roles} church={church} onPick={signIn} busyId={signingIn} />
        )}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-surface-alt text-navy-900">
      <TopBar
        churchName={church?.church.name ?? ''}
        user={user}
        users={roles?.users ?? []}
        tab={tab}
        onTab={setTab}
        onSwitchUser={(id) => {
          sessionStorage.removeItem(LAST_GIFT_KEY);
          setReceipt(null);
          const target = roles?.users.find((u) => u.id === id);
          if (target) void signIn(target);
        }}
        onSignOut={() => {
          void api.signOut();
          sessionStorage.removeItem(LAST_GIFT_KEY);
          setUser(null);
          setReceipt(null);
        }}
      />

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-7">
        {error && (
          <p className="rounded-xl border border-fund-missions/30 bg-fund-missions/5 px-4 py-3 text-sm text-fund-missions">
            {error}
          </p>
        )}

        {church && <FundStrip church={church} />}

        {church && tab === 'give' && (
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
        )}

        {tab === 'impact' && <MyImpact />}

        {tab === 'gifts' && (
          <section>
            <h2 className="mb-3 font-display text-xl font-bold">{t('table.title')}</h2>
            <GiftsTable gifts={gifts} />
          </section>
        )}

        {church && tab === 'week' && (
          <PastorWeek user={user} currency={church.church.currency} />
        )}

        {church && (tab === 'distributions' || tab === 'approvals') && (
          <Distributions church={church} user={user} onChanged={() => void loadChurch()} />
        )}

        {tab === 'impactDrafts' && <ImpactReview distributions={distributions} />}

        {tab === 'books' && <LedgerGrid locale={i18n.language} />}

        {church && tab === 'audit' && <Audit currency={church.church.currency} />}

        {tab === 'aiActivity' && <AiActivity />}
      </main>
    </div>
  );
}
