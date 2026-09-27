import { Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { AgentAuthGuard } from '../../common/auth/agent-auth.guard';
import { AgentContext, CurrentAgent } from '../../common/auth/request-context';
import { AGENT_DB, AgentDb } from '../../common/db/database';
import { Errors } from '../../common/errors/app-error';
import { decodeCursor, encodeCursor, isUuid } from '../../common/pagination';
import { Clock } from '../../common/time/clock';

const ListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
  unread: z.enum(['true', 'false']).optional()
});

/**
 * In-app notification inbox (docs/05-api.md §13). Texts are i18n keys plus
 * parameters, so the app shows them in the agent's language.
 */
@Controller('agent/v1/notifications')
@UseGuards(AgentAuthGuard)
export class NotificationsController {
  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly clock: Clock
  ) {}

  @Get()
  async list(@CurrentAgent() agent: AgentContext, @Query() raw: unknown) {
    const q = ListSchema.parse(raw);
    const cursor = decodeCursor(q.cursor);
    let query = this.db.selectFrom('agent.agent_notifications').selectAll().where('agent_id', '=', agent.agentId);
    if (q.unread === 'true') query = query.where('read_at', 'is', null);
    if (cursor) query = query.where((eb) => eb(sql`(created_at, id)`, '<', sql`(${new Date(cursor.t)}::timestamptz, ${cursor.i}::uuid)`));
    const [rows, unread] = await Promise.all([
      query.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(q.limit + 1).execute(),
      this.unreadCount(agent.agentId)
    ]);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      data: page.map((n) => ({
        id: n.id,
        type: n.type,
        title_key: n.title_key,
        body_key: n.body_key,
        params: n.params,
        related_transaction_id: n.related_transaction_id,
        created_at: n.created_at.toISOString(),
        read_at: n.read_at?.toISOString() ?? null
      })),
      unread_count: unread,
      next_cursor: rows.length > q.limit && last ? encodeCursor(last.created_at, last.id) : null
    };
  }

  /** Cheap call for the bell badge. */
  @Get('unread-count')
  async count(@CurrentAgent() agent: AgentContext) {
    return { unread_count: await this.unreadCount(agent.agentId) };
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@CurrentAgent() agent: AgentContext) {
    const res = await this.db.updateTable('agent.agent_notifications').set({ read_at: this.clock.now() }).where('agent_id', '=', agent.agentId).where('read_at', 'is', null).executeTakeFirst();
    return { updated: Number(res.numUpdatedRows), unread_count: 0 };
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@CurrentAgent() agent: AgentContext, @Param('id') id: string) {
    if (!isUuid(id)) throw Errors.notFound();
    const row = await this.db.selectFrom('agent.agent_notifications').select(['id', 'read_at']).where('id', '=', id).where('agent_id', '=', agent.agentId).executeTakeFirst();
    if (!row) throw Errors.notFound();
    if (!row.read_at) await this.db.updateTable('agent.agent_notifications').set({ read_at: this.clock.now() }).where('id', '=', id).execute();
    return { id, unread_count: await this.unreadCount(agent.agentId) };
  }

  private async unreadCount(agentId: string): Promise<number> {
    const r = await this.db
      .selectFrom('agent.agent_notifications')
      .select(sql<number>`COUNT(*)::bigint`.as('n'))
      .where('agent_id', '=', agentId)
      .where('read_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }
}
