/**
 * The auditor: our books against PayPal's own record.
 *
 * Two directions matter and they mean different things. A payment PayPal has
 * that we never wrote down means our ledger is short. A row we have that
 * PayPal cannot confirm means someone recorded money that may never have
 * arrived. Both are shown, named separately, because the fix is different.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, formatCents, type Reconciliation } from './api';
import { Badge, Card } from './ui';

export function Audit({ currency }: { currency: string }) {
  const { t, i18n } = useTranslation();
  const [report, setReport] = useState<Reconciliation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const money = (c: number) => formatCents(c, currency, i18n.language);

  useEffect(() => {
    void (async () => {
      try {
        setReport(await api.reconcile(30));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  if (error) {
    return (
      <Card className="p-6">
        <p className="text-sm text-fund-missions">{error}</p>
      </Card>
    );
  }

  if (!report) {
    return (
      <Card className="p-6">
        <p className="text-sm text-ink-muted">{t('audit.loading')}</p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">{t('audit.title')}</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {t('audit.window', {
              days: report.window.days,
              paypal: report.paypalCount,
              local: report.localCount,
            })}
          </p>
        </div>
        <Badge tone={report.inSync ? 'good' : 'warn'}>
          {report.inSync ? t('audit.inSync') : t('audit.differences', { count: report.differences })}
        </Badge>
      </div>

      <section className="mt-6">
        <h3 className="text-sm font-semibold">{t('audit.unconfirmedTitle')}</h3>
        <p className="mt-0.5 text-xs text-ink-muted">{t('audit.unconfirmedNote')}</p>
        {report.unconfirmedLocally.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">{t('audit.none')}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {report.unconfirmedLocally.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gold-500/10 px-4 py-3 text-sm"
              >
                <span>
                  <span className="font-semibold">{row.party}</span>
                  <span className="text-ink-muted"> · {row.fund} · {row.date}</span>
                </span>
                <span className="amount">{money(row.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h3 className="text-sm font-semibold">{t('audit.missingTitle')}</h3>
        <p className="mt-0.5 text-xs text-ink-muted">{t('audit.missingNote')}</p>
        {report.missingLocally.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">{t('audit.none')}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {report.missingLocally.map((row) => (
              <li
                key={row.transactionId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-alt px-4 py-3 text-sm"
              >
                <span>
                  <code className="font-mono text-xs">{row.transactionId}</code>
                  <span className="text-ink-muted">
                    {' '}
                    · {row.occurredAt?.slice(0, 10) ?? '—'}
                  </span>
                </span>
                <span className="amount">
                  {row.value ? `${row.value} ${row.currency ?? ''}` : '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 text-xs text-ink-muted">{t('audit.lagNote')}</p>
    </Card>
  );
}
