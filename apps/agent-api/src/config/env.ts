import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  LEDGER_MODE: z.enum(['local']).default('local'),
  LEDGER_DATABASE_URL: z.string().min(1),
  CORE_MODE: z.enum(['fake']).default('fake'),
  CORE_EVENTS_HMAC_SECRET: z.string().min(32),
  JWT_PRIVATE_KEY_PEM: z.string().min(1),
  JWT_ISSUER: z.string().default('bata-services'),
  JWT_AUDIENCE: z.string().default('bata-services-agent'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  REFRESH_TOKEN_IDLE_DAYS: z.coerce.number().int().positive().default(7),
  PIN_PEPPER: z.string().min(32),
  LOOKUP_HMAC_KEY: z.string().min(32),
  PIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  PIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  NEW_DEVICE_COOLDOWN_HOURS: z.coerce.number().int().nonnegative().default(24),
  NEW_DEVICE_LIMIT_FACTOR_BPS: z.coerce.number().int().min(0).max(10000).default(2500),
  MAX_TRUSTED_DEVICES: z.coerce.number().int().positive().default(1),
  SIGNATURE_MAX_SKEW_SECONDS: z.coerce.number().int().positive().default(60),
  CASH_IN_CONFIRMATION_TTL_SECONDS: z.coerce.number().int().positive().default(180),
  /** Ed25519 private key (PKCS#8 PEM) that signs agent-issued QR codes. */
  QR_SIGNING_PRIVATE_KEY_PEM: z.string().min(1),
  QR_COLLECT_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  DEFAULT_CURRENCY: z.literal('XAF').default('XAF'),
  OPERATING_TIMEZONE: z.string().default('Africa/Malabo'),
  MIN_APP_VERSION: z.string().default('1.0.0'),
  ENABLE_DEV_ENDPOINTS: bool,
  /** Redis for rate limits (shared by all replicas). Empty = in-process counters (development only). */
  REDIS_URL: z.string().default(''),
  RATE_LIMITS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false' && v !== '0'),
  /** Comma-separated browser origins allowed to call the API (web tooling only). Empty = none. */
  CORS_ORIGINS: z.string().default('')
});

export type Env = z.infer<typeof schema>;

const DEV_ONLY_MARKER = 'dev-only';

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    const devSecrets = (['CORE_EVENTS_HMAC_SECRET', 'PIN_PEPPER', 'LOOKUP_HMAC_KEY'] as const).filter((k) =>
      env[k].includes(DEV_ONLY_MARKER)
    );
    if (devSecrets.length) throw new Error(`Development secrets used in production: ${devSecrets.join(', ')}`);
    if (env.CORE_MODE === 'fake') throw new Error('CORE_MODE=fake is not allowed in production');
    if (env.ENABLE_DEV_ENDPOINTS) throw new Error('ENABLE_DEV_ENDPOINTS is not allowed in production');
    if (!env.REDIS_URL) throw new Error('REDIS_URL is required in production (rate limits shared by all replicas)');
    if (!env.RATE_LIMITS_ENABLED) throw new Error('RATE_LIMITS_ENABLED=false is not allowed in production');
  }
  return env;
}

export const ENV = Symbol('ENV');
