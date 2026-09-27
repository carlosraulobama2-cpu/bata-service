import { Harness, newDevice, PIN, Session } from '../support/harness';

describe('Disconnecting a device', () => {
  let h: Harness;
  let a: Session; // phone A (this device)
  let b: Session; // phone B (the one to disconnect)
  const phone = '+240222000701';

  beforeAll(async () => {
    h = await Harness.start({ env: { MAX_TRUSTED_DEVICES: '2' } });
    await h.createAgent(phone);
    a = await h.login(phone);
    b = await h.login(phone, PIN, newDevice());
  });
  afterAll(() => h.stop());

  const revoke = (s: Session, deviceId: string, pin = PIN) =>
    h.signedPost(s, `/agent/v1/security/devices/${deviceId}`, { agent_auth: { method: 'pin', pin } }, { method: 'DELETE' });

  it('both devices are trusted and listed', async () => {
    const list = await h.get(a, '/agent/v1/security/devices');
    expect(list.body.data.filter((d: any) => d.status === 'trusted')).toHaveLength(2);
  });

  it('refuses the current device, a wrong PIN, an unsigned request and unknown ids', async () => {
    expect((await revoke(a, a.deviceId)).body.error.code).toBe('DEVICE_IS_CURRENT');
    expect((await revoke(a, b.deviceId, '000111')).body.error.code).toBe('PIN_INVALID');
    const unsigned = await h.request('DELETE', `/agent/v1/security/devices/${b.deviceId}`, { body: { agent_auth: { method: 'pin', pin: PIN } }, headers: { authorization: `Bearer ${a.accessToken}` } });
    expect(unsigned.status).toBe(401);
    expect((await revoke(a, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await h.get(b, '/agent/v1/me')).status).toBe(200);
  });

  it('disconnects the other device immediately', async () => {
    await h.db.updateTable('agent.agent_devices').set({ push_token: 'ExponentPushToken[device-b]' }).where('id', '=', b.deviceId).execute();
    const res = await revoke(a, b.deviceId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ revoked: true, sessions_revoked: 1 });

    const me = await h.get(b, '/agent/v1/me');
    expect(me.status).toBe(401);
    const refresh = await h.request('POST', '/agent/v1/auth/refresh', { body: { refresh_token: b.refreshToken } });
    expect(refresh.status).toBe(401);

    const row = await h.db.selectFrom('agent.agent_devices').select(['status', 'push_token', 'revoked_by']).where('id', '=', b.deviceId).executeTakeFirstOrThrow();
    expect(row).toEqual({ status: 'revoked', push_token: null, revoked_by: 'agent' });
    expect((await h.get(a, '/agent/v1/me')).status).toBe(200);

    const history = await h.get(a, '/agent/v1/security/access-history');
    expect(history.body.data[0].event).toBe('device_revoked');
    // Twice: nothing to revoke any more.
    expect((await revoke(a, b.deviceId)).status).toBe(404);
  });

  it('coming back from that phone needs PIN + SMS code again', async () => {
    const again = await h.request('POST', '/agent/v1/auth/login', { body: { phone, pin: PIN, device: { installation_id: b.device.installationId, platform: 'android' } } });
    expect(again.body.status).toBe('otp_required');
  });

  it('another agent cannot disconnect my devices', async () => {
    await h.createAgent('+240222000702');
    const other = await h.login('+240222000702');
    expect((await revoke(other, a.deviceId)).status).toBe(404);
  });
});
