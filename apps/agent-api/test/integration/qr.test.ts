import { Harness, PIN, Session } from '../support/harness';

describe('QR: collect, static QR, unified scan and payment from Core', () => {
  let h: Harness;
  let agent: { id: string; agentCode: string };
  let s: Session;
  const phone = '+240222000501';
  let customerRef: string;
  const customerPhone = '+240555007777';

  beforeAll(async () => {
    h = await Harness.start();
    agent = await h.createAgent(phone, PIN, 100_000);
    customerRef = await h.core.addCustomer(customerPhone, 'XAF', 200_000);
    s = await h.login(phone);
    h.clock.advance(25 * 3600 * 1000); // past the new-device cooldown
    s = await h.login(phone, PIN, s.device);
  });
  afterAll(() => h.stop());

  const collect = (amount: number, key?: string) => h.signedPost(s, '/agent/v1/qr/create', { kind: 'collect', amount, currency: 'XAF' }, { key });
  const coreResolve = (payload: string) => h.coreRequest('/internal/v1/qr/resolve', { payload });

  /** What BataPay Core does when the customer approves the payment with their PIN. */
  const pay = async (qr: { qr_id: string; amount: number }, opts: { ref?: string; amount?: number; paymentRequestId?: string } = {}) => {
    const ref = opts.ref ?? customerRef;
    const payment = opts.paymentRequestId
      ? { paymentRequestId: opts.paymentRequestId, masked: '****7777' }
      : await h.core.authorizeQrPayment(ref, opts.amount ?? qr.amount);
    const res = await h.coreEvent({
      type: 'qr_payment.authorized',
      payment_request_id: payment.paymentRequestId,
      qr_id: qr.qr_id,
      customer_ref: ref,
      customer_masked: payment.masked,
      amount: opts.amount ?? qr.amount,
      currency: 'XAF'
    });
    return { res, paymentRequestId: payment.paymentRequestId };
  };

  it('creates a signed, single-use collect QR and a pending "Pago QR" with limits reserved', async () => {
    const res = await collect(25_000);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'collect', status: 'active', amount: 25_000, currency: 'XAF', single_use: true });
    expect(res.body.payload).toMatch(/^BSV1\.K\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{86}$/);
    expect(res.body.payload).not.toContain('25000'); // the QR never carries the amount
    expect(res.body.transaction).toMatchObject({ type: 'qr_payment', status: 'pending', amount: 25_000, next_action: 'WAIT_CUSTOMER_PAYMENT', customer_masked: null });

    const limits = await h.get(s, '/agent/v1/limits');
    const qrLimit = limits.body.limits.find((l: any) => l.operation_type === 'qr_payment');
    expect(qrLimit.daily.used).toBe(25_000);
  });

  it('Core resolves the QR for the customer, then the payment moves money: customer −25.000, float +25.000', async () => {
    const created = (await collect(25_000)).body;
    const resolved = await coreResolve(created.payload);
    expect(resolved.status).toBe(200);
    expect(resolved.body).toMatchObject({ qr_id: created.qr_id, kind: 'collect', agent_code: agent.agentCode, amount: 25_000, currency: 'XAF' });

    const floatBefore = (await h.balance('agent', agent.agentCode, 'agent_float')).balance;
    const customerBefore = (await h.balance('customer', customerRef, 'customer_wallet')).balance;
    const { res, paymentRequestId } = await pay(created);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ result: 'completed', transaction_reference: created.transaction.reference });

    expect((await h.balance('agent', agent.agentCode, 'agent_float')).balance).toBe(floatBefore + 25_000);
    expect(await h.balance('customer', customerRef, 'customer_wallet')).toEqual({ balance: customerBefore - 25_000, held: 0, available: customerBefore - 25_000 });
    expect(h.core.qrPayments.get(paymentRequestId)?.status).toBe('completed');

    // The agent's screen turns into "Pagado ✔".
    const status = await h.get(s, `/agent/v1/qr/${created.qr_id}`);
    expect(status.body).toMatchObject({ status: 'used', transaction: { status: 'completed', customer_masked: '****7777', next_action: 'PAYMENT_RECEIVED' } });

    // Core may deliver the event twice: nothing moves again.
    const again = await h.coreEvent({ type: 'qr_payment.authorized', payment_request_id: paymentRequestId, qr_id: created.qr_id, customer_ref: customerRef, customer_masked: '****7777', amount: 25_000, currency: 'XAF' });
    expect(again.body.result).toBe('completed');
    expect((await h.balance('agent', agent.agentCode, 'agent_float')).balance).toBe(floatBefore + 25_000);

    const list = await h.get(s, '/agent/v1/transactions?period=today&type=qr_payment');
    expect(list.body.totals.qr_payment).toBe(25_000);
    const notif = await h.db.selectFrom('agent.agent_notifications').select('type').where('related_transaction_id', '=', created.transaction.id).executeTakeFirst();
    expect(notif?.type).toBe('qr_payment_completed');
  });

  it('a collect QR is single use: a second payment is rejected and the customer is not charged', async () => {
    const created = (await collect(10_000)).body;
    expect((await pay(created)).res.body.result).toBe('completed');

    const otherRef = await h.core.addCustomer('+240555008888', 'XAF', 50_000);
    const second = await pay(created, { ref: otherRef });
    expect(second.res.body).toEqual({ result: 'rejected', reason: 'QR_ALREADY_USED' });
    expect((await coreResolve(created.payload)).body.error.code).toBe('QR_ALREADY_USED');
    // Core releases the second customer's hold when it is rejected (its side of the contract).
    await h.core.settleQrPayment(second.paymentRequestId, 'failed');
    expect(await h.balance('customer', otherRef, 'customer_wallet')).toEqual({ balance: 50_000, held: 0, available: 50_000 });
  });

  it('refuses a payment for a different amount', async () => {
    const created = (await collect(8_000)).body;
    const res = await pay(created, { amount: 800 });
    expect(res.res.body).toEqual({ result: 'rejected', reason: 'AMOUNT_MISMATCH' });
    expect((await h.get(s, `/agent/v1/qr/${created.qr_id}`)).body.status).toBe('active');
  });

  it('expires: the QR dies, the operation is cancelled, limits come back and a late payment is rejected', async () => {
    const created = (await collect(12_000)).body;
    const usedBefore = (await h.get(s, '/agent/v1/limits')).body.limits.find((l: any) => l.operation_type === 'qr_payment').daily.used;
    h.clock.advance(6 * 60 * 1000);
    expect((await h.get(s, `/agent/v1/qr/${created.qr_id}`)).body.status).toBe('expired');
    expect((await coreResolve(created.payload)).body.error.code).toBe('QR_EXPIRED');

    const late = await pay(created);
    expect(late.res.body).toEqual({ result: 'rejected', reason: 'QR_EXPIRED' });
    const tx = await h.get(s, `/agent/v1/transactions/${created.transaction.id}`);
    expect(tx.body.transaction).toMatchObject({ status: 'cancelled', status_reason: 'expired' });
    const usedAfter = (await h.get(s, '/agent/v1/limits')).body.limits.find((l: any) => l.operation_type === 'qr_payment').daily.used;
    expect(usedAfter).toBe(usedBefore - 12_000);
    const row = await h.db.selectFrom('agent.agent_qr').select('status').where('id', '=', created.qr_id).executeTakeFirstOrThrow();
    expect(row.status).toBe('expired');
  });

  it('the agent can cancel an unpaid QR', async () => {
    const created = (await collect(5_000)).body;
    const cancel = await h.request('POST', `/agent/v1/transactions/${created.transaction.id}/cancel`, { headers: { authorization: `Bearer ${s.accessToken}` } });
    expect(cancel.status).toBe(200);
    expect(cancel.body.transaction.status).toBe('cancelled');
    expect((await h.get(s, `/agent/v1/qr/${created.qr_id}`)).body.status).toBe('revoked');
    expect((await pay(created)).res.body.result).toBe('rejected');
  });

  it('customer without enough money: the payment fails and the QR cannot be reused', async () => {
    const created = (await collect(30_000)).body;
    const poorRef = await h.core.addCustomer('+240555009999', 'XAF', 0);
    // Core would normally refuse to create the hold; simulate a request that reaches us anyway.
    const res = await pay(created, { ref: poorRef, paymentRequestId: 'pay_without_hold_0001' });
    expect(res.res.body.result).toBe('rejected');
    const tx = await h.get(s, `/agent/v1/transactions/${created.transaction.id}`);
    expect(tx.body.transaction.status).toBe('failed');
    expect((await h.get(s, `/agent/v1/qr/${created.qr_id}`)).body.status).toBe('revoked');
  });

  it('retrying POST /qr/create with the same key returns the same QR', async () => {
    const key = '5a0d9f5e-7b8c-4c1d-9e2f-0123456789ab';
    const a = await collect(7_000, key);
    const b = await collect(7_000, key);
    expect(b.status).toBe(201);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body.qr_id).toBe(a.body.qr_id);
  });

  it('respects limits when creating a collect QR', async () => {
    const res = await collect(600_000);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('LIMIT_PER_TX_EXCEEDED');
  });

  it('rejects forged or tampered QR codes', async () => {
    const created = (await collect(9_000)).body;
    const [p, t, id, sig] = created.payload.split('.');
    const flipped = `${p}.${t}.${id}.${sig.slice(0, -2)}${sig.endsWith('AA') ? 'BB' : 'AA'}`;
    expect((await coreResolve(flipped)).body.error.code).toBe('QR_INVALID');
    expect((await coreResolve(`${p}.${t}.${id}`)).body.error.code).toBe('QR_INVALID');
    expect((await coreResolve('hello-world')).body.error.code).toBe('QR_INVALID');
    const unsigned = await h.request('POST', '/internal/v1/qr/resolve', { body: { payload: created.payload } });
    expect(unsigned.status).toBe(401);
  });

  it('static agent QR: created once, identifies the agent, never has an amount', async () => {
    const a = await h.signedPost(s, '/agent/v1/qr/create', { kind: 'agent_static' });
    const b = await h.signedPost(s, '/agent/v1/qr/create', { kind: 'agent_static' });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ kind: 'agent_static', status: 'active', amount: null, expires_at: null });
    expect(a.body.payload).toMatch(/^BSV1\.A\./);
    expect(b.body.qr_id).toBe(a.body.qr_id);
    const resolved = await coreResolve(a.body.payload);
    expect(resolved.body).toMatchObject({ kind: 'agent_static', agent_code: agent.agentCode, amount: null });
    // A static QR can't be "paid" as a collect QR.
    expect((await pay({ qr_id: a.body.qr_id, amount: 1_000 })).res.body).toEqual({ result: 'rejected', reason: 'QR_INVALID' });
  });

  describe('unified scan', () => {
    const scan = (payload: string) => h.request('POST', '/agent/v1/qr/scan', { body: { payload }, headers: { authorization: `Bearer ${s.accessToken}` } });

    it('withdrawal QR -> cash-out preview', async () => {
      const w = await h.core.createWithdrawal(customerRef, 20_000);
      const res = await scan(w.qr);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ action: 'cash_out', withdrawal: { withdrawal_request_id: w.id, amount: 20_000, customer_masked: '****7777' } });
    });

    it('customer QR -> cash-in with a single-use customer token', async () => {
      const res = await scan(h.core.issueCustomerQr(customerRef));
      expect(res.body).toMatchObject({ action: 'cash_in', customer: { customer_masked: '****7777' } });
      const token = res.body.customer.customer_token;
      const cashIn = await h.signedPost(s, '/agent/v1/cash-in', { customer: { type: 'token', value: token }, amount: 5_000, currency: 'XAF', agent_auth: { method: 'pin', pin: PIN } });
      expect(cashIn.status).toBe(201);
      expect(cashIn.body.transaction).toMatchObject({ customer_masked: '****7777', method: 'qr' });
    });

    it('agent QRs and unknown codes are not recognised', async () => {
      const created = (await collect(4_000)).body;
      expect((await scan(created.payload)).body.error.code).toBe('QR_INVALID');
      expect((await scan('https://example.com/whatever')).body.error.code).toBe('QR_INVALID');
      expect((await scan('BSV1.C.unknownunknown')).body.error.code).toBe('QR_INVALID');
      const audit = await h.db.selectFrom('agent.agent_audit_logs').select(['result']).where('action', '=', 'QR_SCANNED').where('agent_id', '=', agent.id).execute();
      expect(audit.length).toBeGreaterThanOrEqual(3);
    });
  });
});
