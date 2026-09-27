/** Supported currencies and their ISO 4217 minor units. */
export const CURRENCIES = {
  XAF: { minorUnit: 0 }
} as const;

export type Currency = keyof typeof CURRENCIES;

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}
