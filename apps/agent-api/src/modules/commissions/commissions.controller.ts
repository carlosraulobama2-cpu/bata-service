import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { ENV, Env } from '../../config/env';
import { AgentAuthGuard } from '../../common/auth/agent-auth.guard';
import { AgentContext, CurrentAgent } from '../../common/auth/request-context';
import { AGENT_DB, AgentDb } from '../../common/db/database';
import { decodeCursor, encodeCursor } from '../../common/pagination';
import { Clock, operatingPeriods } from '../../common/time/clock';
import { agentCommission, LedgerClient } from '../../integrations/ledger/ledger.client';

const ListSchema = z.object({
  type: z.enum(['cash_in', 'cash_out', 'qr_payment']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional()
});

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Commissions earned by the agent (docs/05-api.md §11). Read-only. */
@Controller('agent/v1/commissions')
@UseGuards(AgentAuthGuard)
export class CommissionsController {
  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly ledger: LedgerClient,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env
  ) {}

  @Get('summary')
  async summary(@CurrentAgent() agent: AgentContext) {
    const c = this.env.DEFAULT_CURRENCY;
    const { day: today, monthStart } = operatingPeriods(this.clock.now(), this.env.OPERATING_TIMEZONE);
    const weekStart = addDays(today, -6);
    const periodSum = (from: string | null) =>
      sql<number>`COALESCE(SUM(amount) FILTER (WHERE ${from === null ? sql`TRUE` : sql`day >= ${from}::date`}), 0)::bigint`;
    const [totals, byType, pending] = await Promise.all([
      this.db
        .selectFrom('agent.agent_commission_daily')
        .select([periodSum(today).as('today'), periodSum(weekStart).as('last_7_days'), periodSum(monthStart).as('this_month'), periodSum(null).as('all_time')])
        .where('agent_id', '=', agent.agentId)
        .where('currency', '=', c)
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('agent.agent_commission_daily')
        .select(['operation_type', sql<number>`SUM(count)::bigint`.as('count'), sql<number>`SUM(amount)::bigint`.as('amount')])
        .where('agent_id', '=', agent.agentId)
        .where('currency', '=', c)
        .where('day', '>=', monthStart)
        .groupBy('operation_type')
        .orderBy('amount', 'desc')
        .execute(),
      this.ledger.getBalance(agentCommission(agent.agentCode, c))
    ]);
    return {
      currency: c,
      today: Number(totals.today),
      last_7_days: Number(totals.last_7_days),
      this_month: Number(totals.this_month),
      all_time: Number(totals.all_time),
      // Authoritative: what the ledger owes the agent right now.
      pending_settlement: pending.balance,
      by_type_this_month: byType.map((r) => ({ operation_type: r.operation_type, count: Number(r.count), amount: Number(r.amount) }))
    };
  }

  @Get()
  async list(@CurrentAgent() agent: AgentContext, @Query() raw: unknown) {
    const q = ListSchema.parse(raw);
    const cursor = decodeCursor(q.cursor);
    let query = this.db
      .selectFrom('agent.agent_commissions as c')
      .innerJoin('agent.agent_transactions as t', 't.id', 'c.transaction_id')
      .select(['c.id', 'c.transaction_id', 't.reference', 'c.operation_type', 'c.base_amount', 'c.commission_amount', 'c.currency', 'c.status', 'c.accrued_at'])
      .where('c.agent_id', '=', agent.agentId);
    if (q.type) query = query.where('c.operation_type', '=', q.type);
    if (cursor) query = query.where((eb) => eb(sql`(c.accrued_at, c.id)`, '<', sql`(${new Date(cursor.t)}::timestamptz, ${cursor.i}::uuid)`));
    const rows = await query.orderBy('c.accrued_at', 'desc').orderBy('c.id', 'desc').limit(q.limit + 1).execute();
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      data: page.map((r) => ({
        id: r.id,
        transaction_id: r.transaction_id,
        reference: r.reference,
        operation_type: r.operation_type,
        base_amount: r.base_amount,
        commission: r.commission_amount,
        currency: r.currency,
        status: r.status,
        accrued_at: r.accrued_at.toISOString()
      })),
      next_cursor: rows.length > q.limit && last ? encodeCursor(last.accrued_at, last.id) : null
    };
  }
}
