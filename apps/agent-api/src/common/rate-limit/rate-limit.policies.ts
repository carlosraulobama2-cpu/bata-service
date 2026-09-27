import { SetMetadata } from '@nestjs/common';

export interface Rule {
  /** What the counter is keyed by. */
  by: 'agent' | 'ip' | 'phone' | 'refresh_token' | 'otp_agent';
  limit: number;
  windowMs: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Initial values from docs/05-api.md §1 (configurable later). */
export const POLICIES = {
  login: [
    { by: 'phone', limit: 5, windowMs: MIN },
    { by: 'ip', limit: 20, windowMs: MIN }
  ],
  verify_otp: [
    { by: 'otp_agent', limit: 10, windowMs: HOUR },
    { by: 'ip', limit: 30, windowMs: 10 * MIN }
  ],
  refresh: [{ by: 'refresh_token', limit: 30, windowMs: HOUR }],
  financial: [{ by: 'agent', limit: 20, windowMs: MIN }],
  code_lookup: [{ by: 'agent', limit: 30, windowMs: MIN }],
  read: [{ by: 'agent', limit: 120, windowMs: MIN }],
  /** Other authenticated writes (mark as read, security actions...). */
  write: [{ by: 'agent', limit: 60, windowMs: MIN }]
} satisfies Record<string, Rule[]>;

export type PolicyName = keyof typeof POLICIES | 'none';

export const RATE_LIMIT_KEY = 'rate_limit_policy';
/** Picks the policy of a route. Without it: `read` for GET, `write` for other methods (authenticated routes only). */
export const RateLimit = (policy: PolicyName) => SetMetadata(RATE_LIMIT_KEY, policy);
