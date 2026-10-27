/**
 * Transaction Search (spec §4): compare what PayPal recorded against what our
 * ledger says, so the treasurer can prove nothing was missed.
 *
 * Two hard API constraints drive the shape here: ranges are capped at 31 days,
 * and timestamps must not carry fractional seconds.
 *
 * Reporting lag is expected: a capture can take up to a few hours to surface in
 * Transaction Search, so a just-captured gift showing as `missingLocally: []`
 * but absent from `paypalCount` is normal, not a bug.
 */
import { paypal } from './client.js';

export const TRANSACTION_SEARCH_MAX_DAYS = 31;

type SearchResponse = {
  transaction_details?: {
    transaction_info: {
      transaction_id: string;
      transaction_status?: string;
      transaction_initiation_date?: string;
      transaction_amount?: { value: string; currency_code: string };
      fee_amount?: { value: string; currency_code: string };
      custom_field?: string;
    };
    payer_info?: { email_address?: string };
  }[];
  total_pages?: number;
};

export type PayPalTransaction = {
  transactionId: string;
  status: string | null;
  occurredAt: string | null;
  value: string | null;
  currency: string | null;
  customField: string | null;
};

/** PayPal rejects fractional seconds on these parameters. */
const isoSeconds = (date: Date) => `${date.toISOString().slice(0, 19)}Z`;

export async function searchTransactions(start: Date, end: Date): Promise<PayPalTransaction[]> {
  const spanDays = (end.getTime() - start.getTime()) / 86_400_000;
  if (spanDays > TRANSACTION_SEARCH_MAX_DAYS) {
    throw new RangeError(
      `Transaction Search allows at most ${TRANSACTION_SEARCH_MAX_DAYS} days, got ${spanDays.toFixed(1)}`,
    );
  }

  const found: PayPalTransaction[] = [];

  for (let page = 1; ; page++) {
    const query = new URLSearchParams({
      start_date: isoSeconds(start),
      end_date: isoSeconds(end),
      fields: 'transaction_info,payer_info',
      page_size: '100',
      page: String(page),
    });

    const result = await paypal.get<SearchResponse>(`/v1/reporting/transactions?${query}`);

    for (const row of result.transaction_details ?? []) {
      const info = row.transaction_info;
      found.push({
        transactionId: info.transaction_id,
        status: info.transaction_status ?? null,
        occurredAt: info.transaction_initiation_date ?? null,
        value: info.transaction_amount?.value ?? null,
        currency: info.transaction_amount?.currency_code ?? null,
        customField: info.custom_field ?? null,
      });
    }

    if (page >= (result.total_pages ?? 1)) return found;
  }
}
