/**
 * Distributions: where the AI's proposal meets the rules engine and two
 * signatures.
 *
 * The blocked lines are shown, not hidden. A treasurer has to see what the
 * assistant tried to do and exactly which rule refused it — that is the
 * difference between a guardrail and a claim about one.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  api,
  formatCents,
  type ChurchResponse,
  type DistributionDetail,
  type DistributionRow,
  type SessionUser,
} from './api';

const STATUS_STYLE: Record<DistributionDetail['status'], string> = {
  PROPOSED: 'bg-amber-100 text-amber-800',
  TREASURER_APPROVED: 'bg-sky-100 text-sky-800',
  APPROVED: 'bg-violet-100 text-violet-800',
  EXECUTED: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-800',
};

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

  const refresh = useCallback(async () => {
    try {
      setRows((await api.distributions()).distributions);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = async (id: string) => {
    setError(null);
    try {
      setDetail(await api.distribution(id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
      await refresh();
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

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t('dist.title')}</h2>
          <p className="text-sm text-neutral-600">{t('dist.subtitle')}</p>
        </div>

        {isTreasurer && (
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{t('dist.fund')}</span>
              <select
                value={fundId}
                onChange={(e) => setFundId(e.target.value)}
                className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
              >
                {church.funds.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} — {money(f.balanceCents)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void run('propose', async () => {
                  const { id } = await api.proposeDistribution(fundId);
                  await open(id);
                })
              }
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy === 'propose' ? t('dist.proposing') : t('dist.propose')}
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {rows.length === 0 && <p className="text-sm text-neutral-500">{t('dist.empty')}</p>}

      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => void open(row.id)}
            className={`rounded-xl border bg-white p-4 text-left shadow-sm ${
              detail?.id === row.id ? 'border-neutral-900' : 'border-neutral-200'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{row.fund}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[row.status]}`}
              >
                {t(`dist.status.${row.status}`)}
              </span>
            </div>
            <p className="mt-1 text-sm text-neutral-600">
              {money(row.totalCents)} · {t('dist.recipients', { count: row.items.length })}
            </p>
            {/* Both signatures, visible without opening anything. */}
            <p className="mt-1 text-xs text-neutral-500">
              {t('dist.keys', {
                treasurer: row.treasurerApprovedBy ?? '—',
                pastor: row.pastorApprovedBy ?? '—',
              })}
            </p>
          </button>
        ))}
      </div>

      {detail && (
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold">{detail.fund}</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[detail.status]}`}
            >
              {t(`dist.status.${detail.status}`)}
            </span>
          </div>

          {detail.aiRationale && (
            <div className="mt-3 rounded-lg bg-blue-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-blue-700">
                {t('dist.aiSays')}
              </p>
              <p className="mt-1 text-sm text-blue-900">{detail.aiRationale}</p>
            </div>
          )}

          <table className="mt-4 w-full text-left text-sm">
            <thead className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="py-2">{t('dist.recipient')}</th>
                <th className="py-2 text-right">{t('dist.amount')}</th>
                <th className="py-2 pl-4">{t('dist.rules')}</th>
              </tr>
            </thead>
            <tbody>
              {detail.verdict.lines.map((line) => (
                <tr
                  key={line.recipientId}
                  className={`border-b border-neutral-100 last:border-0 ${
                    line.ok ? '' : 'bg-red-50'
                  }`}
                >
                  <td className="py-2">{line.recipientName ?? line.recipientId}</td>
                  <td className="py-2 text-right tabular-nums">{money(line.amountCents)}</td>
                  <td className="py-2 pl-4">
                    {line.ok ? (
                      <span className="text-green-700">{t('dist.passes')}</span>
                    ) : (
                      <span className="text-red-700">
                        {line.violations.map((v) => v.detail).join(' ')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Todas las reglas, no solo las que fallaron: enseñar únicamente
              los fallos deja al lector adivinando qué más se revisó. */}
          <div className="mt-4 rounded-xl border border-line bg-surface-alt p-4">
            <p className="text-sm font-semibold">{t('dist.rulesChecked')}</p>
            <p className="mt-0.5 text-xs text-ink-muted">{t('dist.rulesCheckedNote')}</p>
            <ul className="mt-3 flex flex-col gap-1.5">
              {detail.verdict.checks.map((check) => (
                <li key={check.code} className="flex items-start gap-2 text-sm">
                  <span
                    aria-hidden
                    className={check.passed ? 'text-fund-benevolence' : 'text-fund-missions'}
                  >
                    {check.passed ? '✓' : '✕'}
                  </span>
                  <span className={check.passed ? 'text-ink-muted' : 'text-fund-missions'}>
                    {t(`rule.${check.code}`, { defaultValue: check.label })}
                    {check.detail ? ` — ${check.detail}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {detail.verdict.batchViolations.length > 0 && (
            <ul className="mt-3 list-disc rounded-lg bg-red-50 p-3 pl-8 text-sm text-red-800">
              {detail.verdict.batchViolations.map((v) => (
                <li key={v.code}>{v.detail}</li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-sm">
            {t('dist.payable')}: <strong>{money(detail.verdict.payableCents)}</strong>
            {' · '}
            {t('dist.fundHolds')}: {money(detail.fundBalanceCents)}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {isTreasurer && detail.status === 'PROPOSED' && (
              <button
                type="button"
                disabled={!detail.verdict.executable || busy !== null}
                onClick={() => void run('approve', () => api.approveDistribution(detail.id))}
                className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                title={detail.verdict.executable ? undefined : t('dist.blockedTitle')}
              >
                {t('dist.approveTreasurer')}
              </button>
            )}

            {isPastor && detail.status === 'TREASURER_APPROVED' && (
              <button
                type="button"
                disabled={!detail.verdict.executable || busy !== null}
                onClick={() => void run('approve', () => api.approveDistribution(detail.id))}
                className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {t('dist.approvePastor')}
              </button>
            )}

            {detail.status === 'APPROVED' && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void run('execute', () => api.executeDistribution(detail.id))}
                className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy === 'execute' ? t('dist.executing') : t('dist.execute')}
              </button>
            )}

            {detail.status !== 'EXECUTED' && detail.status !== 'FAILED' && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void run('reject', () => api.rejectDistribution(detail.id, 'Rejected in review'))
                }
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium"
              >
                {t('dist.reject')}
              </button>
            )}
          </div>

          {detail.paypalBatchId && (
            <p className="mt-3 text-xs text-neutral-500">
              {t('dist.batch')}:{' '}
              <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono">
                {detail.paypalBatchId}
              </code>
            </p>
          )}

          {!detail.verdict.executable && detail.status === 'PROPOSED' && (
            <p className="mt-3 text-xs text-neutral-600">{t('dist.blockedHelp')}</p>
          )}
        </div>
      )}
    </section>
  );
}
