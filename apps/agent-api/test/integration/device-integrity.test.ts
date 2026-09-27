import { Harness, PIN, Session } from '../support/harness';

describe('Rooted / jailbroken / emulated phones can read but not operate', () => {
  let h: Harness;
  let s: Session;
  let customerRef: string;
  const phone = '+240222000951';

  beforeAll(async () => {
    h = await Harness.start();
    await h.createAgent(phone, PIN, 300_000);
    customerRef = await h.core.addCustomer('+240555009501', 'XAF', 100_000);
    s = await h.login(phone);
    h.clock.advance(25 * 3600 * 1000);
    s = await h.login(phone, PIN, s.device);
  });
  afterAll(() => h.stop());

  const report = (flags: { rooted: boolean; emulator: boolean }) =>
    h.request('POST', '/agent/v1/security/device-integrity', { body: flags, headers: { authorization: `Bearer ${s.accessToken}` } });
  const resolve = async () => {
    const w = await h.core.createWithdrawal(customerRef, 10_000);
    return h.request('POST', '/agent/v1/cash-out/resolve', { body: { code: { type: 'code', value: w.code } }, headers: { authorization: `Bearer ${s.accessToken}` } });
  };

  it('a clean phone operates normally', async () => {
    expect((await report({ rooted: false, emulator: false })).body).toEqual({ compromised: false });
    expect((await resolve()).status).toBe(200);
    const me = await h.get(s, '/agent/v1/me');
    expect(me.body.device.compromised).toBe(false);
    expect(me.body.features).toEqual(expect.arrayContaining(['cash_in', 'cash_out', 'qr']));
  });

  it('once rooted: every operation is refused, reading still works', async () => {
    expect((await report({ rooted: true, emulator: false })).body).toEqual({ compromised: true });

    expect((await resolve()).body.error.code).toBe('DEVICE_COMPROMISED');
    const cashIn = await h.signedPost(s, '/agent/v1/cash-in', { customer: { type: 'phone', value: '+240555009501' }, amount: 5_000, currency: 'XAF', agent_auth: { method: 'pin', pin: PIN } });
    expect(cashIn.status).toBe(403);
    expect(cashIn.body.error.code).toBe('DEVICE_COMPROMISED');
    const qr = await h.signedPost(s, '/agent/v1/qr/create', { kind: 'collect', amount: 1_000, currency: 'XAF' });
    expect(qr.body.error.code).toBe('DEVICE_COMPROMISED');
    const scan = await h.request('POST', '/agent/v1/qr/scan', { body: { payload: h.core.issueCustomerQr(customerRef) }, headers: { authorization: `Bearer ${s.accessToken}` } });
    expect(scan.body.error.code).toBe('DEVICE_COMPROMISED');

    const me = await h.get(s, '/agent/v1/me');
    expect(me.body.device.compromised).toBe(true);
    expect(me.body.features).not.toEqual(expect.arrayContaining(['cash_in']));
    expect(me.body.features).toEqual(expect.arrayContaining(['transactions', 'commissions', 'support']));
    expect((await h.get(s, '/agent/v1/balance')).status).toBe(200);
    expect((await h.get(s, '/agent/v1/transactions')).status).toBe(200);
  });

  it('an emulator counts too, and the report is audited on every change', async () => {
    expect((await report({ rooted: false, emulator: true })).body.compromised).toBe(true);
    expect((await report({ rooted: false, emulator: false })).body.compromised).toBe(false);
    expect((await resolve()).status).toBe(200);
    const audit = await h.db.selectFrom('agent.agent_audit_logs').select('metadata').where('action', '=', 'DEVICE_INTEGRITY_CHANGED').execute();
    expect(audit.length).toBe(2); // clean -> rooted, then emulator -> clean (rooted -> emulator is not a change)
  });

  it('the signal also arrives with the login', async () => {
    const res = await h.request('POST', '/agent/v1/auth/login', {
      body: { phone, pin: PIN, device: { installation_id: s.device.installationId, platform: 'android', integrity: { rooted: true, emulator: false } } }
    });
    expect(res.body.status).toBe('authenticated');
    const me = await h.request('GET', '/agent/v1/me', { headers: { authorization: `Bearer ${res.body.access_token}` } });
    expect(me.body.device.compromised).toBe(true);
  });
});
