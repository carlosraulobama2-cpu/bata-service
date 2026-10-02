/**
 * @jest-environment node
 *
 * The app's API layer (api/endpoints.ts) against a running Velynt stack: the customer API
 * (VELYNT_API_URL, e.g. http://localhost:8000) to play the customer, and the agents API
 * (EXPO_PUBLIC_API_BASE_URL, e.g. http://localhost:8001) as the app sees it. Uses the development
 * seed (agente@equatoriana.app / demo1234, PIN 1357). Skipped when VELYNT_API_URL is not set.
 *
 *   VELYNT_API_URL=http://localhost:8000 EXPO_PUBLIC_API_BASE_URL=http://localhost:8001 pnpm test agents-api
 */
const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0,
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
  canUseBiometricAuthentication: () => false
}));
jest.mock('expo-local-authentication', () => ({ hasHardwareAsync: async () => false, isEnrolledAsync: async () => false }));
jest.mock('expo-crypto', () => ({ randomUUID: () => require('node:crypto').randomUUID() }));
jest.mock('expo-notifications', () => ({}));
jest.mock('expo-constants', () => ({ expoConfig: {} }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

import { signIn, signOut } from '../api/auth';
import { ApiError, newIdempotencyKey } from '../api/client';
import { endpoints } from '../api/endpoints';
import { useSession } from '../state/session';

/** jest-expo replaces fetch with a stub: talk HTTP for real (only what api/client.ts uses). */
function nodeFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
  const http = require('node:http') as typeof import('node:http');
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: init.method ?? 'GET', headers: init.headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (text += chunk));
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        resolve({
          ok: status >= 200 && status < 300,
          status,
          headers: { get: (name: string) => (res.headers[name.toLowerCase()] as string | undefined) ?? null },
          text: async () => text,
          json: async () => JSON.parse(text)
        } as unknown as Response);
      });
    });
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}
globalThis.fetch = nodeFetch as unknown as typeof fetch;

const CUSTOMER_API = process.env.VELYNT_API_URL;
const run = CUSTOMER_API ? describe : describe.skip;
const PIN = { method: 'pin' as const, pin: '1357' };

/** A customer of the Velynt app: registered, phone verified, payment PIN 1357. */
async function newCustomer() {
  const post = async (path: string, body: unknown, token?: string, pin?: string) => {
    const res = await fetch(`${CUSTOMER_API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(pin ? { 'X-Transaction-PIN': pin } : {}) },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(data)}`);
    return data;
  };
  const email = `agentapp_${Date.now()}_${Math.floor(Math.random() * 1e6)}@equatoriana.app`;
  const { token } = await post('/api/auth/register', { email, password: 'testpass123', name: 'María Nsue Obiang', accept_terms: true });
  const phone = `+240555${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
  const started = await post('/api/auth/phone/start', { phone_number: phone }, token);
  await post('/api/auth/phone/verify', { phone_number: phone, code: started.dev_code }, token);
  await post('/api/auth/pin', { password: 'testpass123', pin: '1357' }, token);
  await post('/api/regions/accept-terms', { region_code: 'US' }, token);
  return { token, phone, post: (path: string, body: unknown) => post(path, body, token, '1357') };
}

run('the agents app against api-agente', () => {
  jest.setTimeout(60_000);

  beforeAll(async () => {
    await signIn('agente@equatoriana.app', 'demo1234');
  });
  afterAll(async () => {
    await signOut();
  });

  it('signs in and reads the agent, float and limits', async () => {
    expect(useSession.getState().status).toBe('signedIn');
    const me = await endpoints.me();
    expect(me.agent?.status).toBe('active');
    expect(me.agent?.code).toMatch(/^AG-\d{6}$/);
    expect(me.user.has_pin).toBe(true);
    expect(me.float).toBeGreaterThan(0);
    const limits = await endpoints.limits();
    expect(limits.limits.map((l) => l.operation_type)).toEqual(['cash_in', 'cash_out']);
  });

  it('deposits by phone after confirming the name, once even if retried', async () => {
    const customer = await newCustomer();
    const found = await endpoints.lookupCustomer({ phone: customer.phone });
    expect(found.name).toBe('María N. O.');
    const before = (await endpoints.me()).float;
    const key = newIdempotencyKey();
    const prompt = 'x';
    const { transaction } = await endpoints.cashIn({ customer: { phone: customer.phone }, amount: 20_000, key, stepUp: PIN, prompt });
    expect(transaction).toMatchObject({ type: 'cash_in', status: 'completed', amount: 20_000 });
    expect(transaction.customer_masked).toContain('María N. O.');
    // Network retry with the same key: the same operation, no second deposit
    const again = await endpoints.cashIn({ customer: { phone: customer.phone }, amount: 20_000, key, stepUp: PIN, prompt });
    expect(again.transaction.id).toBe(transaction.id);
    expect((await endpoints.me()).float).toBe(before - 20_000 + transaction.commission);
    expect((await endpoints.transaction(transaction.id)).transaction).toEqual(transaction);

    const today = await endpoints.transactions({ period: 'today', type: 'cash_in', limit: 100 });
    expect(today.data.map((t) => t.id)).toContain(transaction.id);
    expect(today.totals.cash_in.volume).toBeGreaterThanOrEqual(20_000);
    expect(today.totals.cash_out.count).toBe(0);
  });

  it('deposits from the customer top-up QR', async () => {
    const customer = await newCustomer();
    const created = await customer.post('/api/topups', { amount_minor: 15_000 });
    const preview = await endpoints.resolveTopup(JSON.stringify(created.qr_payload));
    expect(preview.amount).toBe(15_000);
    const { transaction } = await endpoints.completeTopup({ topupId: preview.topup_id, key: newIdempotencyKey(), stepUp: PIN, prompt: 'x' });
    expect(transaction.amount).toBe(15_000);
  });

  it('pays a withdrawal by QR and by phone + code; a wrong PIN says how many tries are left', async () => {
    const customer = await newCustomer();
    await endpoints.cashIn({ customer: { phone: customer.phone }, amount: 80_000, key: newIdempotencyKey(), stepUp: PIN, prompt: 'x' });

    const byQr = await customer.post('/api/cashouts', { amount_minor: 30_000 });
    const preview = await endpoints.resolveWithdrawal({ qr: JSON.stringify(byQr.qr_payload) });
    expect(preview).toMatchObject({ amount: 30_000, code: byQr.code });
    const wrong = await endpoints.cashOut({ cashoutId: preview.cashout_id, code: preview.code, key: newIdempotencyKey(), stepUp: { method: 'pin', pin: '9999' }, prompt: 'x' }).catch((e) => e);
    expect(wrong).toBeInstanceOf(ApiError);
    expect(wrong.code).toBe('wrong_pin');
    expect(wrong.details.attempts_left).toBeGreaterThan(0);
    const paid = await endpoints.cashOut({ cashoutId: preview.cashout_id, code: preview.code, key: newIdempotencyKey(), stepUp: PIN, prompt: 'x' });
    expect(paid.transaction).toMatchObject({ type: 'cash_out', amount: 30_000 });

    const byCode = await customer.post('/api/cashouts', { amount_minor: 10_000 });
    const typed = await endpoints.resolveWithdrawal({ phone: customer.phone, code: byCode.code });
    expect(typed.cashout_id).toBe(byCode.cashout.id);
    const notFound = await endpoints.resolveWithdrawal({ phone: customer.phone, code: byCode.code === '000000' ? '111111' : '000000' }).catch((e) => e);
    expect(notFound.code).toBe('cashout_not_found');
  });

  it('commissions, notifications and unlock', async () => {
    const summary = await endpoints.commissionSummary();
    expect(summary.this_month).toBeGreaterThanOrEqual(summary.today);
    expect(summary.by_type_this_month.length).toBeGreaterThan(0);
    const inbox = await endpoints.notifications();
    expect(inbox.unread_count).toBe((await endpoints.unreadCount()).unread_count);
    await endpoints.readAllNotifications();
    expect((await endpoints.unreadCount()).unread_count).toBe(0);
    await expect(endpoints.unlock({ stepUp: PIN, prompt: 'x' })).resolves.toEqual({ ok: true });
  });

  it('reads the reinforced verification; an approved agent cannot change it', async () => {
    const onboarding = await endpoints.onboarding();
    expect(onboarding.rules_version).toMatch(/^\d{4}-\d{2}$/);
    expect(onboarding.requirements.find((r) => r.code === 'identity')?.status).toBe('done');
    expect(onboarding.documents.some((d) => d.kind === 'police_record' && d.required)).toBe(true);
    const closed = await endpoints
      .saveBusinessProfile({
        legal_form: 'individual', license_number: 'LIC-1', activity: 'shop', years_in_business: 1, opening_hours: '8-20',
        alt_phone_number: '', expected_daily_volume_minor: 100_000, float_source: 'Ahorros de la tienda', is_pep: false, pep_details: '',
        no_criminal_record: true, accept_rules_version: onboarding.rules_version
      })
      .catch((e) => e);
    expect(closed.code).toBe('verification_closed');
  });

  it('float requests, cash count, movements, customers, nearby agents, stats and settings', async () => {
    const before = await endpoints.floatRequests();
    for (const r of before.requests.filter((x) => x.status === 'pending')) await endpoints.cancelFloatRequest(r.id);
    const asked = await endpoints.requestFloat({ amount: 1_000, reason: 'Prueba de la app', payment_reference: 'APP-1' });
    expect(asked.code).toMatch(/^SOL-/);
    const twice = await endpoints.requestFloat({ amount: 1_000, reason: 'Otra', payment_reference: '' }).catch((e) => e);
    expect(twice.code).toBe('float_request_pending');
    expect((await endpoints.cancelFloatRequest(asked.id)).status).toBe('cancelled');

    const counted = await endpoints.countCash(650_000, 'Prueba');
    expect(counted.position.declared).toBe(650_000);
    expect((await endpoints.me()).cash?.declared).toBe(650_000);

    expect(Array.isArray(await endpoints.floatMovements())).toBe(true);
    const served = await endpoints.customers();
    expect(served.customers.length).toBeGreaterThan(0);
    expect(served.customers[0]!.phone_number).toContain('*');
    expect(Array.isArray(await endpoints.nearbyAgents())).toBe(true);
    expect((await endpoints.stats(7)).length).toBe(7);

    const missing = await endpoints.lookupAgent('AG-999999').catch((e) => e);
    expect(missing.code).toBe('agent_not_found');
    const saved = await endpoints.savePreferences({ theme: 'dark', hide_balance: false });
    expect(saved.theme).toBe('dark');
    await endpoints.savePreferences({ theme: 'system' });
  });

  it('an unknown customer and an expired session have their own codes', async () => {
    const missing = await endpoints.lookupCustomer({ customerId: 'BP-999999999' }).catch((e) => e);
    expect(missing.code).toBe('customer_not_found');
    // A rejected access token: the client refreshes it once with the stored refresh token and repeats.
    useSession.getState().setAccessToken('not-a-token');
    await expect(endpoints.me()).resolves.toBeTruthy();
    expect(useSession.getState().status).toBe('signedIn');
  });
});
