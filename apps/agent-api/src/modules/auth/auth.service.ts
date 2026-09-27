import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { maskPhone } from '@bata/money';
import { ENV, Env } from '../../config/env';
import { AuditService } from '../../common/audit/audit.service';
import { parsePublicJwk } from '../../common/auth/device-signature';
import type { RequestMeta } from '../../common/auth/request-context';
import { hmacHex, randomNumericCode, safeEqualHex } from '../../common/crypto/secrets';
import { AGENT_DB, AgentDb } from '../../common/db/database';
import type { DeviceContext } from '../../common/db/schema';
import { Errors } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { SmsSender } from '../../integrations/sms/sms.sender';
import { z } from 'zod';
import { CredentialsService } from './credentials.service';
import { IssuedTokens, SessionsService } from './sessions.service';
import { LoginSchema, VerifyOtpSchema } from './auth.dto';

const NO_LOGIN_STATUSES = ['rejected', 'terminated'];

export type LoginResult =
  | ({ status: 'authenticated'; agent: PublicAgent } & IssuedTokens)
  | { status: 'otp_required'; challenge_id: string; channel: 'sms'; destination_masked: string; expires_in: number; reason: 'new_device' };

export interface PublicAgent {
  agent_code: string | null;
  first_name: string | null;
  status: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly credentials: CredentialsService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
    private readonly sms: SmsSender,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env
  ) {}

  private async publicAgent(agentId: string): Promise<PublicAgent> {
    const row = await this.db
      .selectFrom('agent.agents as a')
      .leftJoin('agent.agent_profiles as p', 'p.agent_id', 'a.id')
      .select(['a.agent_code', 'a.status', 'p.first_name'])
      .where('a.id', '=', agentId)
      .executeTakeFirstOrThrow();
    return { agent_code: row.agent_code, first_name: row.first_name, status: row.status };
  }

  async login(input: z.infer<typeof LoginSchema>, meta: RequestMeta): Promise<LoginResult> {
    const agent = await this.db.selectFrom('agent.agents').select(['id', 'agent_code', 'status', 'phone_e164']).where('phone_e164', '=', input.phone).executeTakeFirst();

    if (!agent || NO_LOGIN_STATUSES.includes(agent.status)) {
      await this.credentials.verifyPin('00000000-0000-0000-0000-000000000000', input.pin); // same timing as a real check
      await this.db
        .insertInto('agent.agent_access_events')
        .values({ agent_id: agent?.id ?? null, phone_hmac: hmacHex(this.env.LOOKUP_HMAC_KEY, input.phone), event: 'login_failed', device_id: null, ip: meta.ip, approx_location: null })
        .execute();
      throw Errors.invalidCredentials();
    }

    const check = await this.credentials.verifyPin(agent.id, input.pin);
    if (!check.ok) {
      await this.db.transaction().execute(async (trx) => {
        await trx.insertInto('agent.agent_access_events').values({ agent_id: agent.id, phone_hmac: null, event: 'login_failed', device_id: null, ip: meta.ip, approx_location: null }).execute();
        await this.audit.record(trx, { actorType: 'agent', actorId: agent.agent_code, agentId: agent.id, action: 'LOGIN', result: 'failure', reasonCode: 'PIN_INVALID', ip: meta.ip, userAgent: meta.userAgent, requestId: meta.requestId });
      });
      if (check.lockedUntil) throw Errors.accountLocked({ locked_until: check.lockedUntil.toISOString() });
      throw Errors.invalidCredentials({ attempts_left: check.attemptsLeft });
    }
    if (agent.status === 'blocked') throw Errors.accountBlocked();

    const device = await this.db
      .selectFrom('agent.agent_devices')
      .select(['id'])
      .where('agent_id', '=', agent.id)
      .where('installation_id', '=', input.device.installation_id)
      .where('status', '=', 'trusted')
      .executeTakeFirst();

    if (device) {
      const tokens = await this.db.transaction().execute(async (trx) => {
        await trx.updateTable('agent.agent_devices').set({
            last_seen_at: this.clock.now(),
            last_ip: meta.ip,
            app_version: input.device.app_version ?? null,
            ...(input.device.integrity ? { integrity_flags: JSON.stringify(input.device.integrity), integrity_checked_at: this.clock.now() } : {})
          }).where('id', '=', device.id).execute();
        await trx.insertInto('agent.agent_access_events').values({ agent_id: agent.id, phone_hmac: null, event: 'login_success', device_id: device.id, ip: meta.ip, approx_location: null }).execute();
        await this.audit.record(trx, { actorType: 'agent', actorId: agent.agent_code, agentId: agent.id, action: 'LOGIN', resourceType: 'session', result: 'success', deviceId: device.id, ip: meta.ip, userAgent: meta.userAgent, requestId: meta.requestId });
        return this.sessions.create(trx, { agentId: agent.id, agentCode: agent.agent_code ?? '', deviceId: device.id, authLevel: 'pin', ip: meta.ip });
      });
      await this.credentials.resetLocks(agent.id);
      return { status: 'authenticated', ...tokens, agent: await this.publicAgent(agent.id) };
    }

    // New device: second factor by SMS before trusting it.
    const code = randomNumericCode(6);
    const challenge = await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('agent.agent_otp_challenges')
        .values({
          agent_id: agent.id,
          purpose: 'new_device',
          channel: 'sms',
          code_hash: hmacHex(this.env.LOOKUP_HMAC_KEY, code),
          max_attempts: this.env.OTP_MAX_ATTEMPTS,
          expires_at: new Date(this.clock.now().getTime() + this.env.OTP_TTL_SECONDS * 1000),
          consumed_at: null,
          context: JSON.stringify(input.device satisfies DeviceContext)
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx.insertInto('agent.agent_access_events').values({ agent_id: agent.id, phone_hmac: null, event: 'otp_sent', device_id: null, ip: meta.ip, approx_location: null }).execute();
      return row;
    });
    await this.sms.send(agent.phone_e164, `BATA SERVICES: tu código de verificación es ${code}. No lo compartas con nadie.`);
    return {
      status: 'otp_required',
      challenge_id: challenge.id,
      channel: 'sms',
      destination_masked: maskPhone(agent.phone_e164),
      expires_in: this.env.OTP_TTL_SECONDS,
      reason: 'new_device'
    };
  }

  async verifyOtp(input: z.infer<typeof VerifyOtpSchema>, meta: RequestMeta): Promise<{ status: 'authenticated'; agent: PublicAgent; device: { id: string; status: string; cooldown_until: string | null } } & IssuedTokens> {
    const now = this.clock.now();
    const challenge = await this.db.selectFrom('agent.agent_otp_challenges').selectAll().where('id', '=', input.challenge_id).executeTakeFirst();
    if (!challenge || challenge.consumed_at || challenge.purpose !== 'new_device') throw Errors.otpExpired();
    if (challenge.expires_at <= now || challenge.attempts >= challenge.max_attempts) throw Errors.otpExpired();

    if (!safeEqualHex(challenge.code_hash, hmacHex(this.env.LOOKUP_HMAC_KEY, input.code))) {
      const updated = await this.db
        .updateTable('agent.agent_otp_challenges')
        .set({ attempts: sql`attempts + 1` })
        .where('id', '=', challenge.id)
        .where('attempts', '<', challenge.max_attempts)
        .returning('attempts')
        .executeTakeFirst();
      await this.db.insertInto('agent.agent_access_events').values({ agent_id: challenge.agent_id, phone_hmac: null, event: 'otp_failed', device_id: null, ip: meta.ip, approx_location: null }).execute();
      const left = challenge.max_attempts - (updated?.attempts ?? challenge.max_attempts);
      if (left <= 0) throw Errors.otpExpired();
      throw Errors.otpInvalid({ attempts_left: left });
    }

    const deviceKey = parsePublicJwk(input.device_keys?.device_public_key);
    if (!deviceKey) throw Errors.validation({ fields: ['device_keys.device_public_key'] });
    const biometricKey = input.device_keys?.biometric_public_key ? parsePublicJwk(input.device_keys.biometric_public_key) : null;
    if (input.device_keys?.biometric_public_key && !biometricKey) throw Errors.validation({ fields: ['device_keys.biometric_public_key'] });

    const ctx = challenge.context as DeviceContext;
    const agent = await this.db.selectFrom('agent.agents').select(['id', 'agent_code', 'status']).where('id', '=', challenge.agent_id).executeTakeFirstOrThrow();
    if (agent.status === 'blocked' || NO_LOGIN_STATUSES.includes(agent.status)) throw Errors.accountBlocked();
    const cooldownUntil = this.env.NEW_DEVICE_COOLDOWN_HOURS > 0 ? new Date(now.getTime() + this.env.NEW_DEVICE_COOLDOWN_HOURS * 3600000) : null;

    const result = await this.db.transaction().execute(async (trx) => {
      const consumed = await trx
        .updateTable('agent.agent_otp_challenges')
        .set({ consumed_at: now })
        .where('id', '=', challenge.id)
        .where('consumed_at', 'is', null)
        .returning('id')
        .executeTakeFirst();
      if (!consumed) throw Errors.otpExpired();

      // Keep at most MAX_TRUSTED_DEVICES: revoke the oldest ones and their sessions.
      const trusted = await trx
        .selectFrom('agent.agent_devices')
        .select(['id'])
        .where('agent_id', '=', agent.id)
        .where('status', '=', 'trusted')
        .orderBy('trusted_at', 'asc')
        .execute();
      const toRevoke = trusted.slice(0, Math.max(0, trusted.length - (this.env.MAX_TRUSTED_DEVICES - 1))).map((d) => d.id);
      // Same installation re-registering (e.g. app data cleared) replaces its old record.
      const sameInstallation = await trx
        .selectFrom('agent.agent_devices')
        .select('id')
        .where('agent_id', '=', agent.id)
        .where('installation_id', '=', ctx.installation_id)
        .where('status', '<>', 'revoked')
        .execute();
      const revokeIds = [...new Set([...toRevoke, ...sameInstallation.map((d) => d.id)])];
      if (revokeIds.length) {
        await trx.updateTable('agent.agent_devices').set({ status: 'revoked', revoked_at: now, revoked_by: 'system', revoked_reason: 'replaced_by_new_device' }).where('id', 'in', revokeIds).execute();
        await trx.updateTable('agent.agent_sessions').set({ status: 'revoked', revoked_at: now, revoked_reason: 'device_replaced' }).where('device_id', 'in', revokeIds).where('status', '=', 'active').execute();
      }

      const device = await trx
        .insertInto('agent.agent_devices')
        .values({
          agent_id: agent.id,
          installation_id: ctx.installation_id,
          public_key: JSON.stringify(deviceKey),
          biometric_public_key: biometricKey ? JSON.stringify(biometricKey) : null,
          biometric_enabled: Boolean(biometricKey),
          key_algorithm: 'ES256',
          platform: ctx.platform,
          model: ctx.model ?? null,
          os_version: ctx.os_version ?? null,
          app_version: ctx.app_version ?? null,
          integrity_flags: JSON.stringify(ctx.integrity ?? {}),
          integrity_checked_at: ctx.integrity ? now : null,
          status: 'trusted',
          trusted_at: now,
          cooldown_until: cooldownUntil,
          last_seen_at: now,
          last_ip: meta.ip,
          approx_location: null,
          revoked_at: null,
          revoked_by: null,
          revoked_reason: null
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('agent.agent_access_events')
        .values([
          { agent_id: agent.id, phone_hmac: null, event: 'new_device_detected', device_id: device.id, ip: meta.ip, approx_location: null },
          { agent_id: agent.id, phone_hmac: null, event: 'device_trusted', device_id: device.id, ip: meta.ip, approx_location: null },
          { agent_id: agent.id, phone_hmac: null, event: 'login_success', device_id: device.id, ip: meta.ip, approx_location: null }
        ])
        .execute();
      await trx
        .insertInto('agent.agent_notifications')
        .values({
          agent_id: agent.id,
          type: 'new_device_detected',
          title_key: 'notif.new_device_detected.title',
          body_key: 'notif.new_device_detected.body',
          params: JSON.stringify({ model: ctx.model ?? null, platform: ctx.platform, device_id: device.id }),
          related_transaction_id: null,
          read_at: null
        })
        .execute();
      await trx
        .insertInto('agent.outbox_events')
        .values({ aggregate_type: 'agent', aggregate_id: agent.id, event_type: 'agent.device.trusted', payload: JSON.stringify({ device_id: device.id, revoked_device_ids: revokeIds }), published_at: null })
        .execute();
      await this.audit.record(trx, {
        actorType: 'agent',
        actorId: agent.agent_code,
        agentId: agent.id,
        action: 'DEVICE_TRUSTED',
        resourceType: 'device',
        resourceId: device.id,
        result: 'success',
        deviceId: device.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
        metadata: { platform: ctx.platform, model: ctx.model ?? null, revoked_devices: revokeIds.length }
      });
      const tokens = await this.sessions.create(trx, { agentId: agent.id, agentCode: agent.agent_code ?? '', deviceId: device.id, authLevel: 'pin_otp', ip: meta.ip });
      return { tokens, deviceId: device.id };
    });

    await this.credentials.resetLocks(agent.id);
    return {
      status: 'authenticated',
      ...result.tokens,
      device: { id: result.deviceId, status: 'trusted', cooldown_until: cooldownUntil?.toISOString() ?? null },
      agent: await this.publicAgent(agent.id)
    };
  }
}
