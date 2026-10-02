import { Harness, newDevice, PIN, Session } from '../support/harness';

describe('Push notifications', () => {
  let h: Harness;
  let s: Session;
  let customerRef: string;
  const phone = '+240222000901';
  const token = 'ExponentPushToken[agent-phone-A-0001]';

  beforeAll(async () => {
    h = await Harness.start({ env: { MAX_TRUSTED_DEVICES: '2' } });
    await h.createAgent(phone, PIN, 500_000);
    customerRef = await h.core.addCustomer('+240555009001', 'XAF', 400_000);
    s = await h.login(phone);
  });
  afterAll(() => h.stop());

  const post = (url: string, body?: unknown) => h.request('POST', url, { body, headers: { authorization: `Bearer ${s.accessToken}` } });
  const put = (url: string, body: unknown) => h.request('PUT', url, { body, headers: { authorization: `Bearer ${s.accessToken}` } });
  const cashOut = async (amount: number) => {
    const w = await h.core.createWithdrawal(customerRef, amount);
    const res = await h.signedPost(s, '/agent/v1/cash-out', { withdrawal_request_id: w.id, amount, currency: 'XAF', agent_auth: { method: 'pin', pin: PIN } });
    expect(res.status).toBe(201);
    return res.body.transaction;
  };
  const delivery = (transactionId: string) =>
    h.db
      .selectFrom('agent.agent_notification_deliveries as d')
      .innerJoin('agent.agent_notifications as n', 'n.id', 'd.notification_id')
      .select(['d.status', 'd.attempts', 'd.last_error', 'd.sent_to'])
      .where('n.related_transaction_id', '=', transactionId)
      .executeTakeFirstOrThrow();

  it('without a registered token nothing is sent (skipped, not failed)', async () => {
    await h.dispatchPush(); // clear what login produced
    const tx = await cashOut(10_000);
    await h.dispatchPush();
    expect(await delivery(tx.id)).toMatchObject({ status: 'skipped', last_error: 'no_push_device' });
  });

  it('registers the token and pushes a completed operation, without customer data', async () => {
    expect((await post('/agent/v1/push-tokens', { token })).status).toBe(200);
    const tx = await cashOut(50_000);
    const before = h.push.sent.length;
    const stats = await h.dispatchPush();
    expect(stats.sent).toBe(1);
    const msg = h.push.sent[before]!;
    expect(msg).toMatchObject({ to: token, title: 'Retiro completado', channelId: 'operations', data: { type: 'cash_out_completed', transaction_id: tx.id } });
    expect(msg.body).toBe(`Entregaste 50.000 XAF · ${tx.reference}`);
    expect(JSON.stringify(msg)).not.toMatch(/9001|555/); // never the customer's phone
    expect(await delivery(tx.id)).toMatchObject({ status: 'sent', attempts: 1, sent_to: 1 });
    // Nothing is sent twice.
    await h.dispatchPush();
    expect(h.push.sent.length).toBe(before + 1);
  });

  it('respects preferences, but security notifications cannot be muted', async () => {
    const prefs = await put('/agent/v1/notifications/preferences', { preferences: { cash_out_completed: false } });
    expect(prefs.status).toBe(200);
    expect(prefs.body.data.find((p: any) => p.type === 'cash_out_completed')).toEqual({ type: 'cash_out_completed', push_enabled: false, locked: false });
    expect(prefs.body.data.find((p: any) => p.type === 'security_alert')).toEqual({ type: 'security_alert', push_enabled: true, locked: true });

    const tx = await cashOut(5_000);
    await h.dispatchPush();
    expect(await delivery(tx.id)).toMatchObject({ status: 'skipped', last_error: 'muted_by_agent' });

    expect((await put('/agent/v1/notifications/preferences', { preferences: { security_alert: false } })).status).toBe(400);
    expect((await put('/agent/v1/notifications/preferences', { preferences: { made_up: false } })).status).toBe(400);
    await put('/agent/v1/notifications/preferences', { preferences: { cash_out_completed: true } });
  });

  it('retries with backoff when the provider is down, then delivers', async () => {
    const tx = await cashOut(6_000);
    h.push.failCalls = 2;
    expect((await h.dispatchPush()).retried).toBe(1);
    expect(await delivery(tx.id)).toMatchObject({ status: 'queued', attempts: 1 });
    expect((await h.dispatchPush()).retried).toBe(0); // not due yet (backoff)
    h.clock.advance(31_000);
    expect((await h.dispatchPush()).retried).toBe(1);
    h.clock.advance(121_000);
    expect((await h.dispatchPush()).sent).toBe(1);
    expect(await delivery(tx.id)).toMatchObject({ status: 'sent', attempts: 3 });
  });

  it('gives up after 5 attempts', async () => {
    const tx = await cashOut(7_000);
    h.push.failCalls = 10;
    for (const wait of [0, 31_000, 121_000, 601_000, 1_801_000]) {
      h.clock.advance(wait);
      await h.dispatchPush();
    }
    expect(await delivery(tx.id)).toMatchObject({ status: 'failed', attempts: 5 });
    h.push.failCalls = 0;
    s = await h.login(phone, PIN, s.device); // the clock moved ~42 min: new access token
  });

  it('forgets tokens the provider no longer knows', async () => {
    h.push.invalidTokens.add(token);
    const tx = await cashOut(8_000);
    await h.dispatchPush();
    expect(await delivery(tx.id)).toMatchObject({ status: 'skipped', last_error: 'all_tokens_invalid' });
    const dev = await h.db.selectFrom('agent.agent_devices').select('push_token').where('id', '=', s.deviceId).executeTakeFirstOrThrow();
    expect(dev.push_token).toBeNull();
    h.push.invalidTokens.clear();
    await post('/agent/v1/push-tokens', { token });
  });

  it('"new device" goes to the other phones, never to the new one', async () => {
    await h.dispatchPush();
    const before = h.push.sent.length;
    const phoneB = newDevice();
    const b = await h.login(phone, PIN, phoneB);
    await h.request('POST', '/agent/v1/push-tokens', { body: { token: 'ExponentPushToken[agent-phone-B-0002]' }, headers: { authorization: `Bearer ${b.accessToken}` } });
    await h.dispatchPush();
    const pushed = h.push.sent.slice(before);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ to: token, title: 'Nuevo dispositivo', channelId: 'security' });
  });

  it('a token moves with the phone, and signing out stops pushes to it', async () => {
    const other = await h.createAgent('+240222000902');
    const o = await h.login('+240222000902');
    await h.request('POST', '/agent/v1/push-tokens', { body: { token }, headers: { authorization: `Bearer ${o.accessToken}` } });
    const mine = await h.db.selectFrom('agent.agent_devices').select('push_token').where('id', '=', s.deviceId).executeTakeFirstOrThrow();
    expect(mine.push_token).toBeNull(); // the shared phone now belongs to the other agent's session
    expect(other.agentCode).toBeTruthy();

    await h.request('POST', '/agent/v1/auth/logout', { headers: { authorization: `Bearer ${o.accessToken}` } });
    const theirs = await h.db.selectFrom('agent.agent_devices').select('push_token').where('id', '=', o.deviceId).executeTakeFirstOrThrow();
    expect(theirs.push_token).toBeNull();
  });

  it('rejects malformed tokens', async () => {
    expect((await post('/agent/v1/push-tokens', { token: 'short' })).status).toBe(400);
    expect((await post('/agent/v1/push-tokens', { token: '<script>alert(1)</script>xxxxxxxxxxxx' })).status).toBe(400);
  });
});
