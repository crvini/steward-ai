/**
 * The simple ledger table for the first milestone. The full treasurer dashboard
 * replaces this with AG Grid (spec §3.3).
 */
import { useTranslation } from 'react-i18next';

import { formatCents, type GiftRow } from './api';

const STATUS_STYLES: Record<GiftRow['status'], string> = {
  // Una ofrenda mensual activa no está "completada": sigue cobrándose.
  ACTIVE: 'bg-fund-tithe/10 text-fund-tithe',
  COMPLETED: 'bg-fund-benevolence/10 text-fund-benevolence',
  PENDING: 'bg-gold-500/15 text-navy-900',
  FAILED: 'bg-fund-missions/10 text-fund-missions',
  CANCELLED: 'bg-surface-alt text-ink-muted',
};

export function GiftsTable({ gifts }: { gifts: GiftRow[] }) {
  const { t, i18n } = useTranslation();

  if (gifts.length === 0) {
    return <p className="text-sm text-neutral-500">{t('table.empty')}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="px-4 py-3">{t('table.date')}</th>
            <th className="px-4 py-3">{t('table.donor')}</th>
            <th className="px-4 py-3">{t('table.fund')}</th>
            <th className="px-4 py-3 text-right">{t('table.amount')}</th>
            <th className="px-4 py-3">{t('table.status')}</th>
          </tr>
        </thead>
        <tbody>
          {gifts.map((gift) => (
            <tr key={gift.id} className="border-b border-neutral-100 last:border-0">
              <td className="px-4 py-2.5 whitespace-nowrap text-neutral-600">
                {new Date(gift.createdAt).toLocaleDateString(i18n.language)}
              </td>
              <td className="px-4 py-2.5">{gift.donor}</td>
              <td className="px-4 py-2.5">{gift.fund}</td>
              <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                {formatCents(gift.amountCents, gift.currency, i18n.language)}
              </td>
              <td className="px-4 py-2.5">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[gift.status]}`}
                >
                  {t(`status.${gift.status}`)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
