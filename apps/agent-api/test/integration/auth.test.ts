import { Harness, newDevice, PIN } from '../support/harness';

describe('Auth', () => {
  let h: Harness;
  const phone = '+240222000101';

  beforeAll(async () => {
    h = await Harness.start();
    await h.createAgent(phone);
  });
  afterAll(() => h.stop());

  const loginBody = (device = newDevice(), pin = PIN, p = phone) => ({
    phone: p,
    pin,
    device: { installation_id: device.installationId, platform: 'android', model: 'Samsung Galaxy A14', app_version: '1.0.0' }
  });

  it('new device: PIN, then OTP by SMS, then the device is trusted with a cooldown', async () => {
    const device = newDevice();
    const first = await h.request('POST', '/agent/v1/auth/login', { body: loginBody(device) });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'otp_required', channel: 'sms', destination_masked: '****0101', reason: 'new_device' });
    expect(first.body.access_token).toBeUndefined();

    const code = h.sms.lastCodeFor(phone);
    expect(code).toMatch(/^\d{6}$/);
    const second = await h.request('POST', '/agent/v1/auth/verify-otp', {
      body: { challenge_id: first.body.challenge_id, code, device_keys: { device_public_key: device.publicJwk } }
    });
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('authenticated');
    expect(second.body.access_token).toEqual(expect.any(String));
    expect(second.body.device.cooldown_until).toEqual(expect.any(String));
    expect(second.body.agent).toMatchObject({ first_name: 'Carlos', status: 'active' });

    // Same device next time: no OTP.
    const again = await h.request('POST', '/agent/v1/auth/login', { body: loginBody(device) });
    expect(again.body.status).toBe('authenticated');

    // A security notification and audit trail were written.
    const notif = await h.db.selectFrom('agent.agent_notifications').select('type').where('type', '=', 'new_device_detected').execute();
    expect(notif.length).toBeGreaterThan(0);
    const audit = await h.db.selectFrom('agent.agent_audit_logs').select('action').where('action', 'in', ['DEVICE_TRUSTED', 'LOGIN']).execute();
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['DEVICE_TRUSTED', 'LOGIN']));
  });

  it('never stores the OTP or PIN in clear', async () => {
    const creds = await h.db.selectFrom('agent.agent_credentials').select('pin_hash').execute();
    for (const c of creds) {
      expect(c.pin_hash.startsWith('$argon2id$')).toBe(true);
      expect(c.pin_hash).not.toContain(PIN);
    }
    const code = h.sms.lastCodeFor(phone)!;
    const otps = await h.db.selectFrom('agent.agent_otp_challenges').select(['code_hash', 'context']).execute();
    for (const o of otps) {
      expect(o.code_hash).not.toContain(code);
      expect(JSON.stringify(o.context)).not.toContain(PIN);
    }
  });

  it('wrong OTP counts attempts and invalidates the challenge', async () => {
    const first = await h.request('POST', '/agent/v1/auth/login', { body: loginBody() });
    const bad = (code: string) => h.request('POST', '/agent/v1/auth/verify-otp', { body: { challenge_id: first.body.challenge_id, code, device_keys: { device_public_key: newDevice().publicJwk } } });
    const r1 = await bad('000000');
    expect(r1.status).toBe(400);
    expect(r1.body.error).toMatchObject({ code: 'OTP_INVALID', details: { attempts_left: 2 } });
    await bad('000001');
    const r3 = await bad('000002');
    expect(r3.body.error.code).toBe('OTP_EXPIRED');
    // Even the right code no longer works.
    const right = await bad(h.sms.lastCodeFor(phone)!);
    expect(right.body.error.code).toBe('OTP_EXPIRED');
  });

  it('rejects an invalid device public key', async () => {
    const first = await h.request('POST', '/agent/v1/auth/login', { body: loginBody() });
    const res = await h.request('POST', '/agent/v1/auth/verify-otp', {
      body: { challenge_id: first.body.challenge_id, code: h.sms.lastCodeFor(phone), device_keys: { device_public_key: { kty: 'RSA', n: 'x', e: 'AQAB' } } }
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('unknown phone and wrong PIN give the same neutral error', async () => {
    const unknown = await h.request('POST', '/agent/v1/auth/login', { body: loginBody(newDevice(), PIN, '+240222999999') });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error.message).toBe('Teléfono o PIN incorrectos.');
  });

  it('locks the account after 5 wrong PINs, even with the right PIN afterwards', async () => {
    const p = '+240222000102';
    await h.createAgent(p);
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await h.request('POST', '/agent/v1/auth/login', { body: loginBody(newDevice(), '111222', p) }));
    expect(results[0]!.body.error.details.attempts_left).toBe(4);
    expect(results[4]!.status).toBe(423);
    expect(results[4]!.body.error.code).toBe('ACCOUNT_LOCKED');

    const right = await h.request('POST', '/agent/v1/auth/login', { body: loginBody(newDevice(), PIN, p) });
    expect(right.status).toBe(423);

    h.clock.advance(16 * 60 * 1000);
    const later = await h.request('POST', '/agent/v1/auth/login', { body: loginBody(newDevice(), PIN, p) });
    expect(later.body.status).toBe('otp_required');
  });

  it('rotates refresh tokens and kills the family when one is reused', async () => {
    const s = await h.login(phone);
    const r1 = await h.request('POST', '/agent/v1/auth/refresh', { body: { refresh_token: s.refreshToken } });
    expect(r1.status).toBe(200);
    expect(r1.body.refresh_token).not.toBe(s.refreshToken);

    // Replaying the old token = theft signal.
    const replay = await h.request('POST', '/agent/v1/auth/refresh', { body: { refresh_token: s.refreshToken } });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('SESSION_REVOKED');

    // The legitimate new token is dead too, and so is its access token.
    const r2 = await h.request('POST', '/agent/v1/auth/refresh', { body: { refresh_token: r1.body.refresh_token } });
    expect(r2.status).toBe(401);
    const me = await h.get({ ...s, accessToken: r1.body.access_token }, '/agent/v1/me');
    expect(me.status).toBe(401);
  });

  it('logout revokes the session immediately', async () => {
    const s = await h.login(phone);
    expect((await h.get(s, '/agent/v1/me')).status).toBe(200);
    const out = await h.request('POST', '/agent/v1/auth/logout', { headers: { authorization: `Bearer ${s.accessToken}` } });
    expect(out.status).toBe(204);
    const after = await h.get(s, '/agent/v1/me');
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('SESSION_REVOKED');
  });

  it('a new device replaces the old one (max 1 trusted device) and ends its sessions', async () => {
    const p = '+240222000103';
    await h.createAgent(p);
    const oldSession = await h.login(p);
    const newSession = await h.login(p);
    expect((await h.get(newSession, '/agent/v1/me')).status).toBe(200);
    const old = await h.get(oldSession, '/agent/v1/me');
    expect(old.status).toBe(401);
  });

  it('rejects forged, tampered or expired access tokens', async () => {
    const s = await h.login(phone);
    const [head, payload, sig] = s.accessToken.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), sub: '00000000-0000-0000-0000-000000000000' })).toString('base64url');
    expect((await h.get({ ...s, accessToken: `${head}.${forgedPayload}.${sig}` }, '/agent/v1/me')).status).toBe(401);
    expect((await h.get({ ...s, accessToken: 'abc.def.ghi' }, '/agent/v1/me')).status).toBe(401);
    h.clock.advance(11 * 60 * 1000);
    const expired = await h.get(s, '/agent/v1/me');
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('GET /me tells the app what to show', async () => {
    const s = await h.login(phone);
    const me = await h.get(s, '/agent/v1/me');
    expect(me.body.agent).toMatchObject({ agent_code: expect.stringMatching(/^AG-\d{6}$/), first_name: 'Carlos', last_name_initial: 'T.', status: 'active' });
    expect(me.body.features).toEqual(expect.arrayContaining(['cash_in', 'cash_out']));
  });

  it('forces an app update for old versions', async () => {
    const s = await h.login(phone);
    const res = await h.request('GET', '/agent/v1/me', { headers: { authorization: `Bearer ${s.accessToken}`, 'x-app-version': '0.9.0' } });
    expect(res.status).toBe(426);
  });
});
