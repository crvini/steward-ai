import { describe, expect, it } from 'vitest';

import { centsToPayPalValue, payPalValueToCents, formatCents } from './money.js';

describe('centsToPayPalValue', () => {
  it('always emits two decimals', () => {
    expect(centsToPayPalValue(0)).toBe('0.00');
    expect(centsToPayPalValue(5)).toBe('0.05');
    expect(centsToPayPalValue(50)).toBe('0.50');
    expect(centsToPayPalValue(100)).toBe('1.00');
    expect(centsToPayPalValue(4250)).toBe('42.50');
    expect(centsToPayPalValue(123456789)).toBe('1234567.89');
  });

  it('keeps the sign on refunds', () => {
    expect(centsToPayPalValue(-4250)).toBe('-42.50');
    expect(centsToPayPalValue(-5)).toBe('-0.05');
  });

  it('rejects fractional cents rather than rounding them away', () => {
    expect(() => centsToPayPalValue(10.5)).toThrow(RangeError);
  });
});

describe('payPalValueToCents', () => {
  it('parses the shapes PayPal actually sends', () => {
    expect(payPalValueToCents('42.50')).toBe(4250);
    expect(payPalValueToCents('0.05')).toBe(5);
    expect(payPalValueToCents('100')).toBe(10000);
    expect(payPalValueToCents('100.5')).toBe(10050);
    expect(payPalValueToCents(' 7.07 ')).toBe(707);
    expect(payPalValueToCents('-42.50')).toBe(-4250);
  });

  it('rejects anything that is not a plain money value', () => {
    for (const bad of ['', 'abc', '1.234', '1,00', '1.2.3', '$5.00', 'NaN']) {
      expect(() => payPalValueToCents(bad)).toThrow(RangeError);
    }
  });
});

describe('round trip', () => {
  it('survives every cent value a gift can take', () => {
    for (const cents of [1, 5, 99, 100, 101, 2500, 99999, 1_000_000]) {
      expect(payPalValueToCents(centsToPayPalValue(cents))).toBe(cents);
    }
  });

  it('does not lose the classic float cases', () => {
    // 0.1 + 0.2 territory: integers make these exact.
    expect(payPalValueToCents('0.10') + payPalValueToCents('0.20')).toBe(30);
    expect(centsToPayPalValue(30)).toBe('0.30');
  });
});

describe('formatCents', () => {
  it('formats for display', () => {
    expect(formatCents(4250)).toBe('$42.50');
    expect(formatCents(0)).toBe('$0.00');
  });
});
