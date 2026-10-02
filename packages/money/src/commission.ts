/** A commission rule as configured in agent.commission_rules. */
export interface CommissionRule {
  id: string;
  operationType: string;
  tierCode: string | null;
  amountFrom: number;
  amountTo: number | null;
  fixedAmount: number;
  rateBps: number;
  minAmount: number | null;
  maxAmount: number | null;
}

/**
 * Picks the rule for an amount: matching operation, amount within
 * [amountFrom, amountTo), and the tier-specific rule wins over the
 * generic (tierCode = null) one.
 */
export function selectCommissionRule(
  rules: readonly CommissionRule[],
  operationType: string,
  amount: number,
  tierCode: string | null
): CommissionRule | null {
  const candidates = rules.filter(
    (r) =>
      r.operationType === operationType &&
      amount >= r.amountFrom &&
      (r.amountTo === null || amount < r.amountTo) &&
      (r.tierCode === null || r.tierCode === tierCode)
  );
  return candidates.find((r) => r.tierCode !== null) ?? candidates[0] ?? null;
}

/**
 * commission = clamp(fixed + floor(amount * rateBps / 10000), min, max)
 * Integer arithmetic only (BigInt for the product to avoid overflow).
 */
export function computeCommission(amount: number, rule: CommissionRule): number {
  const variable = Number((BigInt(amount) * BigInt(rule.rateBps)) / 10000n);
  let commission = rule.fixedAmount + variable;
  if (rule.minAmount !== null) commission = Math.max(commission, rule.minAmount);
  if (rule.maxAmount !== null) commission = Math.min(commission, rule.maxAmount);
  return Math.max(0, commission);
}
