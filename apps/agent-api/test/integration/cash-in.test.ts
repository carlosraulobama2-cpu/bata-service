import { Harness, PIN, Session } from '../support/harness';

describe('Cash-in', () => {
  let h: Harness;
  let agent: { id: string; agentCode: string };
  let s: Session;
  let customerRef: string;
  const phone = '+240222000401';
  const customerPhone = '+240555004821';

  beforeAll(async () => {
    h = await Harness.start();
    agent = await h.createAgent(phone, PIN, 300_000);
    customerRef = await h.core.addCustomer(customerPhone, 'XAF', 0, { fullName: 'Juan Pablo Mba Nsue' });
    s = await h.login(phone);
    h.clock.advance(25 * 3600 * 1000); // past the new-device cooldown
    s = await h.login(phone, PIN, s.device);
  });
  afterAll(() => h.stop());

  const verify = (fullName = 'Juan Mba', phone = customerPhone) =>
    h.request('POST', '/agent/v1/customers/verify', { body: { phone, full_name: fullName }, headers: { authorization: `Bearer ${s.accessToken}` } });

  /** Like the app: verify name + phone first, then create the deposit with the returned token. */
  const create = async (amount: number) => {
    const v = await verify();
    if (v.status !== 200) return v;
    return h.signedPost(s, '/agent/v1/cash-in', { customer: { type: 'token', value: v.body.customer.token }, amount, currency: 'XAF', agent_auth: { method: 'pin', pin: PIN } });
  };

  const confirm = (tx: { id: string }) =>
    h.db
      .selectFrom('agent.agent_transactions')
      .select('core_request_ref')
      .where('id', '=', tx.id)
      .executeTakeFirstOrThrow()
      .then((r) => h.coreEvent({ type: 'deposit_request.confirmed', deposit_request_id: r.core_request_ref, agent_transaction_id: tx.id }));

  it('reserves float, waits for the customer, then posts: customer +100.000, float −100.000', async () => {
    const res = await create(100_000);
    expect(res.status).toBe(201);
    expect(res.body.transaction).toMatchObject({ type: 'cash_in', status: 'pending', amount: 100_000, commission: 500, customer_masked: '****4821', next_action: 'WAIT_CUSTOMER_CONFIRMATION' });

    const reserved = await h.balance('agent', agent.agentCode, 'agent_float');
    expect(reserved).toEqual({ balance: 300_000, held: 100_000, available: 200_000 });
    expect((await h.balance('customer', customerRef, 'customer_wallet')).balance).toBe(0);

    const event = await confirm(res.body.transaction);
    expect(event.status).toBe(200);
    expect(event.body.result).toBe('completed');

    expect(await h.balance('agent', agent.agentCode, 'agent_float')).toEqual({ balance: 200_000, held: 0, available: 200_000 });
    expect((await h.balance('customer', customerRef, 'customer_wallet')).balance).toBe(100_000);
    expect((await h.balance('agent', agent.agentCode, 'agent_commission_payable')).balance).toBe(500);

    const detail = await h.get(s, `/agent/v1/transactions/${res.body.transaction.id}`);
    expect(detail.body.transaction.status).toBe('completed');
    expect(detail.body.transaction.events.map((e: any) => e.status)).toEqual(['pending', 'processing', 'completed']);

    // Core may deliver the event twice: nothing moves again.
    const again = await confirm(res.body.transaction);
    expect(again.body.result).toBe('completed');
    expect((await h.balance('customer', customerRef, 'customer_wallet')).balance).toBe(100_000);
  });

  it('refuses when the float is not enough, without leaving holds', async () => {
    const res = await create(250_000);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_FLOAT');
    expect(await h.balance('agent', agent.agentCode, 'agent_float')).toEqual({ balance: 200_000, held: 0, available: 200_000 });
  });

  it('customer rejects: operation fails and the float is released', async () => {
    const res = await create(20_000);
    const { core_request_ref } = await h.db.selectFrom('agent.agent_transactions').select('core_request_ref').where('id', '=', res.body.transaction.id).executeTakeFirstOrThrow();
    const ev = await h.coreEvent({ type: 'deposit_request.rejected', deposit_request_id: core_request_ref, agent_transaction_id: res.body.transaction.id });
    expect(ev.body.result).toBe('failed');
    expect((await h.balance('agent', agent.agentCode, 'agent_float')).held).toBe(0);
    const tx = await h.get(s, `/agent/v1/transactions/${res.body.transaction.id}`);
    expect(tx.body.transaction).toMatchObject({ status: 'failed', status_reason: 'customer_rejected' });
  });

  it('agent cancels before confirmation', async () => {
    const res = await create(15_000);
    const cancel = await h.request('POST', `/agent/v1/transactions/${res.body.transaction.id}/cancel`, { headers: { authorization: `Bearer ${s.accessToken}` } });
    expect(cancel.status).toBe(200);
    expect(cancel.body.transaction.status).toBe('cancelled');
    expect((await h.balance('agent', agent.agentCode, 'agent_float')).held).toBe(0);

    // A late confirmation does nothing.
    const late = await confirm(res.body.transaction);
    expect(late.body.result).toBe('ignored');
    expect((await h.balance('customer', customerRef, 'customer_wallet')).balance).toBe(100_000);
  });

  it('expires when the customer does not confirm in time', async () => {
    const res = await create(10_000);
    h.clock.advance(181_000);
    const { CashInService } = await import('../../src/modules/operations/cash-in.service');
    expect(await h.app.get(CashInService).expirePending()).toBe(1);
    const tx = await h.get(s, `/agent/v1/transactions/${res.body.transaction.id}`);
    expect(tx.body.transaction).toMatchObject({ status: 'cancelled', status_reason: 'expired' });
    expect((await h.balance('agent', agent.agentCode, 'agent_float')).held).toBe(0);
  });

  it('gives back limit usage for failed or cancelled operations', async () => {
    const limits = await h.get(s, '/agent/v1/limits');
    const cashIn = limits.body.limits.find((l: any) => l.operation_type === 'cash_in');
    expect(cashIn.daily.used).toBe(100_000); // only the completed one counts
  });

  it('blocked customers cannot receive deposits', async () => {
    const p = '+240555007777';
    const ref = await h.core.addCustomer(p, 'XAF', 0, { fullName: 'Ana Nchama Obono' });
    h.core.blockCustomer(ref);
    const res = await verify('Ana Nchama', p);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CUSTOMER_UNAVAILABLE');
  });

  it('accepts only correctly signed, recent Core events', async () => {
    const forged = await h.coreEvent({ type: 'deposit_request.confirmed', deposit_request_id: 'dep_x', agent_transaction_id: '00000000-0000-0000-0000-000000000000' }, { secret: 'dev-only-wrong-secret-0123456789abcdef' });
    expect(forged.status).toBe(401);
    const old = await h.coreEvent({ type: 'deposit_request.confirmed', deposit_request_id: 'dep_x', agent_transaction_id: '00000000-0000-0000-0000-000000000000' }, { timestamp: h.clock.now().getTime() - 10 * 60_000 });
    expect(old.status).toBe(401);
  });
});
