import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { ENV, Env } from '../../config/env';
import type { AgentContext } from '../../common/auth/request-context';
import { AGENT_DB, AgentDb, AgentTrx } from '../../common/db/database';
import { Errors } from '../../common/errors/app-error';
import { Clock, operatingPeriods } from '../../common/time/clock';

export type OperationType = 'cash_in' | 'cash_out' | 'qr_payment';

export interface EffectiveLimits {
  operation_type: OperationType;
  currency: string;
  per_tx_min: number;
  per_tx_max: number;
  daily_amount_max: number;
  daily_count_max: number | null;
  monthly_amount_max: number;
  cooldown_applied: boolean;
}

const minDefined = (a: number, b: number | null) => (b === null ? a : Math.min(a, b));

/**
 * Limits = tier policy, tightened by active per-agent overrides and by the
 * new-device cooldown. Usage counters are reserved inside the same DB
 * transaction that accepts the operation, with row locks, so parallel
 * requests cannot exceed a limit.
 */
@Injectable()
export class LimitsService {
  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env
  ) {}

  async effective(db: AgentDb | AgentTrx, agent: Pick<AgentContext, 'agentId' | 'tierCode' | 'deviceCooldownUntil'>, op: OperationType, currency: string): Promise<EffectiveLimits | null> {
    if (!agent.tierCode) return null;
    const now = this.clock.now();
    const policy = await db
      .selectFrom('agent.limit_policies')
      .selectAll()
      .where('tier_code', '=', agent.tierCode)
      .where('operation_type', '=', op)
      .where('currency', '=', currency)
      .where('effective_from', '<=', now)
      .where((eb) => eb.or([eb('effective_to', 'is', null), eb('effective_to', '>', now)]))
      .orderBy('version', 'desc')
      .executeTakeFirst();
    if (!policy) return null;

    const limits: EffectiveLimits = {
      operation_type: op,
      currency,
      per_tx_min: policy.per_tx_min,
      per_tx_max: policy.per_tx_max,
      daily_amount_max: policy.daily_amount_max,
      daily_count_max: policy.daily_count_max,
      monthly_amount_max: policy.monthly_amount_max,
      cooldown_applied: false
    };

    const overrides = await db
      .selectFrom('agent.agent_limits')
      .selectAll()
      .where('agent_id', '=', agent.agentId)
      .where('operation_type', '=', op)
      .where('currency', '=', currency)
      .where('status', '=', 'active')
      .where('valid_from', '<=', now)
      .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>', now)]))
      .execute();
    for (const o of overrides) {
      limits.per_tx_max = minDefined(limits.per_tx_max, o.per_tx_max);
      limits.daily_amount_max = minDefined(limits.daily_amount_max, o.daily_amount_max);
      limits.monthly_amount_max = minDefined(limits.monthly_amount_max, o.monthly_amount_max);
      if (o.daily_count_max !== null) limits.daily_count_max = minDefined(limits.daily_count_max ?? o.daily_count_max, o.daily_count_max);
    }

    if (agent.deviceCooldownUntil && agent.deviceCooldownUntil > now) {
      const f = (v: number) => Math.floor((v * this.env.NEW_DEVICE_LIMIT_FACTOR_BPS) / 10000);
      limits.per_tx_max = f(limits.per_tx_max);
      limits.daily_amount_max = f(limits.daily_amount_max);
      limits.monthly_amount_max = f(limits.monthly_amount_max);
      limits.cooldown_applied = true;
    }
    return limits;
  }

  async usage(db: AgentDb | AgentTrx, agentId: string, op: OperationType, currency: string) {
    const { day, monthStart } = operatingPeriods(this.clock.now(), this.env.OPERATING_TIMEZONE);
    const rows = await db
      .selectFrom('agent.agent_limit_usage')
      .select(['period_type', 'amount', 'count'])
      .where('agent_id', '=', agentId)
      .where('operation_type', '=', op)
      .where('currency', '=', currency)
      .where((eb) => eb.or([eb.and([eb('period_type', '=', 'day'), eb('period_start', '=', day)]), eb.and([eb('period_type', '=', 'month'), eb('period_start', '=', monthStart)])]))
      .execute();
    const dayRow = rows.find((r) => r.period_type === 'day');
    const monthRow = rows.find((r) => r.period_type === 'month');
    return { dayAmount: dayRow?.amount ?? 0, dayCount: dayRow?.count ?? 0, monthAmount: monthRow?.amount ?? 0 };
  }

  /**
   * Checks and reserves usage for the operating day/month of `at`. Throws
   * the matching LIMIT_* error. The operation must be stored with
   * created_at = at, so release() gives usage back to the same periods.
   */
  async reserve(trx: AgentTrx, agent: AgentContext, op: OperationType, amount: number, currency: string, at: Date): Promise<void> {
    const limits = await this.effective(trx, agent, op, currency);
    if (!limits) throw Errors.noLimitPolicy();
    if (amount < limits.per_tx_min) throw Errors.limitBelowMin({ min: limits.per_tx_min, currency });
    if (amount > limits.per_tx_max) throw Errors.limitPerTx({ max: limits.per_tx_max, currency });

    const { day, monthStart } = operatingPeriods(at, this.env.OPERATING_TIMEZONE);
    const keys = [
      { period_type: 'day' as const, period_start: day },
      { period_type: 'month' as const, period_start: monthStart }
    ];
    await trx
      .insertInto('agent.agent_limit_usage')
      .values(keys.map((k) => ({ agent_id: agent.agentId, operation_type: op, currency, ...k })))
      .onConflict((oc) => oc.columns(['agent_id', 'operation_type', 'period_type', 'period_start', 'currency']).doNothing())
      .execute();
    const rows = await trx
      .selectFrom('agent.agent_limit_usage')
      .select(['period_type', 'amount', 'count'])
      .where('agent_id', '=', agent.agentId)
      .where('operation_type', '=', op)
      .where('currency', '=', currency)
      .where((eb) => eb.or(keys.map((k) => eb.and([eb('period_type', '=', k.period_type), eb('period_start', '=', k.period_start)]))))
      .orderBy('period_type')
      .forUpdate()
      .execute();
    const dayRow = rows.find((r) => r.period_type === 'day')!;
    const monthRow = rows.find((r) => r.period_type === 'month')!;

    if (dayRow.amount + amount > limits.daily_amount_max) {
      throw Errors.limitDaily({ remaining_today: Math.max(0, limits.daily_amount_max - dayRow.amount), currency });
    }
    if (limits.daily_count_max !== null && dayRow.count + 1 > limits.daily_count_max) throw Errors.limitDailyCount();
    if (monthRow.amount + amount > limits.monthly_amount_max) {
      throw Errors.limitMonthly({ remaining_this_month: Math.max(0, limits.monthly_amount_max - monthRow.amount), currency });
    }

    for (const k of keys) {
      await trx
        .updateTable('agent.agent_limit_usage')
        .set({ amount: sql`amount + ${amount}`, count: sql`count + 1` })
        .where('agent_id', '=', agent.agentId)
        .where('operation_type', '=', op)
        .where('currency', '=', currency)
        .where('period_type', '=', k.period_type)
        .where('period_start', '=', k.period_start)
        .execute();
    }
  }

  /** Gives back the usage of an operation that failed or was cancelled. */
  async release(trx: AgentTrx, tx: { agent_id: string; type: string; amount: number; currency: string; created_at: Date }): Promise<void> {
    const { day, monthStart } = operatingPeriods(tx.created_at, this.env.OPERATING_TIMEZONE);
    for (const [periodType, periodStart] of [
      ['day', day],
      ['month', monthStart]
    ] as const) {
      await trx
        .updateTable('agent.agent_limit_usage')
        .set({ amount: sql`GREATEST(amount - ${tx.amount}, 0)`, count: sql`GREATEST(count - 1, 0)` })
        .where('agent_id', '=', tx.agent_id)
        .where('operation_type', '=', tx.type)
        .where('currency', '=', tx.currency)
        .where('period_type', '=', periodType)
        .where('period_start', '=', periodStart)
        .execute();
    }
  }
}
