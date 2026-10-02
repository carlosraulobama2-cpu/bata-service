import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { ENV, Env } from '../../config/env';
import type { AgentContext } from '../../common/auth/request-context';
import { AGENT_DB, AgentDb } from '../../common/db/database';
import { Errors } from '../../common/errors/app-error';
import { Clock, operatingPeriods } from '../../common/time/clock';
import { presentTransaction } from './presenter';
import { z } from 'zod';
import { ListTransactionsSchema } from './operations.dto';

const TYPES = ['cash_in', 'cash_out', 'qr_payment', 'commission', 'settlement', 'refund', 'authorized_adjustment'];
const STATUSES = ['pending', 'processing', 'completed', 'failed', 'reversed', 'cancelled', 'disputed'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Midnight of a YYYY-MM-DD day in the given time zone, as a UTC instant. */
function startOfDay(day: string, timeZone: string): Date {
  const probe = new Date(`${day}T12:00:00Z`);
  const offset = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(probe).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(offset);
  const minutes = m ? (m[1] === '-' ? -1 : 1) * (parseInt(m[2]!, 10) * 60 + parseInt(m[3] ?? '0', 10)) : 0;
  return new Date(Date.parse(`${day}T00:00:00Z`) - minutes * 60000);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class TransactionsService {
  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env
  ) {}

  private range(q: z.infer<typeof ListTransactionsSchema>): { from: Date; to: Date } {
    const tz = this.env.OPERATING_TIMEZONE;
    const now = this.clock.now();
    const { day: today, monthStart } = operatingPeriods(now, tz);
    switch (q.period) {
      case 'today':
        return { from: startOfDay(today, tz), to: startOfDay(addDays(today, 1), tz) };
      case 'yesterday':
        return { from: startOfDay(addDays(today, -1), tz), to: startOfDay(today, tz) };
      case 'last_7_days':
        return { from: startOfDay(addDays(today, -6), tz), to: startOfDay(addDays(today, 1), tz) };
      case 'this_month':
        return { from: startOfDay(monthStart, tz), to: startOfDay(addDays(today, 1), tz) };
      case 'custom': {
        if (!q.from || !q.to) throw Errors.validation({ fields: ['from', 'to'] });
        const from = new Date(q.from);
        const to = new Date(q.to);
        if (from >= to || to.getTime() - from.getTime() > 92 * 86400000) throw Errors.validation({ fields: ['from', 'to'] });
        return { from, to };
      }
    }
  }

  async list(agent: AgentContext, raw: unknown) {
    const q = ListTransactionsSchema.parse(raw);
    const { from, to } = this.range(q);
    const types = q.type ? q.type.split(',') : [];
    const statuses = q.status ? q.status.split(',') : [];
    if (types.some((t) => !TYPES.includes(t)) || statuses.some((s) => !STATUSES.includes(s))) throw Errors.validation({ fields: ['type', 'status'] });

    let cursor: { t: string; i: string } | null = null;
    if (q.cursor) {
      try {
        cursor = JSON.parse(Buffer.from(q.cursor, 'base64url').toString('utf8'));
        if (!cursor || typeof cursor.t !== 'string' || !UUID.test(cursor.i)) throw new Error();
      } catch {
        throw Errors.validation({ fields: ['cursor'] });
      }
    }

    let query = this.db
      .selectFrom('agent.agent_transactions')
      .selectAll()
      .where('agent_id', '=', agent.agentId)
      .where('created_at', '>=', from)
      .where('created_at', '<', to);
    if (types.length) query = query.where('type', 'in', types);
    if (statuses.length) query = query.where('status', 'in', statuses);
    if (cursor) {
      const c = cursor;
      query = query.where((eb) => eb(sql`(created_at, id)`, '<', sql`(${new Date(c.t)}::timestamptz, ${c.i}::uuid)`));
    }
    const rows = await query.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(q.limit + 1).execute();

    const totalsRows = await this.db
      .selectFrom('agent.agent_transactions')
      .select(['type', sql<number>`COALESCE(SUM(amount), 0)::bigint`.as('amount'), sql<number>`COALESCE(SUM(commission_amount), 0)::bigint`.as('commission')])
      .where('agent_id', '=', agent.agentId)
      .where('status', '=', 'completed')
      .where('created_at', '>=', from)
      .where('created_at', '<', to)
      .groupBy('type')
      .execute();
    const totals = { cash_in: 0, cash_out: 0, qr_payment: 0, commissions: 0, currency: this.env.DEFAULT_CURRENCY };
    for (const r of totalsRows) {
      if (r.type in totals) (totals as Record<string, number | string>)[r.type] = Number(r.amount);
      totals.commissions += Number(r.commission);
    }

    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      data: page.map((tx) => presentTransaction(tx, agent.agentCode)),
      totals,
      range: { from: from.toISOString(), to: to.toISOString() },
      next_cursor: rows.length > q.limit && last ? Buffer.from(JSON.stringify({ t: last.created_at.toISOString(), i: last.id })).toString('base64url') : null
    };
  }

  async get(agent: AgentContext, id: string) {
    if (!UUID.test(id)) throw Errors.notFound();
    const tx = await this.db.selectFrom('agent.agent_transactions').selectAll().where('id', '=', id).where('agent_id', '=', agent.agentId).executeTakeFirst();
    if (!tx) throw Errors.notFound(); // other agents' operations are indistinguishable from missing ones
    const events = await this.db
      .selectFrom('agent.agent_transaction_events')
      .select(['to_status', 'event', 'created_at'])
      .where('transaction_id', '=', tx.id)
      .orderBy('id')
      .execute();
    return {
      transaction: {
        ...presentTransaction(tx, agent.agentCode),
        events: events.map((e) => ({ status: e.to_status, event: e.event, at: e.created_at.toISOString() }))
      }
    };
  }

  async getByKey(agent: AgentContext, key: string) {
    const tx = await this.db.selectFrom('agent.agent_transactions').select('id').where('agent_id', '=', agent.agentId).where('idempotency_key', '=', key).executeTakeFirst();
    if (!tx) throw Errors.notFound();
    return this.get(agent, tx.id);
  }
}
