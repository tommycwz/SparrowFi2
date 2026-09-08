import { Currency } from './models';

const LOCALE_BY_CURRENCY: Record<Currency, string> = {
  myr: 'ms-MY',
  usd: 'en-US',
  eur: 'de-DE',
  gbp: 'en-GB',
  sgd: 'en-SG',
  aud: 'en-AU',
};

export function formatMoney(amount: number, currency: Currency): string {
  try {
    return new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency] ?? 'en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      currencyDisplay: 'narrowSymbol',
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency.toUpperCase()}`;
  }
}
