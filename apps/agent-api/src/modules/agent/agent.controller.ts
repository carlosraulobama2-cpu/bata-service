import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ENV, Env } from '../../config/env';
import { AgentAuthGuard } from '../../common/auth/agent-auth.guard';
import { AgentContext, CurrentAgent } from '../../common/auth/request-context';
import { AGENT_DB, AgentDb } from '../../common/db/database';
import { Clock } from '../../common/time/clock';
import { agentCommission, agentFloat, LedgerClient } from '../../integrations/ledger/ledger.client';
import { LimitsService, OperationType } from '../operations/limits.service';

const FEATURES_BY_STATUS: Record<string, string[]> = {
  active: ['dashboard', 'cash_in', 'cash_out', 'qr', 'transactions', 'commissions', 'settlements', 'profile', 'security', 'support'],
  suspended: ['transactions', 'commissions', 'settlements', 'profile', 'support'],
  approved: ['onboarding_status', 'profile', 'support'],
  under_review: ['onboarding_status', 'kyc', 'support'],
  pending: ['onboarding_status', 'kyc', 'support']
};

@Controller('agent/v1')
@UseGuards(AgentAuthGuard)
export class AgentController {
  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly ledger: LedgerClient,
    private readonly limits: LimitsService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env
  ) {}

  /** The app decides which screens to show from this, never from local state. */
  @Get('me')
  async me(@CurrentAgent() agent: AgentContext) {
    const row = await this.db
      .selectFrom('agent.agents as a')
      .leftJoin('agent.agent_profiles as p', 'p.agent_id', 'a.id')
      .leftJoin('agent.agent_businesses as b', 'b.agent_id', 'a.id')
      .leftJoin('agent.agent_tiers as t', 't.code', 'a.tier_code')
      .select(['a.agent_code', 'a.status', 'a.country', 'p.first_name', 'p.last_name', 'p.city', 'b.trade_name', 't.code as tier_code', 't.name as tier_name'])
      .where('a.id', '=', agent.agentId)
      .executeTakeFirstOrThrow();
    return {
      agent: {
        agent_code: row.agent_code,
        first_name: row.first_name,
        last_name_initial: row.last_name ? `${row.last_name.charAt(0)}.` : null,
        status: row.status,
        tier: row.tier_code ? { code: row.tier_code, name: row.tier_name } : null,
        location: { city: row.city, country: row.country },
        business: row.trade_name ? { trade_name: row.trade_name } : null
      },
      features: FEATURES_BY_STATUS[row.status] ?? [],
      device: { id: agent.deviceId, cooldown_until: agent.deviceCooldownUntil?.toISOString() ?? null },
      min_app_version: this.env.MIN_APP_VERSION
    };
  }

  /** Authoritative balances from the ledger. Physical cash is unknown unless declared. */
  @Get('balance')
  async balance(@CurrentAgent() agent: AgentContext) {
    const c = this.env.DEFAULT_CURRENCY;
    const [float, commission] = await Promise.all([this.ledger.getBalance(agentFloat(agent.agentCode, c)), this.ledger.getBalance(agentCommission(agent.agentCode, c))]);
    return {
      float: { currency: c, available: float.available, held: float.held, ledger_balance: float.balance, as_of: this.clock.now().toISOString() },
      commissions_pending: { currency: c, amount: commission.balance },
      declared_cash: null
    };
  }

  @Get('limits')
  async limitsView(@CurrentAgent() agent: AgentContext) {
    const c = this.env.DEFAULT_CURRENCY;
    const result = [];
    for (const op of ['cash_in', 'cash_out'] as OperationType[]) {
      const l = await this.limits.effective(this.db, agent, op, c);
      if (!l) continue;
      const u = await this.limits.usage(this.db, agent.agentId, op, c);
      result.push({
        operation_type: op,
        currency: c,
        per_transaction: { min: l.per_tx_min, max: l.per_tx_max },
        daily: { max: l.daily_amount_max, used: u.dayAmount, remaining: Math.max(0, l.daily_amount_max - u.dayAmount), count_max: l.daily_count_max, count_used: u.dayCount },
        monthly: { max: l.monthly_amount_max, used: u.monthAmount, remaining: Math.max(0, l.monthly_amount_max - u.monthAmount) },
        cooldown_applied: l.cooldown_applied
      });
    }
    return { tier: agent.tierCode, cooldown_until: agent.deviceCooldownUntil?.toISOString() ?? null, limits: result };
  }
}
