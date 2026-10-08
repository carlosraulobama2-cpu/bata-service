import { Harness, PIN, Session } from '../support/harness';

describe('Customer verification before a deposit', () => {
  let h: Harness;
  let s: Session;
  const verifiedPhone = '+240555100001';
  const pendingPhone = '+240555100002';

  beforeAll(async () => {
    h = await Harness.start();
    await h.createAgent('+240222000601', PIN, 500_000);
    await h.core.addCustomer(verifiedPhone, 'XAF', 0, { fullName: 'Juan Pablo Mba Nsue', kycStatus: 'verified' });
    await h.core.addCustomer(pendingPhone, 'XAF', 0, { fullName: 'María Ayingono Ondo', kycStatus: 'pending' });
    s = await h.login('+240222000601');
    h.clock.advance(25 * 3600 * 1000);
    s = await h.login('+240222000601', PIN, s.device);
  });
  afterAll(() => h.stop());

  const verify = (full_name: string, phone: string) =>
    h.request('POST', '/agent/v1/customers/verify', { body: { phone, full_name }, headers: { authorization: `Bearer ${s.accessToken}` } });

  it('confirms a verified customer and shows only "Juan M." and ****0001', async () => {
    const res = await verify('juan mba', verifiedPhone);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'verified',
      customer: { display_name: 'Juan M.', phone_masked: '****0001', verified_at: expect.any(String), token: expect.stringMatching(/^ctk_/) }
    });
    expect(JSON.stringify(res.body)).not.toMatch(/Pablo|Nsue|555100001/);
  });

  it('ignores accents, case and extra spaces but needs first name + a surname', async () => {
    expect((await verify('  JUÁN   Nsué ', verifiedPhone)).status).toBe(200);
    expect((await verify('Juan', verifiedPhone)).status).toBe(404);
    expect((await verify('Juan Obiang', verifiedPhone)).status).toBe(404);
  });

  it('gives the same answer for "wrong name" and "no such phone"', async () => {
    const wrongName = await verify('Pedro Esono', verifiedPhone);
    const unknown = await verify('Juan Mba', '+240555999999');
    expect(wrongName.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(wrongName.body.error.code).toBe('CUSTOMER_NOT_FOUND');
    expect(unknown.body.error).toEqual({ ...wrongName.body.error, request_id: unknown.body.error.request_id });
  });

  it('refuses customers whose verification is not approved yet', async () => {
    const res = await verify('María Ayingono', pendingPhone);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'CUSTOMER_NOT_VERIFIED', details: { kyc_status: 'pending', display_name: 'María A.' } });
  });

  it('works as soon as BataPay approves the customer in the control panel', async () => {
    h.core.setKycStatus(pendingPhone, 'verified');
    const res = await verify('María Ondo', pendingPhone);
    expect(res.status).toBe(200);
    expect(res.body.customer.display_name).toBe('María A.');
  });

  it('a deposit needs a fresh, unused verification token', async () => {
    const v = await verify('Juan Mba', verifiedPhone);
    const body = (token: string) => ({ customer: { type: 'token', value: token }, amount: 10_000, currency: 'XAF', agent_auth: { method: 'pin', pin: PIN } });
    const first = await h.signedPost(s, '/agent/v1/cash-in', body(v.body.customer.token));
    expect(first.status).toBe(201);
    expect(first.body.transaction.customer_masked).toBe('****0001');

    const reused = await h.signedPost(s, '/agent/v1/cash-in', body(v.body.customer.token));
    expect(reused.status).toBe(410);
    expect(reused.body.error.code).toBe('CUSTOMER_CHECK_EXPIRED');

    const old = await verify('Juan Mba', verifiedPhone);
    h.clock.advance(6 * 60 * 1000);
    const late = await h.signedPost(s, '/agent/v1/cash-in', body(old.body.customer.token));
    expect(late.body.error.code).toBe('CUSTOMER_CHECK_EXPIRED');

    const phoneOnly = await h.signedPost(s, '/agent/v1/cash-in', { ...body('x'), customer: { type: 'phone', value: verifiedPhone } });
    expect(phoneOnly.status).toBe(400);
  });

  it('re-checks the verification when the deposit is created', async () => {
    const v = await verify('Juan Mba', verifiedPhone);
    h.core.setKycStatus(verifiedPhone, 'rejected'); // revoked in the control panel meanwhile
    const res = await h.signedPost(s, '/agent/v1/cash-in', { customer: { type: 'token', value: v.body.customer.token }, amount: 10_000, currency: 'XAF', agent_auth: { method: 'pin', pin: PIN } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CUSTOMER_NOT_VERIFIED');
    h.core.setKycStatus(verifiedPhone, 'verified');
  });

  it('audits each check without storing the typed name', async () => {
    const logs = await h.db.selectFrom('agent.agent_audit_logs').select(['result', 'reason_code', 'metadata']).where('action', '=', 'CUSTOMER_VERIFY').execute();
    expect(logs.length).toBeGreaterThan(5);
    expect(logs.some((l) => l.reason_code === 'CUSTOMER_NOT_FOUND')).toBe(true);
    expect(JSON.stringify(logs)).not.toMatch(/Pedro|Juan|Mba|555100001/);
  });

  it('does not count checks of real but not-yet-verified customers as guessing', async () => {
    h.core.setKycStatus(pendingPhone, 'pending');
    for (let i = 0; i < 12; i++) expect((await verify('María Ayingono', pendingPhone)).status).toBe(422);
    h.core.setKycStatus(pendingPhone, 'verified');
    expect((await verify('María Ayingono', pendingPhone)).status).toBe(200);
  });

  it('pauses an agent who fails too many checks (anti-guessing)', async () => {
    let last;
    for (let i = 0; i < 12; i++) last = await verify('Nadie Nunca', `+24055520000${i % 10}`);
    expect(last!.status).toBe(429);
    expect(last!.body.error.code).toBe('RATE_LIMITED');
    // Even a correct check waits until the window passes.
    expect((await verify('Juan Mba', verifiedPhone)).status).toBe(429);
    h.clock.advance(11 * 60 * 1000);
    s = await h.login('+240222000601', PIN, s.device);
    expect((await verify('Juan Mba', verifiedPhone)).status).toBe(200);
  });
});
