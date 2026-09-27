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
  DEFAULT_CURRENCY: z.literal('XAF').default('XAF'),
  OPERATING_TIMEZONE: z.string().default('Africa/Malabo'),
  MIN_APP_VERSION: z.string().default('1.0.0'),
  ENABLE_DEV_ENDPOINTS: bool
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
  }
  return env;
}

export const ENV = Symbol('ENV');
