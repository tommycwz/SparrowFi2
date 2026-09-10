import { Currency } from './models';

const LOCALE_BY_CURRENCY: Record<Currency, string> = {
  myr: 'ms-MY',
  usd: 'en-US',
  eur: 'de-DE',
  gbp: 'en-GB',
  sgd: 'en-SG',
  aud: 'en-AU',
};

/** Formats a signed amount as "-RM1,000,000.00" - always minus-then-symbol,
 * regardless of amount's sign. `Intl.NumberFormat` is still what renders
 * the symbol/grouping/decimals (so each currency's own conventions are
 * respected), but its *negative-sign placement* isn't used: some locales
 * (e.g. 'ms-MY', used for MYR) put it after the currency symbol instead of
 * before it - "RM-1,000,000.00" - which reads as a stray hyphen rather
 * than a negative amount. Formatting the absolute value and prepending our
 * own "-" sidesteps that locale quirk entirely. */
export function formatMoney(amount: number, currency: Currency): string {
  const isNegative = amount < 0;
  const sign = isNegative ? '-' : '';
  const magnitude = Math.abs(amount);
  try {
    const formatted = new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency] ?? 'en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      currencyDisplay: 'narrowSymbol',
    }).format(magnitude);
    return `${sign}${formatted}`;
  } catch {
    return `${sign}${magnitude.toFixed(2)} ${currency.toUpperCase()}`;
  }
}
