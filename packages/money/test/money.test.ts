import {
  assertValidAmount,
  computeCommission,
  CommissionRule,
  formatMoney,
  isCurrency,
  isValidAmount,
  maskPhone,
  selectCommissionRule
} from '../src';

const rule = (overrides: Partial<CommissionRule> = {}): CommissionRule => ({
  id: 'r1',
  operationType: 'cash_out',
  tierCode: null,
  amountFrom: 0,
  amountTo: null,
  fixedAmount: 0,
  rateBps: 100,
  minAmount: null,
  maxAmount: null,
  ...overrides
});

describe('amounts', () => {
  it('accepts only positive safe integers', () => {
    expect(isValidAmount(100000)).toBe(true);
    expect(isValidAmount(0)).toBe(false);
    expect(isValidAmount(-1)).toBe(false);
    expect(isValidAmount(10.5)).toBe(false);
    expect(isValidAmount('100')).toBe(false);
    expect(isValidAmount(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(() => assertValidAmount(1.5)).toThrow('amount must be a positive integer');
  });

  it('recognizes supported currencies', () => {
    expect(isCurrency('XAF')).toBe(true);
    expect(isCurrency('EUR')).toBe(false);
  });
});

describe('formatMoney', () => {
  it.each([
    [2450000, '2.450.000 XAF'],
    [8500, '8.500 XAF'],
    [500, '500 XAF'],
    [0, '0 XAF'],
    [1250000, '1.250.000 XAF']
  ])('formats %d', (amount, expected) => {
    expect(formatMoney(amount, 'XAF')).toBe(expected);
  });

  it('shows signs', () => {
    expect(formatMoney(100000, 'XAF', { sign: true })).toBe('+100.000 XAF');
    expect(formatMoney(-50000, 'XAF')).toBe('−50.000 XAF');
  });
});

describe('commissions', () => {
  it('applies fixed + percentage with floor', () => {
    expect(computeCommission(50000, rule({ rateBps: 100 }))).toBe(500);
    expect(computeCommission(12345, rule({ rateBps: 100 }))).toBe(123);
    expect(computeCommission(10000, rule({ fixedAmount: 50, rateBps: 50 }))).toBe(100);
  });

  it('clamps to min and max', () => {
    expect(computeCommission(1000, rule({ rateBps: 100, minAmount: 100 }))).toBe(100);
    expect(computeCommission(5000000, rule({ rateBps: 100, maxAmount: 5000 }))).toBe(5000);
  });

  it('does not overflow on large amounts', () => {
    expect(computeCommission(9_000_000_000_000, rule({ rateBps: 10000 }))).toBe(9_000_000_000_000);
  });

  it('selects by operation, range and tier (tier-specific wins)', () => {
    const rules = [
      rule({ id: 'generic-low', amountTo: 100000 }),
      rule({ id: 'generic-high', amountFrom: 100000 }),
      rule({ id: 'tier2-low', tierCode: 'tier_2', amountTo: 100000 }),
      rule({ id: 'cashin', operationType: 'cash_in' })
    ];
    expect(selectCommissionRule(rules, 'cash_out', 50000, 'tier_1')?.id).toBe('generic-low');
    expect(selectCommissionRule(rules, 'cash_out', 50000, 'tier_2')?.id).toBe('tier2-low');
    expect(selectCommissionRule(rules, 'cash_out', 100000, 'tier_2')?.id).toBe('generic-high');
    expect(selectCommissionRule(rules, 'cash_in', 1, null)?.id).toBe('cashin');
    expect(selectCommissionRule(rules, 'qr_payment', 1, null)).toBeNull();
  });
});

describe('maskPhone', () => {
  it('keeps only the last 4 digits', () => {
    expect(maskPhone('+240222114821')).toBe('****4821');
    expect(maskPhone('12')).toBe('****');
  });
});
