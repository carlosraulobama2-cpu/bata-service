import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ENV, Env } from '../../config/env';
import { AGENT_DB, AgentDb } from '../db/database';
import { Errors } from '../errors/app-error';
import { Clock } from '../time/clock';
import { canonicalRequest, verifySignature } from './device-signature';
import { header } from './request-context';

/**
 * Financial and security endpoints must be signed by the registered
 * device key (docs/05-api.md §2). Use after AgentAuthGuard.
 */
@Injectable()
export class DeviceSignatureGuard implements CanActivate {
  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    if (!req.agent) throw Errors.unauthenticated();

    const timestamp = header(req, 'x-timestamp');
    const signature = header(req, 'x-device-signature');
    const idempotencyKey = header(req, 'idempotency-key') ?? '';
    if (!timestamp || !signature) throw Errors.signatureInvalid();

    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(this.clock.now().getTime() - ts) > this.env.SIGNATURE_MAX_SKEW_SECONDS * 1000) {
      throw Errors.signatureInvalid({ reason: 'timestamp' });
    }

    const device = await this.db
      .selectFrom('agent.agent_devices')
      .select(['public_key'])
      .where('id', '=', req.agent.deviceId)
      .where('status', '=', 'trusted')
      .executeTakeFirst();
    if (!device) throw Errors.deviceNotTrusted();

    const path = req.url.split('?')[0] ?? req.url;
    const raw = req.rawBody ? req.rawBody.toString('utf8') : '';
    const data = canonicalRequest(req.method, path, raw, timestamp, idempotencyKey);
    if (!verifySignature(device.public_key, data, signature)) throw Errors.signatureInvalid();
    return true;
  }
}
