import { CURRENCIES, Currency } from './currency';

/**
 * Amounts are always integers in the currency's minor unit
 * (XAF has no decimals: 100.000 XAF === 100000). Never floats.
 */
export function isValidAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function assertValidAmount(value: unknown, field = 'amount'): number {
  if (!isValidAmount(value)) {
    throw new RangeError(`${field} must be a positive integer in minor units`);
  }
  return value;
}

/**
 * Formats an amount for display: always groups thousands with a dot,
 * e.g. 2450000 XAF -> "2.450.000 XAF", 8500 -> "8.500 XAF".
 * (Intl's es-ES locale skips grouping for 4-digit numbers, which is
 * confusing on a cashier screen, so grouping is done here.)
 */
export function formatMoney(amount: number, currency: Currency, options: { sign?: boolean } = {}): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError('amount must be an integer');
  const { minorUnit } = CURRENCIES[currency];
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const units = Math.floor(abs / 10 ** minorUnit);
  const grouped = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = minorUnit > 0 ? ',' + String(abs % 10 ** minorUnit).padStart(minorUnit, '0') : '';
  const sign = negative ? '−' : options.sign && amount > 0 ? '+' : '';
  return `${sign}${grouped}${fraction} ${currency}`;
}
