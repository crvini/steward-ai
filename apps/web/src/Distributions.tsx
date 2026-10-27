/**
 * Distributions — where the AI's proposal meets the rules and two signatures.
 *
 * Three things on this screen are deliberate:
 *
 * - The blocked line stays visible, struck through, with the rule that
 *   refused it. Dropping it would hide exactly what the treasurer is here to
 *   review.
 * - "Stays in the fund" is shown as its own row. Money that is not sent is
 *   still a decision, and a treasurer should see where it went.
 * - One gold button per screen: the one that adds a signature. Everything
 *   else is quiet, because everything else is reversible.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  api,
  formatCents,
  type ChurchResponse,
  type DistributionDetail,
  type DistributionRow,
  type SessionUser,
} from './api';
import { FundRibbon } from './FundThread';
import { Badge, Button, Card, Logo } from './ui';

const STATUS_TONE = {
  PROPOSED: 'warn',
  TREASURER_APPROVED: 'neutral',
  APPROVED: 'neutral',
  EXECUTED: 'good',
  FAILED: 'bad',
} as const;

/** The two-key panel: who has signed, who is next, what happens then. */
function TwoKeys({ detail }: { detail: DistributionDetail }) {
  const { t } = useTranslation();

  const steps = [
    {
      done: Boolean(detail.treasurerApprovedBy),
      current: !detail.treasurerApprovedBy,
      title: t('dist.keys.treasurer'),
      note: detail.treasurerApprovedBy ?? t('dist.keys.waiting'),
    },
    {
      done: Boolean(detail.pastorApprovedBy),
      current: Boolean(detail.treasurerApprovedBy) && !detail.pastorApprovedBy,
      title: t('dist.keys.pastor'),
      note: detail.pastorApprovedBy ?? t('dist.keys.waiting'),
    },
    {
      done: detail.status === 'EXECUTED',
      current: detail.status === 'APPROVED',
      title: t('dist.keys.sent'),
      note: t('dist.keys.onlyAfterBoth'),
    },
  ];

  return (
    <div className="rounded-2xl bg-navy-900 p-5 text-white">
      <h3 className="font-display text-lg font-bold">{t('dist.keys.title')}</h3>
      <ol className="mt-4 flex flex-col gap-4">
        {steps.map((step) => (
          <li key={step.title} className="flex gap-3">
            <span
              className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm ${
                step.done
                  ? 'border-fund-benevolence bg-fund-benevolence/20 text-white'
                  : step.current
                    ? 'border-dashed border-gold-500 text-gold-500'
                    : 'border-white/20 text-white/40'
              }`}
              aria-hidden
            >
              {step.done ? '✓' : '⚿'}
            </span>
            <span>
              <span className="block text-sm font-semibold">{step.title}</span>
              <span className="block text-xs text-white/60">{step.note}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Distributions({
  church,
  user,
  onChanged,
}: {
  church: ChurchResponse;
  user: SessionUser;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState<DistributionRow[]>([]);
  const [detail, setDetail] = useState<DistributionDetail | null>(null);
  const [fundId, setFundId] = useState(church.funds[0]?.id ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const money = (cents: number) => formatCents(cents, church.church.currency, i18n.language);

  useEffect(() => {
    void (async () => {
      try {
        const list = (await api.distributions()).distributions;
        setRows(list);
        // Open whatever still needs a person, so nobody has to go looking.
        const pending = list.find((d) => d.status !== 'EXECUTED' && d.status !== 'FAILED');
        if (pending) setDetail(await api.distribution(pending.id));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
      setRows((await api.distributions()).distributions);
      if (detail) setDetail(await api.distribution(detail.id));
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const isTreasurer = user.role === 'TREASURER';
  const isPastor = user.role === 'PASTOR';

  const blocked = detail?.verdict.lines.filter((l) => !l.ok) ?? [];
  const blockedCents = blocked.reduce((s, l) => s + l.amountCents, 0);
  const staysCents = detail ? detail.fundBalanceCents - detail.verdict.payableCents : 0;

  const canSign =
    detail !== null &&
    detail.verdict.executable &&
    ((isTreasurer && detail.status === 'PROPOSED') ||
      (isPastor && detail.status === 'TREASURER_APPROVED'));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex flex-col gap-4">
        {error && (
          <p className="rounded-xl border border-fund-missions/30 bg-fund-missions/5 px-4 py-3 text-sm text-fund-missions">
            {error}
          </p>
        )}

        {detail && (
          <Card className="overflow-hidden">
            <FundRibbon slug={church.funds.find((f) => f.name === detail.fund)?.slug ?? 'GENERAL'} />

            <div className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-2xl font-extrabold">
                    {t('dist.heading', { fund: detail.fund })}
                  </h2>
                  <p className="mt-1 text-sm text-ink-muted">
                    {t('dist.available', { amount: money(detail.fundBalanceCents) })}
                  </p>
                </div>
                <Badge tone={STATUS_TONE[detail.status]}>{t(`dist.status.${detail.status}`)}</Badge>
              </div>

              {detail.aiRationale && (
                <div className="mt-5 flex gap-3 rounded-xl bg-surface-alt p-4">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy-900">
                    <Logo />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">{t('dist.aiSays')}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-navy-900/85">
                      {detail.aiRationale}
                    </span>
                  </span>
                </div>
              )}

              <table className="mt-6 w-full text-left text-sm">
                <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="pb-2 font-medium">{t('dist.recipient')}</th>
                    <th className="pb-2 text-right font-medium">{t('dist.amount')}</th>
                    <th className="pb-2 pl-5 font-medium">{t('dist.rules')}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.verdict.lines.map((line) => (
                    <tr
                      key={line.recipientId}
                      className={`border-b border-line/70 ${line.ok ? '' : 'bg-fund-missions/5'}`}
                    >
                      <td className="py-3 pr-3">
                        <span
                          className={`block font-semibold ${line.ok ? '' : 'text-fund-missions'}`}
                        >
                          {line.recipientName ?? line.recipientId}
                        </span>
                        {!line.ok && (
                          <span className="block text-xs text-fund-missions/80">
                            {t('dist.suggestedByAi')}
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <span
                          className={`amount text-base ${
                            line.ok ? '' : 'text-fund-missions line-through'
                          }`}
                        >
                          {money(line.amountCents)}
                        </span>
                      </td>
                      <td className="py-3 pl-5">
                        {line.ok ? (
                          <span className="text-fund-benevolence">✓ {t('dist.passes')}</span>
                        ) : (
                          <>
                            <span className="block font-semibold text-fund-missions">
                              ✕ {t('dist.blockedLine')}
                            </span>
                            <span className="block text-fund-missions/90">
                              {line.violations.map((v) => v.detail).join(' ')}
                            </span>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}

                  {/* El dinero que no sale también es una decisión. */}
                  <tr className="border-b-2 border-navy-900">
                    <td className="py-3 pr-3">
                      <span className="block font-semibold">{t('dist.stays')}</span>
                      <span className="block text-xs text-ink-muted">
                        {blockedCents > 0
                          ? t('dist.staysNoteBlocked', {
                              reserve: money(Math.max(0, staysCents - blockedCents)),
                              blocked: money(blockedCents),
                            })
                          : t('dist.staysNote')}
                      </span>
                    </td>
                    <td className="amount py-3 text-right text-base">{money(staysCents)}</td>
                    <td className="py-3 pl-5 text-ink-muted">{t('dist.noPayment')}</td>
                  </tr>

                  <tr>
                    <td className="py-3 pr-3 font-semibold">{t('dist.sentThrough')}</td>
                    <td className="amount py-3 text-right text-xl">
                      {money(detail.verdict.payableCents)}
                    </td>
                    <td className="py-3 pl-5 text-ink-muted">
                      {t('dist.paymentsInBatch', {
                        count: detail.verdict.lines.filter((l) => l.ok).length,
                      })}
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="mt-6 flex flex-wrap gap-2">
                {canSign && (
                  <Button
                    variant="gold"
                    disabled={busy !== null}
                    onClick={() => void run('approve', () => api.approveDistribution(detail.id))}
                    className="flex-1 sm:flex-none"
                  >
                    {isTreasurer
                      ? t('dist.approveTreasurer')
                      : t('dist.approvePastorAmount', {
                          amount: money(detail.verdict.payableCents),
                        })}
                  </Button>
                )}

                {detail.status === 'APPROVED' && (
                  <Button
                    variant="gold"
                    disabled={busy !== null}
                    onClick={() => void run('execute', () => api.executeDistribution(detail.id))}
                  >
                    {busy === 'execute' ? t('dist.executing') : t('dist.execute')}
                  </Button>
                )}

                {isTreasurer && detail.status === 'PROPOSED' && (
                  <Button
                    disabled={busy !== null}
                    onClick={() =>
                      void run('revise', async () => {
                        setDetail(await api.reviseDistribution(detail.id));
                      })
                    }
                  >
                    {busy === 'revise' ? t('dist.revising') : t('dist.revise')}
                  </Button>
                )}

                {detail.status !== 'EXECUTED' && detail.status !== 'FAILED' && (
                  <Button
                    variant="danger"
                    disabled={busy !== null}
                    onClick={() =>
                      void run('reject', () =>
                        api.rejectDistribution(detail.id, 'Rejected in review'),
                      )
                    }
                  >
                    {t('dist.reject')}
                  </Button>
                )}
              </div>

              {detail.paypalBatchId && (
                <p className="mt-4 text-xs text-ink-muted">
                  {t('dist.batch')}:{' '}
                  <code className="rounded bg-surface-alt px-1.5 py-0.5 font-mono">
                    {detail.paypalBatchId}
                  </code>
                </p>
              )}
            </div>
          </Card>
        )}

        {/* Los demás repartos, para poder volver a uno ya pagado. */}
        <div className="flex flex-col gap-2">
          {rows
            .filter((r) => r.id !== detail?.id)
            .map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => void api.distribution(row.id).then(setDetail)}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-left text-sm hover:border-navy-900"
              >
                <span className="font-semibold">{row.fund}</span>
                <span className="amount">{money(row.totalCents)}</span>
                <Badge tone={STATUS_TONE[row.status]}>{t(`dist.status.${row.status}`)}</Badge>
              </button>
            ))}
        </div>

        {isTreasurer && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{t('dist.fund')}</span>
              <select
                value={fundId}
                onChange={(e) => setFundId(e.target.value)}
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              >
                {church.funds.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} — {money(f.balanceCents)}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="navy"
              disabled={busy !== null}
              onClick={() =>
                void run('propose', async () => {
                  const { id } = await api.proposeDistribution(fundId);
                  setDetail(await api.distribution(id));
                })
              }
            >
              {busy === 'propose' ? t('dist.proposing') : t('dist.propose')}
            </Button>
          </div>
        )}
      </div>

      <aside className="flex flex-col gap-4">
        {detail && <TwoKeys detail={detail} />}

        {detail && (
          <Card className="p-5">
            <h3 className="font-display text-lg font-bold">{t('dist.rulesChecked')}</h3>
            <p className="mt-1 text-sm text-ink-muted">{t('dist.rulesCheckedNote')}</p>
            <ul className="mt-4 flex flex-col gap-2.5">
              {detail.verdict.checks.map((check) => (
                <li key={check.code} className="flex items-start gap-2 text-sm">
                  <span
                    aria-hidden
                    className={check.passed ? 'text-fund-benevolence' : 'text-fund-missions'}
                  >
                    {check.passed ? '✓' : '✕'}
                  </span>
                  <span className={check.passed ? '' : 'font-semibold text-fund-missions'}>
                    {t(`rule.${check.code}`, {
                      defaultValue: check.label,
                      // Los montos salen de lo que el motor aplica de verdad.
                      item: money(detail.limits.maxPerItemCents),
                      batch: money(detail.limits.maxPerBatchCents),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </aside>
    </div>
  );
}
