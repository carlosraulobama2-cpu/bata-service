import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../common/audit/audit.service';
import type { AgentContext } from '../../common/auth/request-context';
import { isAcceptablePin, PinHasher } from '../../common/crypto/secrets';
import { AGENT_DB, AgentDb } from '../../common/db/database';
import { Errors } from '../../common/errors/app-error';
import { decodeCursor } from '../../common/pagination';
import { Clock } from '../../common/time/clock';
import { CredentialsService } from '../auth/credentials.service';

const PIN_HISTORY = 3;

/** Only the network part of an address: enough to recognise "that's me", not to locate someone. */
export function maskIp(ip: string | null): string | null {
  if (!ip) return null;
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(ip.replace(/^::ffff:/, ''));
  if (v4) return `${v4[1]}.${v4[2]}.•.•`;
  const parts = ip.split(':').filter(Boolean);
  return parts.length ? `${parts.slice(0, 2).join(':')}:…` : null;
}

/** Account and security screens (docs/05-api.md §12). */
@Injectable()
export class SecurityService {
  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly credentials: CredentialsService,
    private readonly hasher: PinHasher,
    private readonly audit: AuditService,
    private readonly clock: Clock
  ) {}

  async overview(agent: AgentContext) {
    const [cred, device, lastLogins, sessions, devices] = await Promise.all([
      this.db.selectFrom('agent.agent_credentials').select(['pin_set_at', 'must_change_pin']).where('agent_id', '=', agent.agentId).executeTakeFirstOrThrow(),
      this.db.selectFrom('agent.agent_devices').select(['model', 'platform', 'biometric_enabled', 'trusted_at', 'cooldown_until']).where('id', '=', agent.deviceId).executeTakeFirstOrThrow(),
      this.db
        .selectFrom('agent.agent_access_events as e')
        .leftJoin('agent.agent_devices as d', 'd.id', 'e.device_id')
        .select(['e.created_at', 'e.ip', 'e.approx_location', 'd.model'])
        .where('e.agent_id', '=', agent.agentId)
        .where('e.event', '=', 'login_success')
        .orderBy('e.created_at', 'desc')
        .limit(2)
        .execute(),
      this.db.selectFrom('agent.agent_sessions').select(sql<number>`COUNT(*)::int`.as('n')).where('agent_id', '=', agent.agentId).where('status', '=', 'active').executeTakeFirstOrThrow(),
      this.db.selectFrom('agent.agent_devices').select(sql<number>`COUNT(*)::int`.as('n')).where('agent_id', '=', agent.agentId).where('status', '=', 'trusted').executeTakeFirstOrThrow()
    ]);
    // The latest login is (usually) this very session; the one before is what the agent wants to check.
    const previous = lastLogins[1] ?? null;
    const failed = await this.db
      .selectFrom('agent.agent_access_events')
      .select(sql<number>`COUNT(*)::int`.as('n'))
      .where('agent_id', '=', agent.agentId)
      .where('event', 'in', ['login_failed', 'otp_failed', 'account_locked'])
      .where('created_at', '>', new Date(this.clock.now().getTime() - 7 * 86400000))
      .executeTakeFirstOrThrow();
    return {
      this_device: { id: agent.deviceId, model: device.model, platform: device.platform, trusted_at: device.trusted_at?.toISOString() ?? null, cooldown_until: device.cooldown_until?.toISOString() ?? null },
      biometric_enabled: device.biometric_enabled,
      pin: { set_at: cred.pin_set_at.toISOString(), must_change: cred.must_change_pin },
      previous_login: previous ? { at: previous.created_at.toISOString(), device_model: previous.model, ip_masked: maskIp(previous.ip), approx_location: previous.approx_location } : null,
      active_sessions: sessions.n,
      trusted_devices: devices.n,
      failed_attempts_last_7_days: failed.n
    };
  }

  async devices(agent: AgentContext) {
    const rows = await this.db
      .selectFrom('agent.agent_devices')
      .select(['id', 'model', 'platform', 'os_version', 'app_version', 'status', 'trusted_at', 'last_seen_at', 'approx_location', 'revoked_at', 'revoked_reason', 'biometric_enabled'])
      .where('agent_id', '=', agent.agentId)
      .where('status', 'in', ['trusted', 'revoked'])
      .orderBy('created_at', 'desc')
      .limit(20)
      .execute();
    return {
      data: rows.map((d) => ({
        id: d.id,
        model: d.model,
        platform: d.platform,
        os_version: d.os_version,
        app_version: d.app_version,
        status: d.status,
        current: d.id === agent.deviceId,
        biometric_enabled: d.biometric_enabled,
        trusted_at: d.trusted_at?.toISOString() ?? null,
        last_seen_at: d.last_seen_at?.toISOString() ?? null,
        approx_location: d.approx_location,
        revoked_at: d.revoked_at?.toISOString() ?? null,
        revoked_reason: d.revoked_reason
      }))
    };
  }

  async sessions(agent: AgentContext) {
    const rows = await this.db
      .selectFrom('agent.agent_sessions as s')
      .innerJoin('agent.agent_devices as d', 'd.id', 's.device_id')
      .select(['s.id', 's.created_at', 's.last_used_at', 's.ip', 'd.model', 'd.platform'])
      .where('s.agent_id', '=', agent.agentId)
      .where('s.status', '=', 'active')
      .where('s.absolute_expires_at', '>', this.clock.now())
      .orderBy('s.created_at', 'desc')
      .execute();
    return {
      data: rows.map((s) => ({
        id: s.id,
        current: s.id === agent.sessionId,
        device_model: s.model,
        platform: s.platform,
        ip_masked: maskIp(s.ip),
        created_at: s.created_at.toISOString(),
        last_used_at: s.last_used_at?.toISOString() ?? null
      }))
    };
  }

  async accessHistory(agent: AgentContext, input: { limit: number; cursor?: string }) {
    const cursor = decodeCursor(input.cursor);
    let q = this.db
      .selectFrom('agent.agent_access_events as e')
      .leftJoin('agent.agent_devices as d', 'd.id', 'e.device_id')
      .select(['e.id', 'e.event', 'e.created_at', 'e.ip', 'e.approx_location', 'd.model'])
      .where('e.agent_id', '=', agent.agentId);
    if (cursor) q = q.where((eb) => eb(sql`(e.created_at, e.id)`, '<', sql`(${new Date(cursor.t)}::timestamptz, ${cursor.i}::bigint)`));
    const rows = await q.orderBy('e.created_at', 'desc').orderBy('e.id', 'desc').limit(input.limit + 1).execute();
    const page = rows.slice(0, input.limit);
    const last = page[page.length - 1];
    return {
      data: page.map((e) => ({ id: String(e.id), event: e.event, at: e.created_at.toISOString(), device_model: e.model, ip_masked: maskIp(e.ip), approx_location: e.approx_location })),
      next_cursor: rows.length > input.limit && last ? Buffer.from(JSON.stringify({ t: last.created_at.toISOString(), i: String(last.id) })).toString('base64url') : null
    };
  }

  /**
   * The app reports the phone's integrity on start and when it comes back
   * to the foreground. Latest report wins (a phone can be un-rooted); every
   * change is audited.
   */
  async reportIntegrity(agent: AgentContext, flags: { rooted: boolean; emulator: boolean }, ip: string | null): Promise<{ compromised: boolean }> {
    return this.db.transaction().execute(async (trx) => {
      const before = await trx.selectFrom('agent.agent_devices').select('compromised').where('id', '=', agent.deviceId).forUpdate().executeTakeFirstOrThrow();
      const after = await trx
        .updateTable('agent.agent_devices')
        .set({ integrity_flags: JSON.stringify(flags), integrity_checked_at: this.clock.now() })
        .where('id', '=', agent.deviceId)
        .returning('compromised')
        .executeTakeFirstOrThrow();
      if (before.compromised !== after.compromised) {
        await this.audit.record(trx, {
          actorType: 'agent',
          actorId: agent.agentCode,
          agentId: agent.agentId,
          action: 'DEVICE_INTEGRITY_CHANGED',
          resourceType: 'device',
          resourceId: agent.deviceId,
          result: 'success',
          deviceId: agent.deviceId,
          ip,
          metadata: { ...flags, compromised: after.compromised }
        });
      }
      return { compromised: after.compromised };
    });
  }

  /**
   * Disconnects one of the agent's other devices: it stops being trusted,
   * its sessions end immediately (checked on every request) and it no
   * longer receives push notifications. Logging in from it again needs
   * PIN + SMS code, like any new device.
   */
  async revokeDevice(agent: AgentContext, deviceId: string, ip: string | null): Promise<{ revoked: true; sessions_revoked: number }> {
    if (deviceId === agent.deviceId) throw Errors.deviceIsCurrent();
    return this.db.transaction().execute(async (trx) => {
      const now = this.clock.now();
      const device = await trx
        .updateTable('agent.agent_devices')
        .set({ status: 'revoked', revoked_at: now, revoked_by: 'agent', revoked_reason: 'revoked_by_agent', push_token: null })
        .where('id', '=', deviceId)
        .where('agent_id', '=', agent.agentId)
        .where('status', '=', 'trusted')
        .returning('id')
        .executeTakeFirst();
      if (!device) throw Errors.notFound();
      const sessions = await trx
        .updateTable('agent.agent_sessions')
        .set({ status: 'revoked', revoked_at: now, revoked_reason: 'device_revoked' })
        .where('device_id', '=', deviceId)
        .where('status', '=', 'active')
        .returning('id')
        .execute();
      await trx.insertInto('agent.agent_access_events').values({ agent_id: agent.agentId, phone_hmac: null, event: 'device_revoked', device_id: deviceId, ip, approx_location: null }).execute();
      await this.audit.record(trx, {
        actorType: 'agent',
        actorId: agent.agentCode,
        agentId: agent.agentId,
        action: 'DEVICE_REVOKED',
        resourceType: 'device',
        resourceId: deviceId,
        result: 'success',
        deviceId: agent.deviceId,
        ip,
        metadata: { sessions_revoked: sessions.length }
      });
      return { revoked: true as const, sessions_revoked: sessions.length };
    });
  }

  /** Closes every other session of the agent (step-up already verified by the caller). */
  async revokeOtherSessions(agent: AgentContext, ip: string | null): Promise<{ revoked: number }> {
    return this.db.transaction().execute(async (trx) => {
      const revoked = await trx
        .updateTable('agent.agent_sessions')
        .set({ status: 'revoked', revoked_at: this.clock.now(), revoked_reason: 'revoked_by_agent' })
        .where('agent_id', '=', agent.agentId)
        .where('status', '=', 'active')
        .where('id', '<>', agent.sessionId)
        .returning(['id', 'device_id'])
        .execute();
      for (const s of revoked) {
        await trx.insertInto('agent.agent_access_events').values({ agent_id: agent.agentId, phone_hmac: null, event: 'session_revoked', device_id: s.device_id, ip, approx_location: null }).execute();
      }
      await this.audit.record(trx, {
        actorType: 'agent',
        actorId: agent.agentCode,
        agentId: agent.agentId,
        action: 'SESSION_REVOKED',
        resourceType: 'session',
        resourceId: null,
        result: 'success',
        deviceId: agent.deviceId,
        ip,
        metadata: { scope: 'others', count: revoked.length }
      });
      return { revoked: revoked.length };
    });
  }

  /**
   * PIN change: current PIN checked (and counted towards the lock), new PIN
   * must follow the rules and differ from the last 3; other sessions are
   * closed and the agent is notified.
   */
  async changePin(agent: AgentContext, input: { current_pin: string; new_pin: string }, ip: string | null): Promise<{ changed: true; other_sessions_revoked: number }> {
    const check = await this.credentials.verifyPin(agent.agentId, input.current_pin);
    if (!check.ok) {
      if (check.lockedUntil) throw Errors.accountLocked({ locked_until: check.lockedUntil.toISOString() });
      throw Errors.pinInvalid({ attempts_left: check.attemptsLeft });
    }
    if (!isAcceptablePin(input.new_pin)) throw Errors.pinTooWeak();
    if (input.new_pin === input.current_pin) throw Errors.pinReused();
    const history = await this.db.selectFrom('agent.agent_pin_history').select('pin_hash').where('agent_id', '=', agent.agentId).orderBy('id', 'desc').limit(PIN_HISTORY - 1).execute();
    for (const h of history) {
      if (await this.hasher.verify(h.pin_hash, input.new_pin)) throw Errors.pinReused();
    }
    const newHash = await this.hasher.hash(input.new_pin);
    const now = this.clock.now();

    const revoked = await this.db.transaction().execute(async (trx) => {
      const cred = await trx.selectFrom('agent.agent_credentials').select('pin_hash').where('agent_id', '=', agent.agentId).forUpdate().executeTakeFirstOrThrow();
      await trx.insertInto('agent.agent_pin_history').values({ agent_id: agent.agentId, pin_hash: cred.pin_hash }).execute();
      await trx
        .updateTable('agent.agent_credentials')
        .set({ pin_hash: newHash, pin_set_at: now, must_change_pin: false, failed_attempts: 0 })
        .where('agent_id', '=', agent.agentId)
        .execute();
      const others = await trx
        .updateTable('agent.agent_sessions')
        .set({ status: 'revoked', revoked_at: now, revoked_reason: 'pin_changed' })
        .where('agent_id', '=', agent.agentId)
        .where('status', '=', 'active')
        .where('id', '<>', agent.sessionId)
        .returning('id')
        .execute();
      await trx.insertInto('agent.agent_access_events').values({ agent_id: agent.agentId, phone_hmac: null, event: 'pin_changed', device_id: agent.deviceId, ip, approx_location: null }).execute();
      await trx
        .insertInto('agent.agent_notifications')
        .values({
          agent_id: agent.agentId,
          type: 'security_alert',
          title_key: 'notif.pin_changed.title',
          body_key: 'notif.pin_changed.body',
          params: JSON.stringify({ at: now.toISOString() }),
          related_transaction_id: null,
          read_at: null
        })
        .execute();
      await this.audit.record(trx, {
        actorType: 'agent',
        actorId: agent.agentCode,
        agentId: agent.agentId,
        action: 'PIN_CHANGED',
        resourceType: 'credentials',
        resourceId: null,
        result: 'success',
        deviceId: agent.deviceId,
        ip,
        metadata: { other_sessions_revoked: others.length }
      });
      return others.length;
    });
    return { changed: true, other_sessions_revoked: revoked };
  }
}
