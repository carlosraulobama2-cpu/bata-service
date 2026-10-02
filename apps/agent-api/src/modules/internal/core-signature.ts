import type { FastifyRequest } from 'fastify';
import type { Env } from '../../config/env';
import { header } from '../../common/auth/request-context';
import { hmacHex, safeEqualHex } from '../../common/crypto/secrets';
import { Errors } from '../../common/errors/app-error';
import type { Clock } from '../../common/time/clock';

const MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Calls from Velynt Core. In production these routes are only reachable on
 * the private network with mTLS; the HMAC over "timestamp.body" is an extra
 * check and prevents replays of old requests. Returns the raw body.
 */
export function verifyCoreRequest(req: FastifyRequest, env: Env, clock: Clock): string {
  const ts = header(req, 'x-core-timestamp') ?? '';
  const signature = header(req, 'x-core-signature') ?? '';
  const raw = req.rawBody?.toString('utf8') ?? '';
  const expected = hmacHex(env.CORE_EVENTS_HMAC_SECRET, `${ts}.${raw}`);
  if (!/^[0-9a-f]{64}$/.test(signature) || !safeEqualHex(signature, expected)) throw Errors.unauthenticated();
  if (!Number.isFinite(Number(ts)) || Math.abs(clock.now().getTime() - Number(ts)) > MAX_AGE_MS) throw Errors.unauthenticated();
  return raw;
}
