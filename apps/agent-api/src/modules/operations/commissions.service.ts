import { Injectable } from '@nestjs/common';
import { computeCommission, selectCommissionRule } from '@bata/money';
import type { AgentDb, AgentTrx } from '../../common/db/database';
import { Clock } from '../../common/time/clock';

export interface CommissionQuote {
  amount: number;
  ruleId: string | null;
}

/** Commission from the active, approved plan (never hard-coded). */
@Injectable()
export class CommissionsService {
  constructor(private readonly clock: Clock) {}

  async quote(db: AgentDb | AgentTrx, operationType: string, amount: number, currency: string, tierCode: string | null): Promise<CommissionQuote> {
    const now = this.clock.now();
    const rows = await db
      .selectFrom('agent.commission_rules as r')
      .innerJoin('agent.commission_plans as p', 'p.id', 'r.plan_id')
      .select(['r.id', 'r.operation_type', 'r.tier_code', 'r.amount_from', 'r.amount_to', 'r.fixed_amount', 'r.rate_bps', 'r.min_amount', 'r.max_amount'])
      .where('p.status', '=', 'active')
      .where('p.currency', '=', currency)
      .where('p.effective_from', '<=', now)
      .where((eb) => eb.or([eb('p.effective_to', 'is', null), eb('p.effective_to', '>', now)]))
      .where('r.operation_type', '=', operationType)
      .execute();
    const rule = selectCommissionRule(
      rows.map((r) => ({
        id: r.id,
        operationType: r.operation_type,
        tierCode: r.tier_code,
        amountFrom: r.amount_from,
        amountTo: r.amount_to,
        fixedAmount: r.fixed_amount,
        rateBps: r.rate_bps,
        minAmount: r.min_amount,
        maxAmount: r.max_amount
      })),
      operationType,
      amount,
      tierCode
    );
    return rule ? { amount: computeCommission(amount, rule), ruleId: rule.id } : { amount: 0, ruleId: null };
  }
}
