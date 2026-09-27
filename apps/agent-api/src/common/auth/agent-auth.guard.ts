import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ENV, Env } from '../../config/env';
import { AGENT_DB, AgentDb } from '../db/database';
import { Errors } from '../errors/app-error';
import { Clock } from '../time/clock';
import { JwtService } from './jwt';
import { header } from './request-context';

function versionLessThan(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
}

/**
 * Validates the access token AND the live state behind it on every
 * request: session still active (remote logout is immediate), device still
 * trusted, agent not blocked. Token claims alone are never trusted for that.
 */
@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();

    const appVersion = header(req, 'x-app-version');
    if (appVersion && versionLessThan(appVersion, this.env.MIN_APP_VERSION)) throw Errors.appUpdateRequired();

    const [scheme, token] = (header(req, 'authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw Errors.unauthenticated();
    const claims = this.jwt.verify(token, this.clock.now());
    if (!claims) throw Errors.sessionExpired();

    const row = await this.db
      .selectFrom('agent.agent_sessions as s')
      .innerJoin('agent.agents as a', 'a.id', 's.agent_id')
      .innerJoin('agent.agent_devices as d', 'd.id', 's.device_id')
      .select([
        's.status as session_status',
        's.absolute_expires_at',
        'a.id as agent_id',
        'a.agent_code',
        'a.status as agent_status',
        'a.tier_code',
        'd.id as device_id',
        'd.status as device_status',
        'd.cooldown_until',
        'd.compromised'
      ])
      .where('s.id', '=', claims.sid)
      .where('s.agent_id', '=', claims.sub)
      .executeTakeFirst();

    if (!row || row.session_status !== 'active' || row.absolute_expires_at <= this.clock.now()) throw Errors.sessionRevoked();
    if (row.device_id !== claims.did || row.device_status !== 'trusted') throw Errors.deviceNotTrusted();
    if (row.agent_status === 'blocked' || row.agent_status === 'terminated' || row.agent_status === 'rejected') throw Errors.accountBlocked();

    const headerDevice = header(req, 'x-device-id');
    if (headerDevice && headerDevice !== row.device_id) throw Errors.deviceNotTrusted();

    req.agent = {
      agentId: row.agent_id,
      agentCode: row.agent_code ?? '',
      status: row.agent_status,
      tierCode: row.tier_code,
      sessionId: claims.sid,
      deviceId: row.device_id,
      deviceCooldownUntil: row.cooldown_until,
      deviceCompromised: row.compromised
    };
    return true;
  }
}
