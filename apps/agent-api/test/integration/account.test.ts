import { Harness, PIN, Session } from '../support/harness';

describe('Commissions, notifications, security and code throttling', () => {
  let h: Harness;
  let agent: { id: string; agentCode: string };
  let s: Session;
  const phone = '+240222000601';
  const customerPhone = '+240555006001';
  let customerRef: string;

  beforeAll(async () => {
    h = await Harness.start();
    agent = await h.createAgent(phone, PIN, 500_000);
    customerRef = await h.core.addCustomer(customerPhone, 'XAF', 300_000);
    s = await h.login(phone);
    h.clock.advance(25 * 3600 * 1000);
    s = await h.login(phone, PIN, s.device);

    // Some activity: one cash-out (commission 500) and one cash-in (commission 250).
    const w = await h.core.createWithdrawal(customerRef, 50_000);
    const out = await h.signedPost(s, '/agent/v1/cash-out', { withdrawal_request_id: w.id, amount: 50_000, currency: 'XAF', agent_auth: { method: 'pin', pin: PIN } });
    expect(out.status).toBe(201);
    const cin = await h.signedPost(s, '/agent/v1/cash-in', { customer: { type: 'phone', value: customerPhone }, amount: 50_000, currency: 'XAF', agent_auth: { method: 'pin', pin: PIN } });
    const { core_request_ref } = await h.db.selectFrom('agent.agent_transactions').select('core_request_ref').where('id', '=', cin.body.transaction.id).executeTakeFirstOrThrow();
    await h.coreEvent({ type: 'deposit_request.confirmed', deposit_request_id: core_request_ref, agent_transaction_id: cin.body.transaction.id });
  });
  afterAll(() => h.stop());

  const post = (sess: Session, url: string) => h.request('POST', url, { headers: { authorization: `Bearer ${sess.accessToken}` } });

  describe('commissions', () => {
    it('summary: periods, pending from the ledger and breakdown by type', async () => {
      const res = await h.get(s, '/agent/v1/commissions/summary');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ currency: 'XAF', today: 750, last_7_days: 750, this_month: 750, all_time: 750, pending_settlement: 750 });
      expect(res.body.by_type_this_month).toEqual([
        { operation_type: 'cash_out', count: 1, amount: 500 },
        { operation_type: 'cash_in', count: 1, amount: 250 }
      ]);
    });

    it('list: one line per operation, newest first, with cursor and type filter', async () => {
      const first = await h.get(s, '/agent/v1/commissions?limit=1');
      expect(first.body.data).toHaveLength(1);
      expect(first.body.data[0]).toMatchObject({ operation_type: 'cash_in', base_amount: 50_000, commission: 250, status: 'accrued' });
      expect(first.body.data[0].reference).toMatch(/^BTX-/);
      const second = await h.get(s, `/agent/v1/commissions?limit=1&cursor=${first.body.next_cursor}`);
      expect(second.body.data[0].operation_type).toBe('cash_out');
      expect(second.body.next_cursor).toBeNull();
      const onlyOut = await h.get(s, '/agent/v1/commissions?type=cash_out');
      expect(onlyOut.body.data).toHaveLength(1);
      expect((await h.get(s, '/agent/v1/commissions?cursor=garbage')).status).toBe(400);
    });
  });

  describe('notifications', () => {
    it('lists the inbox with unread count and marks as read', async () => {
      const list = await h.get(s, '/agent/v1/notifications');
      expect(list.status).toBe(200);
      const types = list.body.data.map((n: any) => n.type);
      expect(types).toEqual(expect.arrayContaining(['cash_in_completed', 'cash_out_completed']));
      expect(list.body.unread_count).toBe(list.body.data.length);
      const cashIn = list.body.data.find((n: any) => n.type === 'cash_in_completed');
      expect(cashIn).toMatchObject({ title_key: 'notif.cash_in_completed.title', params: { amount: 50_000, currency: 'XAF' }, read_at: null });
      expect(cashIn.related_transaction_id).toBeTruthy();

      const read = await post(s, `/agent/v1/notifications/${cashIn.id}/read`);
      expect(read.status).toBe(200);
      expect(read.body.unread_count).toBe(list.body.unread_count - 1);
      expect((await h.get(s, '/agent/v1/notifications?unread=true')).body.data.some((n: any) => n.id === cashIn.id)).toBe(false);

      const all = await post(s, '/agent/v1/notifications/read-all');
      expect(all.body.unread_count).toBe(0);
      expect((await h.get(s, '/agent/v1/notifications/unread-count')).body.unread_count).toBe(0);
    });

    it('another agent cannot read my notifications', async () => {
      await h.createAgent('+240222000602');
      const other = await h.login('+240222000602');
      const mine = (await h.get(s, '/agent/v1/notifications')).body.data[0];
      expect((await post(other, `/agent/v1/notifications/${mine.id}/read`)).status).toBe(404);
      expect((await h.get(other, '/agent/v1/notifications')).body.data.every((n: any) => n.id !== mine.id)).toBe(true);
    });
  });

  describe('security', () => {
    it('overview, devices, sessions and access history', async () => {
      const ov = await h.get(s, '/agent/v1/security/overview');
      expect(ov.status).toBe(200);
      expect(ov.body).toMatchObject({ this_device: { id: s.deviceId, model: 'Samsung Galaxy A14', platform: 'android' }, active_sessions: expect.any(Number), trusted_devices: 1 });
      expect(ov.body.previous_login).not.toBeNull();

      const devices = await h.get(s, '/agent/v1/security/devices');
      expect(devices.body.data.find((d: any) => d.current)).toMatchObject({ id: s.deviceId, status: 'trusted' });

      const sessions = await h.get(s, '/agent/v1/security/sessions');
      expect(sessions.body.data.filter((x: any) => x.current)).toHaveLength(1);

      const history = await h.get(s, '/agent/v1/security/access-history?limit=2');
      expect(history.body.data).toHaveLength(2);
      expect(history.body.data[0].event).toBe('login_success');
      const next = await h.get(s, `/agent/v1/security/access-history?limit=50&cursor=${history.body.next_cursor}`);
      expect(next.body.data.map((e: any) => e.event)).toEqual(expect.arrayContaining(['otp_sent']));
      for (const e of [...history.body.data, ...next.body.data]) expect(e.ip_masked === null || !/\d+\.\d+\.\d+\.\d+/.test(e.ip_masked)).toBe(true);
    });

    it('close other sessions requires PIN and keeps this one', async () => {
      const second = await h.login(phone, PIN, s.device); // same trusted device, a second session
      const wrong = await h.signedPost(s, '/agent/v1/security/sessions/revoke-others', { agent_auth: { method: 'pin', pin: '000111' } });
      expect(wrong.status).toBe(401);
      const ok = await h.signedPost(s, '/agent/v1/security/sessions/revoke-others', { agent_auth: { method: 'pin', pin: PIN } });
      expect(ok.status).toBe(200);
      expect(ok.body.revoked).toBeGreaterThanOrEqual(1);
      expect((await h.get(second, '/agent/v1/me')).status).toBe(401);
      expect((await h.get(s, '/agent/v1/me')).status).toBe(200);
    });

    describe('PIN change', () => {
      const change = (current: string, next: string) => h.signedPost(s, '/agent/v1/security/pin/change', { current_pin: current, new_pin: next });

      it('rejects a wrong current PIN, weak PINs and the same PIN', async () => {
        expect((await change('000111', '739251')).body.error.code).toBe('PIN_INVALID');
        expect((await change(PIN, '111111')).body.error.code).toBe('PIN_TOO_WEAK');
        expect((await change(PIN, '123456')).body.error.code).toBe('PIN_TOO_WEAK');
        expect((await change(PIN, PIN)).body.error.code).toBe('PIN_REUSED');
      });

      it('changes the PIN, closes other sessions, notifies, and refuses the last 3 PINs', async () => {
        const other = await h.login(phone, PIN, s.device);
        const res = await change(PIN, '739251');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ changed: true, other_sessions_revoked: 1 });
        expect((await h.get(other, '/agent/v1/me')).status).toBe(401);
        expect((await h.get(s, '/agent/v1/me')).status).toBe(200);

        // Old PIN no longer works, new one does.
        const oldLogin = await h.request('POST', '/agent/v1/auth/login', { body: { phone, pin: PIN, device: { installation_id: s.device.installationId, platform: 'android' } } });
        expect(oldLogin.status).toBe(401);
        await h.login(phone, '739251', s.device);

        const notif = (await h.get(s, '/agent/v1/notifications')).body.data[0];
        expect(notif).toMatchObject({ type: 'security_alert', title_key: 'notif.pin_changed.title' });

        expect((await change('739251', '582046')).status).toBe(200);
        expect((await change('582046', PIN)).body.error.code).toBe('PIN_REUSED'); // 2 changes ago
        expect((await change('582046', '739251')).body.error.code).toBe('PIN_REUSED'); // previous one
        expect((await change('582046', '904817')).status).toBe(200);
        expect((await change('904817', PIN)).status).toBe(200); // older than the last 3: allowed

        const hist = await h.db.selectFrom('agent.agent_pin_history').select('pin_hash').where('agent_id', '=', agent.id).execute();
        expect(hist).toHaveLength(4);
        expect(hist.every((r) => r.pin_hash.startsWith('$argon2id$'))).toBe(true);
      });
    });
  });

  describe('invalid code throttling', () => {
    it('5 invalid codes in 10 minutes block code lookups for 15 minutes', async () => {
      const resolve = (value: string, type = 'code') =>
        h.request('POST', '/agent/v1/cash-out/resolve', { body: { code: { type, value } }, headers: { authorization: `Bearer ${s.accessToken}` } });
      const scan = (payload: string) => h.request('POST', '/agent/v1/qr/scan', { body: { payload }, headers: { authorization: `Bearer ${s.accessToken}` } });

      // Expired or used codes are honest mistakes and don't count.
      const w = await h.core.createWithdrawal(customerRef, 10_000, 'XAF', 60);
      h.clock.advance(2 * 60 * 1000);
      expect((await resolve(w.code)).body.error.code).toBe('QR_EXPIRED');

      for (let i = 0; i < 3; i++) expect((await resolve(`00000000${i}`)).body.error.code).toBe('WITHDRAWAL_CODE_INVALID');
      expect((await scan('BSV1.C.doesnotexist')).body.error.code).toBe('QR_INVALID');
      expect((await scan('not-a-bata-code')).body.error.code).toBe('QR_INVALID');

      const blocked = await resolve('000000009');
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
      expect(blocked.body.error.details.retry_after_seconds).toBeGreaterThan(800);
      // Even a valid code is refused while blocked.
      const valid = await h.core.createWithdrawal(customerRef, 10_000);
      expect((await resolve(valid.code)).status).toBe(429);
      expect((await scan(valid.qr)).status).toBe(429);

      h.clock.advance(16 * 60 * 1000);
      s = await h.login(phone, PIN, s.device); // the access token expired meanwhile
      const again = await h.core.createWithdrawal(customerRef, 10_000);
      expect((await resolve(again.code)).status).toBe(200);
    });
  });
});
