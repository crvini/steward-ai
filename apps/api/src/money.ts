/**
 * Money helpers.
 *
 * The database stores integer USD cents. PayPal speaks decimal strings. These
 * two functions are the only place a conversion happens, so a donation can
 * never be silently rounded by a binary float.
 */

/** 4250 -> "42.50" — the shape PayPal's `amount.value` expects. */
export function centsToPayPalValue(cents: number): string {
  if (!Number.isInteger(cents)) throw new RangeError(`Expected integer cents, got ${cents}`);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** "42.50" -> 4250. Rejects anything that is not a plain two-decimal amount. */
export function payPalValueToCents(value: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new RangeError(`Not a PayPal money value: ${JSON.stringify(value)}`);
  const [, sign, whole, fraction = ''] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return sign === '-' ? -cents : cents;
}

/** 4250 -> "$42.50", for logs and the demo UI. */
export function formatCents(cents: number, currency = 'USD', locale = 'en-US'): string {
  return (cents / 100).toLocaleString(locale, { style: 'currency', currency });
}
