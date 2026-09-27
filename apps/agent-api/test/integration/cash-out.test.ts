import { randomUUID } from 'node:crypto';
import { LedgerClient, PostTransactionInput } from '../../src/integrations/ledger/ledger.client';
import { Harness, PIN, Session } from '../support/harness';

describe('Cash-out', () => {
  let h: Harness;
  let agent: { id: string; agentCode: string };
  let s: Session;
  let customerRef: string;
  const phone = '+240222000201';
  const customerPhone = '+240555114821';

  beforeAll(async () => {
    h = await Harness.start();
    agent = await h.createAgent(phone, PIN, 1_000_000);
    customerRef = await h.core.addCustomer(customerPhone, 'XAF', 2_000_000);
    s = await h.login(phone);
  });
  afterAll(() => h.stop());

  const body = (withdrawalId: string, amount: number, auth: object = { method: 'pin', pin: PIN }) => ({
    withdrawal_request_id: withdrawalId,
    amount,
    currency: 'XAF',
    agent_auth: auth
  });

  it('resolves a withdrawal code without side effects', async () => {
    const w = await h.core.createWithdrawal(customerRef, 50_000);
    const res = await h.request('POST', '/agent/v1/cash-out/resolve', {
      body: { code: { type: 'code', value: w.code } },
      headers: { authorization: `Bearer ${s.accessToken}` }
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ withdrawal_request_id: w.id, amount: 50_000, currency: 'XAF', customer_masked: '****4821', commission: 500 });
    expect(JSON.stringify(res.body)).not.toContain(customerPhone);
  });

  it('completes: customer −50.000, agent float +50.000, commission +500, hold captured', async () => {
    const before = {
      customer: await h.balance('customer', customerRef, 'customer_wallet'),
      float: await h.balance('agent', agent.agentCode, 'agent_float'),
      commission: await h.balance('agent', agent.agentCode, 'agent_commission_payable')
    };
    const w = await h.core.createWithdrawal(customerRef, 50_000);
    const res = await h.signedPost(s, '/agent/v1/cash-out', body(w.id, 50_000));

    expect(res.status).toBe(201);
    expect(res.body.transaction).toMatchObject({
      reference: expect.stringMatching(/^BTX-\d{8}$/),
      type: 'cash_out',
      status: 'completed',
      amount: 50_000,
      commission: 500,
      customer_masked: '****4821',
      agent_code: agent.agentCode,
      next_action: 'HAND_OVER_CASH'
    });

    const customer = await h.balance('customer', customerRef, 'customer_wallet');
    expect(customer.balance).toBe(before.customer.balance - 50_000);
    expect(customer.held).toBe(before.customer.held); // the withdrawal hold was captured, not left behind
    expect((await h.balance('agent', agent.agentCode, 'agent_float')).balance).toBe(before.float.balance + 50_000);
    expect((await h.balance('agent', agent.agentCode, 'agent_commission_payable')).balance).toBe(before.commission.balance + 500);

    const commission = await h.db.selectFrom('agent.agent_commissions').selectAll().where('transaction_id', '=', res.body.transaction.id).executeTakeFirstOrThrow();
    expect(commission).toMatchObject({ commission_amount: 500, base_amount: 50_000, status: 'accrued' });
    const audit = await h.db.selectFrom('agent.agent_audit_logs').selectAll().where('action', '=', 'CASH_OUT').where('resource_id', '=', res.body.transaction.reference).executeTakeFirstOrThrow();
    expect(audit.result).toBe('success');
    expect(JSON.stringify(audit.metadata)).not.toContain(PIN);
  });

  it('replaying the same request returns the same result and moves no money', async () => {
    const w = await h.core.createWithdrawal(customerRef, 20_000);
    const key = randomUUID();
    const first = await h.signedPost(s, '/agent/v1/cash-out', body(w.id, 20_000), { key });
    const floatAfterFirst = await h.balance('agent', agent.agentCode, 'agent_float');
    const second = await h.signedPost(s, '/agent/v1/cash-out', body(w.id, 20_000), { key });

    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(await h.balance('agent', agent.agentCode, 'agent_float')).toEqual(floatAfterFirst);
    const rows = await h.db.selectFrom('agent.agent_transactions').select('id').where('core_request_ref', '=', w.id).execute();
    expect(rows).toHaveLength(1);
  });

  it('rejects the same key with a different request', async () => {
    const w1 = await h.core.createWithdrawal(customerRef, 10_000);
    const w2 = await h.core.createWithdrawal(customerRef, 11_000);
    const key = randomUUID();
    await h.signedPost(s, '/agent/v1/cash-out', body(w1.id, 10_000), { key });
    const res = await h.signedPost(s, '/agent/v1/cash-out', body(w2.id, 11_000), { key });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('a withdrawal code works only once, even from another agent', async () => {
    const other = await h.createAgent('+240222000202', PIN, 500_000);
    const s2 = await h.login('+240222000202');
    const w = await h.core.createWithdrawal(customerRef, 15_000);
    expect((await h.signedPost(s, '/agent/v1/cash-out', body(w.id, 15_000))).status).toBe(201);
    const second = await h.signedPost(s2, '/agent/v1/cash-out', body(w.id, 15_000));
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('QR_ALREADY_USED');
    expect((await h.balance('agent', other.agentCode, 'agent_float')).balance).toBe(500_000);
  });

  it('two simultaneous requests for the same code: exactly one succeeds', async () => {
    const w = await h.core.createWithdrawal(customerRef, 12_000);
    const results = await Promise.all([h.signedPost(s, '/agent/v1/cash-out', body(w.id, 12_000)), h.signedPost(s, '/agent/v1/cash-out', body(w.id, 12_000))]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).toBe(409);
    const completed = await h.db.selectFrom('agent.agent_transactions').select('id').where('core_request_ref', '=', w.id).where('status', '=', 'completed').execute();
    expect(completed).toHaveLength(1);
  });

  it('the amount cannot be changed by the app', async () => {
    const w = await h.core.createWithdrawal(customerRef, 30_000);
    const res = await h.signedPost(s, '/agent/v1/cash-out', body(w.id, 3_000));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('AMOUNT_MISMATCH');
  });

  it('expired codes are refused', async () => {
    const w = await h.core.createWithdrawal(customerRef, 10_000, 'XAF', 60);
    h.clock.advance(61_000);
    const res = await h.signedPost(s, '/agent/v1/cash-out', body(w.id, 10_000));
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('QR_EXPIRED');
  });

  it('requires a valid device signature', async () => {
    const w = await h.core.createWithdrawal(customerRef, 10_000);
    const tampered = await h.signedPost(s, '/agent/v1/cash-out', body(w.id, 10_000), { tamper: true });
    expect(tampered.status).toBe(401);
    expect(tampered.body.error.code).toBe('SIGNATURE_INVALID');

    const old = await h.signedPost(s, '/agent/v1/cash-out', body(w.id, 10_000), { timestamp: h.clock.now().getTime() - 5 * 60_000 });
    expect(old.status).toBe(401);

    const unsigned = await h.request('POST', '/agent/v1/cash-out', { body: body(w.id, 10_000), headers: { authorization: `Bearer ${s.accessToken}`, 'idempotency-key': randomUUID() } });
    expect(unsigned.status).toBe(401);
  });

  it('requires the agent PIN (or biometrics) for each operation', async () => {
    const w = await h.core.createWithdrawal(customerRef, 10_000);
    const wrong = await h.signedPost(s, '/agent/v1/cash-out', body(w.id, 10_000, { method: 'pin', pin: '999111' }));
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toMatchObject({ code: 'PIN_INVALID', details: { attempts_left: 4 } });

    const key = randomUUID();
    const ts = h.clock.now().getTime();
    const bio = await h.signedPost(s, '/agent/v1/cash-out', body(w.id, 10_000, { method: 'biometric', signature: h.biometricSignature(s, '/agent/v1/cash-out', key, ts) }), { key, timestamp: ts });
    expect(bio.status).toBe(201);
  });

  it('enforces limits (reduced during the new-device cooldown)', async () => {
    const w = await h.core.createWithdrawal(customerRef, 130_000);
    const res = await h.signedPost(s, '/agent/v1/cash-out', body(w.id, 130_000));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('LIMIT_PER_TX_EXCEEDED');
    expect(res.body.error.details.max).toBe(125_000); // 25% of 500.000 during cooldown

    h.clock.advance(25 * 3600 * 1000); // cooldown over
    const s2 = await h.login(phone, PIN, s.device); // same device: plain login
    const fresh = await h.core.createWithdrawal(customerRef, 130_000); // the first code expired meanwhile
    const ok = await h.signedPost(s2, '/agent/v1/cash-out', body(fresh.id, 130_000));
    expect(ok.status).toBe(201);
    s = s2;
  });

  it('shows limits and usage', async () => {
    const res = await h.get(s, '/agent/v1/limits');
    const cashOut = res.body.limits.find((l: any) => l.operation_type === 'cash_out');
    expect(cashOut.per_transaction.max).toBe(500_000);
    expect(cashOut.daily.used).toBeGreaterThan(0);
  });

  it('a suspended agent cannot operate', async () => {
    await h.db.updateTable('agent.agents').set({ status: 'suspended', status_reason: 'test' }).where('id', '=', agent.id).execute();
    const w = await h.core.createWithdrawal(customerRef, 10_000);
    const res = await h.signedPost(s, '/agent/v1/cash-out', body(w.id, 10_000));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
    await h.db.updateTable('agent.agents').set({ status: 'active' }).where('id', '=', agent.id).execute();
  });
});

describe('Cash-out when the ledger response is lost', () => {
  let h: Harness;
  let dropNextResponse = false;

  /** Posts for real, then pretends the network failed: the classic "did it happen?" case. */
  class LossyLedger extends LedgerClient {
    constructor(private readonly real: LedgerClient) {
      super();
    }
    get sourceSystem() {
      return this.real.sourceSystem;
    }
    openAccount(...a: Parameters<LedgerClient['openAccount']>) {
      return this.real.openAccount(...a);
    }
    createHold(...a: Parameters<LedgerClient['createHold']>) {
      return this.real.createHold(...a);
    }
    closeHold(...a: Parameters<LedgerClient['closeHold']>) {
      return this.real.closeHold(...a);
    }
    findTransaction(key: string) {
      return this.real.findTransaction(key);
    }
    getBalance(...a: Parameters<LedgerClient['getBalance']>) {
      return this.real.getBalance(...a);
    }
    close() {
      return this.real.close();
    }
    async post(input: PostTransactionInput) {
      const result = await this.real.post(input);
      if (dropNextResponse && input.kind === 'cash_out') {
        dropNextResponse = false;
        throw new Error('ECONNRESET');
      }
      return result;
    }
  }

  beforeAll(async () => {
    h = await Harness.start({ wrapLedger: (real) => new LossyLedger(real) });
  });
  afterAll(() => h.stop());

  it('answers "processing", then the reconciler completes it without moving money twice', async () => {
    const agent = await h.createAgent('+240222000301', PIN, 1_000_000);
    const customerRef = await h.core.addCustomer('+240555000301', 'XAF', 100_000);
    const s = await h.login('+240222000301');
    const w = await h.core.createWithdrawal(customerRef, 40_000);

    dropNextResponse = true;
    const res = await h.signedPost(s, '/agent/v1/cash-out', { withdrawal_request_id: w.id, amount: 40_000, currency: 'XAF', agent_auth: { method: 'pin', pin: PIN } });
    expect(res.status).toBe(202);
    expect(res.body.transaction).toMatchObject({ status: 'processing', next_action: 'WAIT_DO_NOT_HAND_OVER_CASH' });

    // The money actually moved once already.
    expect((await h.balance('customer', customerRef, 'customer_wallet')).balance).toBe(60_000);

    h.clock.advance(31_000);
    const { ReconcilerService } = await import('../../src/modules/operations/reconciler.service');
    const summary = await h.app.get(ReconcilerService).run();
    expect(summary).toMatchObject({ checked: 1, completed: 1 });

    const detail = await h.get(s, `/agent/v1/transactions/${res.body.transaction.id}`);
    expect(detail.body.transaction.status).toBe('completed');
    expect((await h.balance('customer', customerRef, 'customer_wallet')).balance).toBe(60_000); // still once
    expect((await h.balance('agent', agent.agentCode, 'agent_float')).balance).toBe(1_040_000);
  });
});
