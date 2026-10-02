import { loadEnv } from '../../src/config/env';
import { Harness } from '../support/harness';

describe('Support contacts (public config)', () => {
  it('are hidden (null) until configured, and readable without signing in', async () => {
    const h = await Harness.start();
    try {
      const res = await h.request('GET', '/agent/v1/public/config');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ support: { phone: null, whatsapp: null, hours: null }, min_app_version: '1.0.0' });
    } finally {
      await h.stop();
    }
  });

  it('shows the configured phone, WhatsApp and hours', async () => {
    const h = await Harness.start({ env: { SUPPORT_PHONE: '+240333000111', SUPPORT_WHATSAPP: '+240222000999', SUPPORT_HOURS: 'Lunes a sábado, 8:00–20:00' } });
    try {
      const res = await h.request('GET', '/agent/v1/public/config');
      expect(res.body.support).toEqual({ phone: '+240333000111', whatsapp: '+240222000999', hours: 'Lunes a sábado, 8:00–20:00' });
    } finally {
      await h.stop();
    }
  });

  it('refuses a malformed support number at startup', () => {
    const base = {
      DATABASE_URL: 'postgresql://x/y',
      LEDGER_DATABASE_URL: 'postgresql://x/y',
      CORE_EVENTS_HMAC_SECRET: 'dev-only-0123456789abcdef0123456789',
      JWT_PRIVATE_KEY_PEM: 'x',
      QR_SIGNING_PRIVATE_KEY_PEM: 'x',
      PIN_PEPPER: 'dev-only-0123456789abcdef0123456789',
      LOOKUP_HMAC_KEY: 'dev-only-0123456789abcdef0123456789'
    };
    expect(() => loadEnv({ ...base, SUPPORT_PHONE: '222 000 999' })).toThrow(/SUPPORT_PHONE/);
    expect(() => loadEnv({ ...base, SUPPORT_WHATSAPP: '+240222000999' })).not.toThrow();
  });
});
