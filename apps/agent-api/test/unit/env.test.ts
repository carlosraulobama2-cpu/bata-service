import { loadEnv } from '../../src/config/env';

/** Production must never start with development stand-ins. */
describe('production configuration guards', () => {
  const prod = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://x/y',
    LEDGER_DATABASE_URL: 'postgresql://x/y',
    CORE_EVENTS_HMAC_SECRET: 'prod-secret-0123456789abcdef0123456789',
    JWT_PRIVATE_KEY_PEM: 'x',
    QR_SIGNING_PRIVATE_KEY_PEM: 'x',
    PIN_PEPPER: 'prod-pepper-0123456789abcdef0123456789',
    LOOKUP_HMAC_KEY: 'prod-lookup-0123456789abcdef0123456789',
    REDIS_URL: 'redis://redis:6379',
    PUSH_MODE: 'expo'
  };

  it('refuses the in-memory SMS sender (login codes would be lost)', () => {
    expect(() => loadEnv(prod)).toThrow(/SMS_MODE=memory/);
  });

  it('refuses development secrets, dev endpoints, missing Redis and in-memory push', () => {
    expect(() => loadEnv({ ...prod, PIN_PEPPER: 'dev-only-0123456789abcdef0123456789' })).toThrow(/Development secrets/);
    expect(() => loadEnv({ ...prod, ENABLE_DEV_ENDPOINTS: 'true' })).toThrow();
    expect(() => loadEnv({ ...prod, REDIS_URL: '' })).toThrow();
    expect(() => loadEnv({ ...prod, PUSH_MODE: 'memory' })).toThrow();
  });

  it('development accepts the stand-ins', () => {
    expect(loadEnv({ ...prod, NODE_ENV: 'development' }).SMS_MODE).toBe('memory');
  });
});
