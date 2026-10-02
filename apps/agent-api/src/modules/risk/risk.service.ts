import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { ENV, Env } from '../../config/env';
import { AuditService } from '../../common/audit/audit.service';
import type { AgentContext } from '../../common/auth/request-context';
import { AGENT_DB, AgentDb, AgentTrx } from '../../common/db/database';
import { Errors } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { LimitsService } from '../operations/limits.service';

export interface RiskInput {
  agent: AgentContext;
  type: 'cash_in' | 'cash_out';
  amount: number;
  currency: string;
  customerRef: string;
}

export interface Signal {
  rule: string;
  version: number;
  mode: 'shadow' | 'active';
  hit: boolean;
  weight: number;
  value?: unknown;
}

export interface RiskResult {
  score: number;
  level: 'low' | 'medium' | 'high';
  decision: 'allow' | 'block';
  signals: Signal[];
  rulesVersion: string;
}

interface Rule {
  code: string;
  version: number;
  mode: 'shadow' | 'active';
  weight: number;
  params: Record<string, number>;
}

const MIN = 60_000;
/** Money that is still moving or has moved; failed/cancelled operations don't count. */
const LIVE = ['pending', 'processing', 'completed'];

/**
 * Synchronous risk engine (docs/06-seguridad.md §8), run before any money
 * moves on cash-in and cash-out.
 *
 *   score = sum of the weights of ACTIVE rules that hit (0–100)
 *   LOW < RISK_MEDIUM_SCORE ≤ MEDIUM < RISK_HIGH_SCORE ≤ HIGH
 *   LOW, MEDIUM -> allow (MEDIUM is recorded for monitoring)
 *   HIGH        -> block before money moves + a fraud case for review
 *
 * Shadow rules are evaluated and recorded but never change the decision.
 * The agent never learns which rule fired.
 */
@Injectable()
export class RiskService {
  private readonly logger = new Logger('Risk');

  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly limits: LimitsService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env
  ) {}

  private async rules(): Promise<Map<string, Rule>> {
    // Latest enabled version of each rule.
    const rows = await this.db
      .selectFrom('agent.fraud_rules')
      .select(['code', 'version', 'mode', 'weight', 'params'])
      .distinctOn('code')
      .where('enabled', '=', true)
      .orderBy('code')
      .orderBy('version', 'desc')
      .execute();
    return new Map(rows.map((r) => [r.code, { code: r.code, version: r.version, mode: r.mode, weight: Number(r.weight), params: (r.params ?? {}) as Record<string, number> }]));
  }

  /**
   * Deposits only: same agent, customer and amount a few minutes ago, so the
   * agent must confirm it is a different deposit (409 POSSIBLE_DUPLICATE).
   */
  async assertNotDuplicate(input: RiskInput, confirmed: boolean): Promise<void> {
    if (confirmed) return;
    const rule = (await this.rules()).get('duplicate');
    if (!rule || rule.mode !== 'active') return;
    const since = new Date(this.clock.now().getTime() - (rule.params.window_minutes ?? 10) * MIN);
    const previous = await this.db
      .selectFrom('agent.agent_transactions')
      .select(['reference', 'created_at'])
      .where('agent_id', '=', input.agent.agentId)
      .where('customer_ref', '=', input.customerRef)
      .where('type', '=', input.type)
      .where('amount', '=', input.amount)
      .where('status', 'in', LIVE)
      .where('created_at', '>=', since)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    if (previous) {
      throw Errors.possibleDuplicate({
        previous_reference: previous.reference,
        minutes_ago: Math.max(0, Math.floor((this.clock.now().getTime() - previous.created_at.getTime()) / MIN))
      });
    }
  }

  async assess(input: RiskInput): Promise<RiskResult> {
    const rules = await this.rules();
    const now = this.clock.now().getTime();
    const ago = (minutes: number) => new Date(now - minutes * MIN);
    const signals: Signal[] = [];
    const add = (code: string, hit: boolean, value?: unknown) => {
      const r = rules.get(code);
      if (r) signals.push({ rule: code, version: r.version, mode: r.mode, hit, weight: r.weight, value });
    };
    const agentTx = () => this.db.selectFrom('agent.agent_transactions').where('agent_id', '=', input.agent.agentId).where('status', 'in', LIVE);

    const velocity = rules.get('velocity_agent');
    if (velocity) {
      const r = await agentTx()
        .select(sql<number>`COUNT(*)::int`.as('n'))
        .where('created_at', '>=', ago(velocity.params.window_minutes ?? 5))
        .executeTakeFirstOrThrow();
      add('velocity_agent', r.n + 1 > (velocity.params.max_operations ?? 5), r.n + 1);
    }

    const unusual = rules.get('amount_unusual');
    if (unusual) {
      const r = await agentTx()
        .select([sql<number>`COUNT(*)::int`.as('n'), sql<number>`COALESCE(AVG(amount), 0)::float8`.as('avg')])
        .where('type', '=', input.type)
        .where('status', '=', 'completed')
        .where('created_at', '>=', new Date(now - (unusual.params.lookback_days ?? 30) * 86_400_000))
        .executeTakeFirstOrThrow();
      const enough = r.n >= (unusual.params.min_history ?? 10);
      add('amount_unusual', enough && input.amount > r.avg * (unusual.params.multiplier ?? 5), { history: r.n, average: Math.round(r.avg) });
    }

    const circular = rules.get('circular');
    if (circular) {
      const opposite = input.type === 'cash_in' ? 'cash_out' : 'cash_in';
      const r = await agentTx()
        .select(sql<number>`COUNT(*)::int`.as('n'))
        .where('customer_ref', '=', input.customerRef)
        .where('type', '=', opposite)
        .where('created_at', '>=', ago(circular.params.window_minutes ?? 30))
        .executeTakeFirstOrThrow();
      add('circular', r.n > 0, r.n);
    }

    const structuring = rules.get('structuring');
    if (structuring) {
      const limits = await this.limits.effective(this.db, input.agent, input.type, input.currency);
      if (limits) {
        const floor = Math.floor((limits.per_tx_max * (structuring.params.threshold_pct ?? 90)) / 100);
        const r = await agentTx()
          .select(sql<number>`COUNT(*)::int`.as('n'))
          .where('amount', '>=', floor)
          .where('created_at', '>=', ago(structuring.params.window_minutes ?? 60))
          .executeTakeFirstOrThrow();
        const count = r.n + (input.amount >= floor ? 1 : 0);
        add('structuring', input.amount >= floor && count >= (structuring.params.min_operations ?? 3), count);
      }
    }

    const customer = rules.get('customer_velocity');
    if (customer) {
      const r = await this.db
        .selectFrom('agent.agent_transactions')
        // Other agents this customer used, plus this one.
        .select([sql<number>`COUNT(*)::int`.as('n'), sql<number>`(COUNT(DISTINCT agent_id) FILTER (WHERE agent_id <> ${input.agent.agentId}))::int`.as('others')])
        .where('customer_ref', '=', input.customerRef)
        .where('status', 'in', LIVE)
        .where('created_at', '>=', ago(customer.params.window_minutes ?? 60))
        .executeTakeFirstOrThrow();
      const agents = r.others + 1;
      add('customer_velocity', r.n + 1 > (customer.params.max_operations ?? 6) || agents > (customer.params.max_agents ?? 3), { operations: r.n + 1, agents });
    }

    add('new_device', !!input.agent.deviceCooldownUntil && input.agent.deviceCooldownUntil.getTime() > now);

    const score = Math.min(100, signals.filter((s) => s.hit && s.mode === 'active').reduce((sum, s) => sum + s.weight, 0));
    const level = score >= this.env.RISK_HIGH_SCORE ? 'high' : score >= this.env.RISK_MEDIUM_SCORE ? 'medium' : 'low';
    const rulesVersion = [...rules.values()].map((r) => `${r.code}@${r.version}:${r.mode[0]}`).sort().join(',');
    return { score, level, decision: level === 'high' ? 'block' : 'allow', signals, rulesVersion };
  }

  /** Stores the assessment (with the operation when there is one). */
  async record(db: AgentDb | AgentTrx, agentId: string, result: RiskResult, transactionId: string | null): Promise<string> {
    const row = await db
      .insertInto('agent.risk_assessments')
      .values({
        transaction_id: transactionId,
        agent_id: agentId,
        subject: 'transaction',
        score: result.score,
        level: result.level,
        decision: result.decision,
        signals: JSON.stringify(result.signals),
        rules_version: result.rulesVersion,
        compliance_hook: null
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /**
   * HIGH risk: nothing is created or reserved; the attempt is recorded, a
   * fraud case is opened for review, and the agent gets a neutral message.
   */
  async blockAndOpenCase(input: RiskInput, result: RiskResult): Promise<never> {
    const caseRef = await this.db.transaction().execute(async (trx) => {
      const assessmentId = await this.record(trx, input.agent.agentId, result, null);
      const c = await trx
        .insertInto('agent.fraud_cases')
        .values({ agent_id: input.agent.agentId, transaction_id: null, risk_assessment_id: assessmentId, assigned_to: null, resolution_notes: null, closed_at: null })
        .returning('reference')
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, {
        actorType: 'system',
        actorId: 'risk-engine',
        agentId: input.agent.agentId,
        action: input.type === 'cash_in' ? 'CASH_IN' : 'CASH_OUT',
        resourceType: 'fraud_case',
        resourceId: c.reference,
        result: 'denied',
        reasonCode: 'RISK_HIGH',
        deviceId: input.agent.deviceId,
        metadata: { amount: input.amount, currency: input.currency, score: result.score, rules: result.signals.filter((s) => s.hit && s.mode === 'active').map((s) => s.rule) }
      });
      return c.reference;
    });
    this.logger.warn(`Blocked ${input.type} by ${input.agent.agentCode} (score ${result.score}), case ${caseRef}`);
    throw Errors.operationUnderReview();
  }
}
