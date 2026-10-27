/**
 * What the donor sees after a gift is captured.
 *
 * This replaced a single line of text. It is the emotional beat of the whole
 * product, and it is also where the transparency claim becomes concrete: the
 * fee and net breakdown is real data from PayPal, not a promise.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatCents, type Receipt } from './api';

export function GiftReceipt({ receipt, onGiveAgain }: { receipt: Receipt; onGiveAgain: () => void }) {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);

  const money = (cents: number) => formatCents(cents, receipt.currency, i18n.language);
  const esMensual = receipt.frequency === 'MONTHLY';

  const copyReference = async () => {
    if (!receipt.captureId) return;
    try {
      await navigator.clipboard.writeText(receipt.captureId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked in some embedded views; the text is selectable.
      setCopied(false);
    }
  };

  return (
    <section className="rounded-xl border border-emerald-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-lg text-emerald-700"
        >
          ✓
        </span>
        <div>
          <h2 className="text-xl font-semibold">
            {esMensual ? t('receipt.monthlyTitle') : t('receipt.title', { name: receipt.donor })}
          </h2>
          <p className="text-sm text-neutral-600">
            {esMensual ? t('receipt.monthlySubtitle') : t('receipt.subtitle')}
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-4xl font-semibold tabular-nums">{money(receipt.amountCents)}</span>
        <span className="text-lg text-neutral-600">
          {t('receipt.toFund', { fund: receipt.fund })}
          {esMensual ? ` · ${t('receipt.perMonth')}` : ''}
        </span>
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        {new Date(receipt.occurredAt).toLocaleString(i18n.language)}
      </p>

      {/* The honest part: PayPal takes a cut, and the church sees what landed. */}
      {receipt.netCents !== null && (
        <dl className="mt-6 divide-y divide-neutral-100 rounded-lg border border-neutral-200 text-sm">
          <div className="flex justify-between px-4 py-2.5">
            <dt className="text-neutral-600">{t('receipt.gross')}</dt>
            <dd className="tabular-nums">{money(receipt.amountCents)}</dd>
          </div>
          {receipt.feeCents !== null && (
            <div className="flex justify-between px-4 py-2.5">
              <dt className="text-neutral-600">{t('receipt.fee')}</dt>
              <dd className="tabular-nums text-neutral-600">−{money(receipt.feeCents)}</dd>
            </div>
          )}
          <div className="flex justify-between px-4 py-2.5 font-medium">
            <dt>{t('receipt.net')}</dt>
            <dd className="tabular-nums">{money(receipt.netCents)}</dd>
          </div>
        </dl>
      )}

      <p className="mt-4 text-sm text-neutral-600">
        {t('receipt.joins', {
          total: money(receipt.fundBalanceCents),
          fund: receipt.fund,
        })}
      </p>

      {receipt.captureId && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-neutral-500">{t('receipt.reference')}</span>
          <code className="rounded bg-neutral-100 px-2 py-1 font-mono">{receipt.captureId}</code>
          <button
            type="button"
            onClick={() => void copyReference()}
            className="rounded border border-neutral-300 px-2 py-1 font-medium"
          >
            {copied ? t('receipt.copied') : t('receipt.copy')}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onGiveAgain}
        className="mt-6 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
      >
        {t('receipt.giveAgain')}
      </button>
    </section>
  );
}
