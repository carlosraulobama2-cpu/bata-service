import { CallHandler, ExecutionContext, Inject, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import { ENV, Env } from '../../config/env';
import { hmacHex, sha256Hex } from '../crypto/secrets';
import { AGENT_DB, AgentDb } from '../db/database';
import { Errors } from '../errors/app-error';
import { isUuid } from '../pagination';
import { RateLimiter } from './rate-limiter';
import { POLICIES, PolicyName, RATE_LIMIT_KEY, Rule } from './rate-limit.policies';

/**
 * Applies the route's rate-limit policy (runs after the auth guard, so the
 * agent is known). Adds X-RateLimit-Limit / X-RateLimit-Remaining; over
 * the limit answers 429 RATE_LIMITED with Retry-After.
 *
 * If the limiter itself is unavailable the request goes through (logged):
 * rate limits protect capacity and slow down guessing, while money rules,
 * PIN/OTP attempt counters and single-use codes live in the database.
 */
@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  private readonly logger = new Logger('RateLimit');

  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
    @Inject(AGENT_DB) private readonly db: AgentDb,
    @Inject(ENV) private readonly env: Env
  ) {}

  /** Counters are per policy group (e.g. all reads of an agent share one budget), not per endpoint. */
  private policyFor(ctx: ExecutionContext, req: FastifyRequest): { name: string; rules: Rule[] } {
    const explicit = this.reflector.getAllAndOverride<PolicyName | undefined>(RATE_LIMIT_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (explicit === 'none') return { name: 'none', rules: [] };
    if (explicit) return { name: explicit, rules: POLICIES[explicit] };
    if (!req.agent) return { name: 'none', rules: [] };
    return req.method === 'GET' ? { name: 'read', rules: POLICIES.read } : { name: 'write', rules: POLICIES.write };
  }

  private async keyFor(rule: Rule, req: FastifyRequest): Promise<string | null> {
    const body = (req.body ?? {}) as Record<string, unknown>;
    switch (rule.by) {
      case 'agent':
        return req.agent ? `agent:${req.agent.agentId}` : null;
      case 'ip':
        return `ip:${req.ip}`;
      case 'phone':
        // Never the phone itself: an HMAC with the lookup key.
        return typeof body.phone === 'string' ? `phone:${hmacHex(this.env.LOOKUP_HMAC_KEY, body.phone)}` : null;
      case 'refresh_token':
        return typeof body.refresh_token === 'string' ? `rt:${sha256Hex(body.refresh_token)}` : null;
      case 'otp_agent': {
        const id = body.challenge_id;
        if (typeof id !== 'string' || !isUuid(id)) return null;
        const row = await this.db.selectFrom('agent.agent_otp_challenges').select('agent_id').where('id', '=', id).executeTakeFirst();
        return row ? `otp_agent:${row.agent_id}` : null;
      }
    }
  }

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (!this.env.RATE_LIMITS_ENABLED) return next.handle();
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const reply = ctx.switchToHttp().getResponse<FastifyReply>();
    const { name, rules } = this.policyFor(ctx, req);

    let tightest: { limit: number; remaining: number } | null = null;
    for (const rule of rules) {
      const key = await this.keyFor(rule, req);
      if (!key) continue;
      let hit;
      try {
        hit = await this.limiter.hit(`${name}:${rule.by}:${key}`, rule.windowMs);
      } catch (err) {
        this.logger.warn(`Rate limiter unavailable, allowing request: ${err instanceof Error ? err.message : String(err)}`);
        return next.handle();
      }
      const remaining = Math.max(0, rule.limit - hit.count);
      if (!tightest || remaining < tightest.remaining) tightest = { limit: rule.limit, remaining };
      if (hit.count > rule.limit) {
        const retryAfter = Math.max(1, Math.ceil(hit.resetMs / 1000));
        reply.header('retry-after', String(retryAfter));
        reply.header('x-ratelimit-limit', String(rule.limit));
        reply.header('x-ratelimit-remaining', '0');
        throw Errors.rateLimited({ retry_after_seconds: retryAfter });
      }
    }
    if (tightest) {
      reply.header('x-ratelimit-limit', String(tightest.limit));
      reply.header('x-ratelimit-remaining', String(tightest.remaining));
    }
    return next.handle();
  }
}
