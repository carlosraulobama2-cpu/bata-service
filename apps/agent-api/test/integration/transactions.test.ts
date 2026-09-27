import { randomUUID } from 'node:crypto';
import { Harness, PIN, Session } from '../support/harness';

describe('Transactions history', () => {
  let h: Harness;
  let s: Session;
  let other: Session;
  let customerRef: string;

  beforeAll(async () => {
    h = await Harness.start();
    await h.createAgent('+240222000501', PIN, 1_000_000);
    await h.createAgent('+240222000502', PIN, 1_000_000);
    customerRef = await h.core.addCustomer('+240555000501', 'XAF', 1_000_000);
    s = await h.login('+240222000501');
    other = await h.login('+240222000502');
    for (const amount of [10_000, 20_000, 30_000]) {
      const w = await h.core.createWithdrawal(customerRef, amount);
      await h.signedPost(s, '/agent/v1/cash-out', { withdrawal_request_id: w.id, amount, currency: 'XAF', agent_auth: { method: 'pin', pin: PIN } });
    }
  });
  afterAll(() => h.stop());

  it('lists today with totals, newest first', async () => {
    const res = await h.get(s, '/agent/v1/transactions?period=today');
    expect(res.status).toBe(200);
    expect(res.body.data.map((t: any) => t.amount)).toEqual([30_000, 20_000, 10_000]);
    expect(res.body.totals).toMatchObject({ cash_out: 60_000, cash_in: 0, commissions: 600, currency: 'XAF' });
    expect(res.body.data[0]).toMatchObject({ customer_masked: '****0501', status: 'completed' });
    expect(JSON.stringify(res.body)).not.toContain('+240555000501');
  });

  it('paginates with a cursor', async () => {
    const page1 = await h.get(s, '/agent/v1/transactions?period=today&limit=2');
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.next_cursor).toEqual(expect.any(String));
    const page2 = await h.get(s, `/agent/v1/transactions?period=today&limit=2&cursor=${page1.body.next_cursor}`);
    expect(page2.body.data.map((t: any) => t.amount)).toEqual([10_000]);
    expect(page2.body.next_cursor).toBeNull();
  });

  it('filters by type and status and validates input', async () => {
    const res = await h.get(s, '/agent/v1/transactions?period=last_7_days&type=cash_in');
    expect(res.body.data).toHaveLength(0);
    expect((await h.get(s, '/agent/v1/transactions?type=hack')).status).toBe(400);
    expect((await h.get(s, '/agent/v1/transactions?cursor=%%%')).status).toBe(400);
  });

  it("never shows another agent's operation (404, not 403)", async () => {
    const mine = await h.get(s, '/agent/v1/transactions?period=today');
    const res = await h.get(other, `/agent/v1/transactions/${mine.body.data[0].id}`);
    expect(res.status).toBe(404);
    expect((await h.get(other, '/agent/v1/transactions?period=today')).body.data).toHaveLength(0);
  });

  it('recovers an operation by its idempotency key after a network cut', async () => {
    const w = await h.core.createWithdrawal(customerRef, 5_000);
    const key = randomUUID();
    await h.signedPost(s, '/agent/v1/cash-out', { withdrawal_request_id: w.id, amount: 5_000, currency: 'XAF', agent_auth: { method: 'pin', pin: PIN } }, { key });
    const res = await h.get(s, `/agent/v1/transactions/by-key/${key}`);
    expect(res.body.transaction).toMatchObject({ amount: 5_000, status: 'completed' });
    expect((await h.get(other, `/agent/v1/transactions/by-key/${key}`)).status).toBe(404);
  });

  it('balance comes from the ledger', async () => {
    const res = await h.get(s, '/agent/v1/balance');
    expect(res.body.float).toMatchObject({ currency: 'XAF', available: 1_065_000, held: 0 });
    expect(res.body.commissions_pending.amount).toBe(700);
    expect(res.body.declared_cash).toBeNull();
  });
});
