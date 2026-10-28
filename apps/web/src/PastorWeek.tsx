/**
 * The pastor's week: what happened, what needs their key, and the rules they
 * set.
 *
 * The brief is written by the AI and says so, right under it, along with the
 * one thing that matters: nothing in it moves money. A summary that reads
 * like a decision is a summary that will eventually be mistaken for one.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  api,
  formatCents,
  formatCentsShort,
  type MonthStats,
  type SessionUser,
  type WeeklyBrief,
} from './api';
import { FundThread } from './FundThread';
import { Button, Card, Logo } from './ui';

export function PastorWeek({ user, currency }: { user: SessionUser; currency: string }) {
  const { t, i18n } = useTranslation();
  const [stats, setStats] = useState<MonthStats | null>(null);
  const [brief, setBrief] = useState<WeeklyBrief | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const money = (c: number) => formatCents(c, currency, i18n.language);
  const short = (c: number) => formatCentsShort(c, currency, i18n.language);

  useEffect(() => {
    void (async () => {
      try {
        const [s, b] = await Promise.all([api.stats(), api.brief()]);
        setStats(s);
        setBrief(b.brief);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const write = async () => {
    setBusy(true);
    setError(null);
    try {
      setBrief((await api.writeBrief(i18n.language)).brief);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const firstName = user.name.replace(/^Pastor\s+/i, '').split(' ')[0] ?? user.name;

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="font-display text-2xl font-extrabold">
            {t('pastor.greeting', { name: firstName })}
          </h2>
          <Button onClick={() => void write()} disabled={busy}>
            {busy ? t('pastor.writing') : brief ? t('pastor.rewrite') : t('pastor.write')}
          </Button>
        </div>

        {error && <p className="mt-3 text-sm text-fund-missions">{error}</p>}

        {brief ? (
          <>
            <p className="mt-4 text-base leading-relaxed">{brief.body}</p>
            <p className="mt-4 flex items-center gap-2 text-xs text-ink-muted">
              <Logo />
              {t('pastor.writtenBy', {
                when: new Date(brief.writtenAt).toLocaleString(i18n.language, {
                  weekday: 'long',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              })}
            </p>
          </>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">{t('pastor.noBrief')}</p>
        )}
      </Card>

      <aside className="flex min-w-0 flex-col gap-4">
        {stats && (
          <Card className="p-5">
            <h3 className="font-display text-lg font-bold">{t('pastor.monthSoFar')}</h3>

          {/* min-w-0 en cada celda: sin eso un monto ancho desborda su
              columna de la rejilla y se mete encima de la vecina. */}
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
            {[
              { value: short(stats.receivedCents), label: t('pastor.received') },
              {
                value: String(stats.givers),
                label: t('pastor.givers', { count: stats.newGivers }),
              },
              { value: String(stats.monthlyGifts), label: t('pastor.monthlyGifts') },
              { value: short(stats.recurringMonthlyCents), label: t('pastor.recurringEach') },
            ].map((item) => (
              <div key={item.label} className="min-w-0">
                <dd className="amount truncate text-xl leading-tight" title={item.value}>
                  {item.value}
                </dd>
                <dt className="text-xs text-ink-muted">{item.label}</dt>
              </div>
            ))}
          </dl>

            <ul className="mt-5 flex flex-col gap-3 border-t border-line pt-4">
              {stats.funds.map((fund) => (
                <li key={fund.id}>
                  <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="text-sm font-semibold">{fund.name}</span>
                    <span className="amount text-sm whitespace-nowrap">
                      {fund.goalCents
                        ? `${short(fund.balanceCents)} / ${short(fund.goalCents)}`
                        : short(fund.balanceCents)}
                    </span>
                  </span>
                  <FundThread
                    slug={fund.slug}
                    progress={fund.goalCents ? fund.balanceCents / fund.goalCents : undefined}
                    className="mt-1.5"
                    label={fund.name}
                  />
                </li>
              ))}
            </ul>
          </Card>
        )}

        {stats && (
          <Card className="p-5">
            <h3 className="font-display text-lg font-bold">{t('pastor.yourRules')}</h3>
            <p className="mt-1 text-xs text-ink-muted">{t('pastor.yourRulesNote')}</p>

            <dl className="mt-4 flex flex-col gap-3">
              <div className="border-b border-line pb-3">
                <dt className="text-sm font-semibold">{t('pastor.approvedRecipients')}</dt>
                <dd className="text-sm text-ink-muted">
                  {t('pastor.recipientCount', { count: stats.approvedRecipients })}
                </dd>
              </div>
              <div className="border-b border-line pb-3">
                <dt className="text-sm font-semibold">{t('pastor.paymentLimits')}</dt>
                {/* Leídos del servidor: la pantalla no puede afirmar un tope
                    distinto del que el motor de reglas hace cumplir. */}
                <dd className="text-sm text-ink-muted">
                  {t('pastor.limitValues', {
                    item: money(stats.limits.maxPerItemCents),
                    batch: money(stats.limits.maxPerBatchCents),
                  })}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-semibold">{t('pastor.whoApproves')}</dt>
                <dd className="text-sm text-ink-muted">{t('pastor.whoApprovesValue')}</dd>
              </div>
            </dl>
          </Card>
        )}
      </aside>
    </div>
  );
}
