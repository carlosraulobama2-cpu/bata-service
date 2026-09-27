import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { AgentAuthGuard } from '../../common/auth/agent-auth.guard';
import { AgentContext, CurrentAgent } from '../../common/auth/request-context';
import { AGENT_DB, AgentDb } from '../../common/db/database';
import { Errors } from '../../common/errors/app-error';
import { decodeCursor, encodeCursor, isUuid } from '../../common/pagination';
import { Clock } from '../../common/time/clock';
import { MANDATORY_TYPES, OPTIONAL_TYPES } from './push-templates';

const PreferencesSchema = z.object({ preferences: z.record(z.string(), z.boolean()) });

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

  /** Which notifications also arrive as push. Security and account ones can't be switched off. */
  @Get('preferences')
  async preferences(@CurrentAgent() agent: AgentContext) {
    const rows = await this.db.selectFrom('agent.agent_notification_preferences').select(['type', 'push_enabled']).where('agent_id', '=', agent.agentId).execute();
    const off = new Set(rows.filter((r) => !r.push_enabled).map((r) => r.type));
    return {
      data: [
        ...OPTIONAL_TYPES.map((type) => ({ type, push_enabled: !off.has(type), locked: false })),
        ...MANDATORY_TYPES.map((type) => ({ type, push_enabled: true, locked: true }))
      ]
    };
  }

  @Put('preferences')
  async setPreferences(@CurrentAgent() agent: AgentContext, @Body() body: unknown) {
    const { preferences } = PreferencesSchema.parse(body);
    for (const [type, enabled] of Object.entries(preferences)) {
      if ((MANDATORY_TYPES as readonly string[]).includes(type)) {
        if (!enabled) throw Errors.validation({ fields: [type], reason: 'mandatory_notification' });
        continue;
      }
      if (!(OPTIONAL_TYPES as readonly string[]).includes(type)) throw Errors.validation({ fields: [type] });
      await this.db
        .insertInto('agent.agent_notification_preferences')
        .values({ agent_id: agent.agentId, type, push_enabled: enabled })
        .onConflict((oc) => oc.columns(['agent_id', 'type']).doUpdateSet({ push_enabled: enabled }))
        .execute();
    }
    return this.preferences(agent);
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
