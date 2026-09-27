import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { AGENT_DB, AgentDb } from '../../common/db/database';
import { Clock } from '../../common/time/clock';
import { PushMessage, PushSender } from '../../integrations/push/push.sender';
import { MANDATORY_TYPES, renderPush } from './push-templates';

const MAX_ATTEMPTS = 5;
/** Backoff after each failed attempt: 30 s, 2 min, 10 min, 30 min. */
const BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000];
/** A push about an operation older than this is noise, not news. */
const STALE_AFTER_MS = 24 * 3600 * 1000;
/** A claimed row is invisible to other workers for this long (a crashed worker's rows come back after it). */
const LEASE_MS = 5 * 60 * 1000;

/**
 * Sends queued push deliveries (one per notification, enqueued by a DB
 * trigger). Rows are claimed in a short transaction (SKIP LOCKED + a lease
 * on next_attempt_at), then sent OUTSIDE any transaction so a slow
 * provider never holds database locks. Delivery is at-least-once.
 */
@Injectable()
export class PushDispatcher {
  private readonly logger = new Logger('Push');

  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly sender: PushSender,
    private readonly clock: Clock
  ) {}

  async run(batch = 100): Promise<{ sent: number; skipped: number; retried: number; failed: number }> {
    const stats = { sent: 0, skipped: 0, retried: 0, failed: 0 };
    const now = this.clock.now();
    const due = await this.db.transaction().execute(async (trx) => {
      const rows = await trx
        .selectFrom('agent.agent_notification_deliveries as d')
        .innerJoin('agent.agent_notifications as n', 'n.id', 'd.notification_id')
        .select(['d.id', 'd.attempts', 'n.id as notification_id', 'n.agent_id', 'n.type', 'n.title_key', 'n.params', 'n.related_transaction_id', 'n.created_at'])
        .where('d.channel', '=', 'push')
        .where('d.status', '=', 'queued')
        .where('d.next_attempt_at', '<=', now)
        .orderBy('d.next_attempt_at')
        .limit(batch)
        .forUpdate('d')
        .skipLocked()
        .execute();
      if (rows.length) {
        await trx
          .updateTable('agent.agent_notification_deliveries')
          .set({ next_attempt_at: new Date(now.getTime() + LEASE_MS) })
          .where('id', 'in', rows.map((r) => r.id))
          .execute();
      }
      return rows;
    });
    if (!due.length) return stats;

    const agentIds = [...new Set(due.map((d) => d.agent_id))];
    const [devices, prefs] = await Promise.all([
      this.db.selectFrom('agent.agent_devices').select(['id', 'agent_id', 'push_token']).where('agent_id', 'in', agentIds).where('status', '=', 'trusted').where('push_token', 'is not', null).execute(),
      this.db.selectFrom('agent.agent_notification_preferences').select(['agent_id', 'type']).where('agent_id', 'in', agentIds).where('push_enabled', '=', false).execute()
    ]);
    const muted = new Set(prefs.map((p) => `${p.agent_id}:${p.type}`));

    const finish = (id: string, status: 'sent' | 'skipped' | 'failed', patch: { last_error?: string | null; sent_to?: number; provider_ref?: string | null; attempts?: number } = {}) =>
      this.db.updateTable('agent.agent_notification_deliveries').set({ status, updated_at: now, ...patch }).where('id', '=', id).execute();

    for (const d of due) {
      const params = (d.params ?? {}) as Record<string, unknown>;
      const mandatory = (MANDATORY_TYPES as readonly string[]).includes(d.type);
      if (!mandatory && muted.has(`${d.agent_id}:${d.type}`)) {
        await finish(d.id, 'skipped', { last_error: 'muted_by_agent' });
        stats.skipped++;
        continue;
      }
      if (now.getTime() - d.created_at.getTime() > STALE_AFTER_MS) {
        await finish(d.id, 'skipped', { last_error: 'stale' });
        stats.skipped++;
        continue;
      }
      // "New device" goes to the agent's OTHER devices, never to the new one.
      const targets = devices.filter((dev) => dev.agent_id === d.agent_id && dev.id !== params.device_id);
      if (!targets.length) {
        await finish(d.id, 'skipped', { last_error: 'no_push_device' });
        stats.skipped++;
        continue;
      }

      const text = renderPush(d.title_key, params);
      const messages: PushMessage[] = targets.map((dev) => ({
        to: dev.push_token!,
        title: text.title,
        body: text.body,
        channelId: text.channel,
        data: { notification_id: d.notification_id, type: d.type, transaction_id: d.related_transaction_id }
      }));

      let results;
      try {
        results = await this.sender.send(messages);
      } catch (err) {
        results = messages.map(() => ({ status: 'error' as const, message: err instanceof Error ? err.message : String(err) }));
      }

      // Tokens the provider no longer knows: stop using them.
      const invalid = targets.filter((_, i) => results[i]?.status === 'invalid_token').map((t) => t.id);
      if (invalid.length) await this.db.updateTable('agent.agent_devices').set({ push_token: null }).where('id', 'in', invalid).execute();

      const ok = results.filter((r) => r.status === 'ok');
      const errors = results.filter((r): r is { status: 'error'; message: string } => r.status === 'error');
      const attempts = d.attempts + 1;
      if (ok.length) {
        await finish(d.id, 'sent', { attempts, sent_to: ok.length, provider_ref: ok.map((r) => ('id' in r ? r.id : '')).filter(Boolean).join(',').slice(0, 500) || null, last_error: errors[0]?.message ?? null });
        stats.sent++;
      } else if (!errors.length) {
        await finish(d.id, 'skipped', { attempts, last_error: 'all_tokens_invalid' });
        stats.skipped++;
      } else if (attempts >= MAX_ATTEMPTS) {
        await finish(d.id, 'failed', { attempts, last_error: errors[0]!.message.slice(0, 500) });
        stats.failed++;
      } else {
        await this.db
          .updateTable('agent.agent_notification_deliveries')
          .set({ attempts, last_error: errors[0]!.message.slice(0, 500), updated_at: now, next_attempt_at: new Date(now.getTime() + BACKOFF_MS[attempts - 1]!) })
          .where('id', '=', d.id)
          .execute();
        stats.retried++;
      }
    }
    if (stats.sent + stats.failed + stats.retried > 0) this.logger.log(`Push: ${JSON.stringify(stats)}`);
    return stats;
  }

  /** Pending deliveries (for health checks / dashboards). */
  async backlog(): Promise<number> {
    const r = await this.db
      .selectFrom('agent.agent_notification_deliveries')
      .select(sql<number>`COUNT(*)::int`.as('n'))
      .where('status', '=', 'queued')
      .executeTakeFirstOrThrow();
    return r.n;
  }
}
