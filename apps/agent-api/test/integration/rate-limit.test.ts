import Redis from 'ioredis';
import { Harness, PIN, Session } from '../support/harness';

const REDIS_URL = process.env.TEST_REDIS_URL;

// Always against the in-process limiter; also against a real Redis when TEST_REDIS_URL is set (CI).
const backends: [string, string][] = [['memory', ''], ...(REDIS_URL ? ([['redis', REDIS_URL]] as [string, string][]) : [])];

describe.each(backends)('Rate limiting (%s)', (backend, redisUrl) => {
  let h: Harness;
  let s: Session;
  const phone = backend === 'redis' ? '+240222000811' : '+240222000801';
  const login = (p: string, pin = '000111', ip?: string) =>
    h.request('POST', '/agent/v1/auth/login', { body: { phone: p, pin, device: { installation_id: 'inst_ratelimit01', platform: 'android' } }, headers: ip ? { 'x-forwarded-for': ip } : {} });

  beforeAll(async () => {
    if (redisUrl) {
      const r = new Redis(redisUrl);
      await r.flushdb();
      r.disconnect();
    }
    h = await Harness.start({ env: { RATE_LIMITS_ENABLED: 'true', REDIS_URL: redisUrl } });
    await h.createAgent(phone);
    s = await h.login(phone);
  });
  afterAll(() => h.stop());

  it('login: 5 per phone per minute, with Retry-After; other phones are not affected', async () => {
    h.clock.advance(60_000 - (h.clock.now().getTime() % 60_000) + 1000); // start of a fresh window
    const target = backend === 'redis' ? '+240222000812' : '+240222000802';
    for (let i = 0; i < 5; i++) {
      const r = await login(target, '000111', `10.0.0.${i}`);
      expect(r.status).not.toBe(429);
      expect(r.headers['x-ratelimit-remaining']).toBe(String(4 - i));
    }
    const blocked = await login(target, '000111', '10.0.0.9');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.body.error.details.retry_after_seconds).toBe(Number(blocked.headers['retry-after']));
    expect((await login('+240222000899', '000111', '10.0.0.9')).status).not.toBe(429);

    h.clock.advance(61_000);
    expect((await login(target, '000111', '10.0.1.1')).status).not.toBe(429);
  });

  it('login: 20 per IP per minute across phones', async () => {
    h.clock.advance(60_000 - (h.clock.now().getTime() % 60_000) + 1000);
    for (let i = 0; i < 20; i++) expect((await login(`+2405550${String(i).padStart(5, '0')}`, '000111', '10.9.9.9')).status).not.toBe(429);
    expect((await login('+240555099999', '000111', '10.9.9.9')).status).toBe(429);
    expect((await login('+240555099999', '000111', '10.9.9.8')).status).not.toBe(429);
  });

  it('reads: 120 per minute per agent, with X-RateLimit headers', async () => {
    h.clock.advance(60_000 - (h.clock.now().getTime() % 60_000) + 1000);
    s = await h.login(phone, PIN, s.device);
    const first = await h.get(s, '/agent/v1/me');
    expect(first.headers['x-ratelimit-limit']).toBe('120');
    expect(first.headers['x-ratelimit-remaining']).toBe('119');
    for (let i = 0; i < 119; i++) await h.get(s, '/agent/v1/limits');
    const over = await h.get(s, '/agent/v1/me');
    expect(over.status).toBe(429);
  });

  it('financial operations: 20 per minute per agent', async () => {
    h.clock.advance(60_000 - (h.clock.now().getTime() % 60_000) + 1000);
    s = await h.login(phone, PIN, s.device);
    for (let i = 0; i < 20; i++) {
      const r = await h.signedPost(s, '/agent/v1/qr/create', { kind: 'collect', amount: 500, currency: 'XAF' });
      expect(r.status).toBe(201);
    }
    const over = await h.signedPost(s, '/agent/v1/qr/create', { kind: 'collect', amount: 500, currency: 'XAF' });
    expect(over.status).toBe(429);
    // Other groups keep their own budget.
    expect((await h.get(s, '/agent/v1/me')).status).toBe(200);
  });

  it('Velynt Core internal calls are not rate limited', async () => {
    for (let i = 0; i < 40; i++) {
      const r = await h.coreRequest('/internal/v1/qr/resolve', { payload: 'BSV1.K.doesnotexist.' + 'a'.repeat(40) });
      expect(r.status).toBe(404);
    }
  });

  if (backend === 'redis') {
    it('never stores phone numbers or tokens in Redis keys', async () => {
      const r = new Redis(redisUrl);
      const keys = await r.keys('rl:*');
      r.disconnect();
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.some((k) => k.includes('+240') || k.includes('222000'))).toBe(false);
    });
  }
});

describe('Rate limiting when Redis is down', () => {
  it('lets requests through (money rules live in the database)', async () => {
    const h = await Harness.start({ env: { RATE_LIMITS_ENABLED: 'true', REDIS_URL: 'redis://127.0.0.1:6399' } });
    try {
      await h.createAgent('+240222000821');
      const s = await h.login('+240222000821');
      const me = await h.get(s, '/agent/v1/me');
      expect(me.status).toBe(200);
      expect(me.headers['x-ratelimit-limit']).toBeUndefined();
    } finally {
      await h.stop();
    }
  });
});
