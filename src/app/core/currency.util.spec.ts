import { formatMoney } from './currency.util';

// Assertions here deliberately don't pin exact spacing/grouping between the
// symbol and the digits (Intl.NumberFormat output for that can differ
// slightly between JS engines/ICU data versions) - only the one thing that
// was actually broken: where the minus sign lands.

describe('formatMoney', () => {
  it('puts the minus sign before the currency symbol for MYR (the reported bug)', () => {
    // Intl.NumberFormat's 'ms-MY' locale places the sign after the symbol
    // by default ("RM-1,000,000.00") - this is exactly what formatMoney
    // must not do.
    const result = formatMoney(-1_000_000, 'myr');
    expect(result.startsWith('-')).toBe(true);
    // Exactly one '-', and it's the very first character - not hiding
    // after the currency symbol.
    expect(result.indexOf('-')).toBe(0);
    expect(result.lastIndexOf('-')).toBe(0);
    expect(result).toContain('1,000,000.00');
  });

  it('has no sign at all for a positive amount', () => {
    expect(formatMoney(1_000_000, 'myr')).not.toContain('-');
  });

  it('formats zero without a minus sign', () => {
    expect(formatMoney(0, 'myr')).not.toContain('-');
    expect(formatMoney(-0, 'myr')).not.toContain('-');
  });

  it('puts the minus sign before the symbol for every supported currency', () => {
    const currencies = ['myr', 'usd', 'eur', 'gbp', 'sgd', 'aud'] as const;
    for (const currency of currencies) {
      const result = formatMoney(-42.5, currency);
      expect(result.startsWith('-')).toBe(true);
      expect(result.lastIndexOf('-')).toBe(0);
    }
  });
});
