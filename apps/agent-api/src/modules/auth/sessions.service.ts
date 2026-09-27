import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, Env } from '../../config/env';
import { JwtService } from '../../common/auth/jwt';
import { randomToken, sha256Hex } from '../../common/crypto/secrets';
import { AGENT_DB, AgentDb, AgentTrx } from '../../common/db/database';
import { Errors } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';

export interface IssuedTokens {
  access_token: string;
  access_token_expires_in: number;
  refresh_token: string;
}

const DAY = 86400000;

/** Sessions with opaque, rotated refresh tokens (stored hashed) and reuse detection. */
@Injectable()
export class SessionsService {
  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly jwt: JwtService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env
  ) {}

  async create(
    trx: AgentTrx,
    input: { agentId: string; agentCode: string; deviceId: string; authLevel: 'pin' | 'pin_otp' | 'device_key_biometric'; ip: string | null }
  ): Promise<IssuedTokens> {
    const now = this.clock.now();
    const refresh = randomToken(32);
    const session = await trx
      .insertInto('agent.agent_sessions')
      .values({
        agent_id: input.agentId,
        device_id: input.deviceId,
        token_family: randomUUID(),
        refresh_token_hash: sha256Hex(refresh),
        status: 'active',
        auth_level: input.authLevel,
        last_used_at: now,
        idle_expires_at: new Date(now.getTime() + this.env.REFRESH_TOKEN_IDLE_DAYS * DAY),
        absolute_expires_at: new Date(now.getTime() + this.env.REFRESH_TOKEN_TTL_DAYS * DAY),
        revoked_at: null,
        revoked_reason: null,
        ip: input.ip
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return this.tokens(session.id, input.agentId, input.agentCode, input.deviceId, input.authLevel, refresh);
  }

  private tokens(sessionId: string, agentId: string, agentCode: string, deviceId: string, aal: string, refresh: string): IssuedTokens {
    const access = this.jwt.sign({ sub: agentId, aid: agentCode, sid: sessionId, did: deviceId, role: 'AGENT', aal }, this.clock.now());
    return { access_token: access.token, access_token_expires_in: access.expiresIn, refresh_token: refresh };
  }

  async refresh(refreshToken: string, ip: string | null): Promise<IssuedTokens> {
    const now = this.clock.now();
    const hash = sha256Hex(refreshToken);

    return this.db.transaction().execute(async (trx) => {
      const session = await trx
        .selectFrom('agent.agent_sessions as s')
        .innerJoin('agent.agents as a', 'a.id', 's.agent_id')
        .innerJoin('agent.agent_devices as d', 'd.id', 's.device_id')
        .select(['s.id', 's.status', 's.token_family', 's.idle_expires_at', 's.absolute_expires_at', 's.auth_level', 's.agent_id', 's.device_id', 'a.agent_code', 'a.status as agent_status', 'd.status as device_status'])
        .where('s.refresh_token_hash', '=', hash)
        .forUpdate('s')
        .executeTakeFirst();

      if (!session) throw Errors.sessionExpired();

      if (session.status === 'rotated') {
        // A refresh token was used twice: assume theft, kill the whole family.
        await trx
          .updateTable('agent.agent_sessions')
          .set({ status: 'revoked', revoked_at: now, revoked_reason: 'reuse_detected' })
          .where('token_family', '=', session.token_family)
          .where('status', 'in', ['active', 'rotated'])
          .execute();
        await trx.insertInto('agent.agent_access_events').values({ agent_id: session.agent_id, event: 'session_revoked', phone_hmac: null, device_id: session.device_id, ip, approx_location: null }).execute();
        return { reuse: true as const };
      }
      if (session.status !== 'active') throw Errors.sessionRevoked();
      if (session.idle_expires_at <= now || session.absolute_expires_at <= now) {
        await trx.updateTable('agent.agent_sessions').set({ status: 'expired' }).where('id', '=', session.id).execute();
        return { expired: true as const };
      }
      if (session.device_status !== 'trusted' || ['blocked', 'terminated', 'rejected'].includes(session.agent_status)) throw Errors.sessionRevoked();

      const newRefresh = randomToken(32);
      await trx.updateTable('agent.agent_sessions').set({ status: 'rotated', last_used_at: now }).where('id', '=', session.id).execute();
      const next = await trx
        .insertInto('agent.agent_sessions')
        .values({
          agent_id: session.agent_id,
          device_id: session.device_id,
          token_family: session.token_family,
          refresh_token_hash: sha256Hex(newRefresh),
          status: 'active',
          auth_level: session.auth_level,
          last_used_at: now,
          idle_expires_at: new Date(now.getTime() + this.env.REFRESH_TOKEN_IDLE_DAYS * DAY),
          absolute_expires_at: session.absolute_expires_at,
          revoked_at: null,
          revoked_reason: null,
          ip
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { tokens: this.tokens(next.id, session.agent_id, session.agent_code ?? '', session.device_id, session.auth_level, newRefresh) };
    }).then((result) => {
      if ('reuse' in result) throw Errors.sessionRevoked({ reason: 'reuse_detected' });
      if ('expired' in result) throw Errors.sessionExpired();
      return result.tokens;
    });
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.db
      .updateTable('agent.agent_sessions')
      .set({ status: 'revoked', revoked_at: this.clock.now(), revoked_reason: reason })
      .where('id', '=', sessionId)
      .where('status', '=', 'active')
      .execute();
  }
}
