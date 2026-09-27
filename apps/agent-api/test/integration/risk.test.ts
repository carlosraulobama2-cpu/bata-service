import { Harness, PIN, Session } from '../support/harness';

describe('Risk engine', () => {
  let h: Harness;
  let s: Session;
  let agent: { id: string; agentCode: string };
  const phone = '+240222000971';
  let n = 0;

  beforeAll(async () => {
    h = await Harness.start();
    agent = await h.createAgent(phone, PIN, 5_000_000);
    s = await h.login(phone);
    h.clock.advance(25 * 3600 * 1000); // past the new-device cooldown
    s = await h.login(phone, PIN, s.device);
  });
  afterAll(() => h.stop());

  const newCustomer = async (balance = 1_000_000) => {
    const p = `+2405559710${String(++n).padStart(2, '0')}`;
    return { phone: p, ref: await h.core.addCustomer(p, 'XAF', balance) };
  };
  const cashIn = (customerPhone: string, amount: number, extra: object = {}) =>
    h.signedPost(s, '/agent/v1/cash-in', { customer: { type: 'phone', value: customerPhone }, amount, currency: 'XAF', agent_auth: { method: 'pin', pin: PIN }, ...extra });
  const cashOut = async (customerRef: string, amount: number) => {
    const w = await h.core.createWithdrawal(customerRef, amount);
    return h.signedPost(s, '/agent/v1/cash-out', { withdrawal_request_id: w.id, amount, currency: 'XAF', agent_auth: { method: 'pin', pin: PIN } });
  };
  const setMode = (codes: string[], mode: 'shadow' | 'active') => h.db.updateTable('agent.fraud_rules').set({ mode }).where('code', 'in', codes).execute();
  const assessmentOf = (txId: string) => h.db.selectFrom('agent.risk_assessments').selectAll().where('transaction_id', '=', txId).executeTakeFirstOrThrow();
  /** Moves the clock (tokens live 10 min, so sign in again). */
  const advance = async (ms: number) => {
    h.clock.advance(ms);
    s = await h.login(phone, PIN, s.device);
  };
  const fresh = () => advance(61 * 60_000); // leave every rule window behind

  describe('duplicate deposits', () => {
    it('asks to confirm the same deposit to the same customer within 10 minutes', async () => {
      const c = await newCustomer();
      expect((await cashIn(c.phone, 12_000)).status).toBe(201);
      const again = await cashIn(c.phone, 12_000);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('POSSIBLE_DUPLICATE');
      expect(again.body.error.details).toMatchObject({ previous_reference: expect.stringMatching(/^BTX-/), minutes_ago: 0 });

      const confirmed = await cashIn(c.phone, 12_000, { confirm_duplicate: true });
      expect(confirmed.status).toBe(201);
      expect((await cashIn(c.phone, 13_000)).status).toBe(201); // other amount: no question
      await advance(11 * 60_000);
      expect((await cashIn(c.phone, 12_000)).status).toBe(201); // window passed
    });

    it('a failed or cancelled deposit is not a duplicate', async () => {
      await fresh();
      const c = await newCustomer();
      const first = await cashIn(c.phone, 14_000);
      await h.request('POST', `/agent/v1/transactions/${first.body.transaction.id}/cancel`, { headers: { authorization: `Bearer ${s.accessToken}` } });
      expect((await cashIn(c.phone, 14_000)).status).toBe(201);
    });
  });

  describe('scoring', () => {
    beforeAll(() => fresh());

    it('shadow rules are evaluated and recorded but never decide', async () => {
      const c = await newCustomer();
      const dep = await cashIn(c.phone, 20_000);
      const wd = await cashOut(c.ref, 20_000); // circular: deposit then withdrawal for the same customer
      expect(wd.status).toBe(201);
      const a = await assessmentOf(wd.body.transaction.id);
      expect(a).toMatchObject({ level: 'low', decision: 'allow' });
      expect(Number(a.score)).toBe(0);
      expect(a.signals).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'circular', mode: 'shadow', hit: true })]));
      expect(a.rules_version).toContain('circular@1:s');
      const tx = await h.db.selectFrom('agent.agent_transactions').select('risk_level').where('id', '=', dep.body.transaction.id).executeTakeFirstOrThrow();
      expect(tx.risk_level).toBe('low');
    });

    it('an active rule raises the score: MEDIUM is allowed and recorded', async () => {
      await fresh();
      await setMode(['circular'], 'active');
      const c = await newCustomer();
      await cashIn(c.phone, 21_000);
      const wd = await cashOut(c.ref, 21_000);
      expect(wd.status).toBe(201);
      expect(await assessmentOf(wd.body.transaction.id)).toMatchObject({ level: 'medium', decision: 'allow' });
      const tx = await h.db.selectFrom('agent.agent_transactions').select('risk_level').where('id', '=', wd.body.transaction.id).executeTakeFirstOrThrow();
      expect(tx.risk_level).toBe('medium');
    });

    it('HIGH is blocked before any money moves, with a fraud case and a neutral message', async () => {
      await fresh();
      await setMode(['circular', 'velocity_agent'], 'active');
      const c = await newCustomer();
      for (let i = 0; i < 5; i++) expect((await cashIn(c.phone, 30_000 + i)).status).toBe(201); // 5 ops in 5 min
      // 6th operation, a withdrawal right after deposits for the same customer: velocity (30) + circular (45) = 75
      const w = await h.core.createWithdrawal(c.ref, 25_000); // the customer's own request (Core reserves 25.000)
      const floatBefore = await h.balance('agent', agent.agentCode, 'agent_float');
      const customerBefore = await h.balance('customer', c.ref, 'customer_wallet');
      const txCountBefore = (await h.db.selectFrom('agent.agent_transactions').select('id').where('agent_id', '=', agent.id).execute()).length;
      const res = await h.signedPost(s, '/agent/v1/cash-out', { withdrawal_request_id: w.id, amount: 25_000, currency: 'XAF', agent_auth: { method: 'pin', pin: PIN } });
      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({ code: 'OPERATION_UNDER_REVIEW', message: 'No podemos completar esta operación ahora. Contacta con soporte.' });
      expect(res.body.error.details).toBeUndefined(); // the agent never learns which rule fired

      // Nothing moved, nothing created, the withdrawal code is still the customer's.
      expect(await h.balance('agent', agent.agentCode, 'agent_float')).toEqual(floatBefore);
      expect(await h.balance('customer', c.ref, 'customer_wallet')).toEqual(customerBefore);
      expect((await h.db.selectFrom('agent.agent_transactions').select('id').where('agent_id', '=', agent.id).execute()).length).toBe(txCountBefore);
      expect((await h.core.getWithdrawal(w.id))?.status).toBe('active');

      const fraudCase = await h.db
        .selectFrom('agent.fraud_cases as f')
        .innerJoin('agent.risk_assessments as r', 'r.id', 'f.risk_assessment_id')
        .select(['f.reference', 'f.status', 'r.level', 'r.decision', 'r.score', 'r.signals'])
        .where('f.agent_id', '=', agent.id)
        .executeTakeFirstOrThrow();
      expect(fraudCase).toMatchObject({ reference: expect.stringMatching(/^FRC-\d{6}$/), status: 'open', level: 'high', decision: 'block' });
      expect(Number(fraudCase.score)).toBe(75);
      const audit = await h.db.selectFrom('agent.agent_audit_logs').select(['result', 'reason_code']).where('resource_id', '=', fraudCase.reference).executeTakeFirstOrThrow();
      expect(audit).toEqual({ result: 'denied', reason_code: 'RISK_HIGH' });
      await setMode(['circular', 'velocity_agent'], 'shadow');
    });

    it('structuring: several operations just under the per-operation limit', async () => {
      await fresh();
      await setMode(['structuring', 'circular'], 'active'); // 40 + 45
      const c = await newCustomer(3_000_000);
      for (let i = 0; i < 2; i++) expect((await cashIn(c.phone, 460_000 + i)).status).toBe(201); // >= 90% of 500.000
      await cashIn(c.phone, 20_000);
      const third = await cashOut(c.ref, 470_000); // 3rd near-limit op in the hour + circular
      expect(third.body.error.code).toBe('OPERATION_UNDER_REVIEW');
      await setMode(['structuring', 'circular'], 'shadow');
    });

    it('the same customer at many agents in an hour', async () => {
      await fresh();
      await setMode(['customer_velocity'], 'active');
      const c = await newCustomer();
      const others: Session[] = [];
      for (let i = 0; i < 3; i++) {
        const p = `+24022200098${i}`;
        await h.createAgent(p, PIN, 1_000_000);
        const o = await h.login(p);
        others.push(o);
      }
      // 3 agents (cooldown is irrelevant for this rule), then this agent is the 4th
      for (const o of others) {
        const r = await h.signedPost(o, '/agent/v1/cash-in', { customer: { type: 'phone', value: c.phone }, amount: 5_000, currency: 'XAF', agent_auth: { method: 'pin', pin: PIN } });
        expect(r.status).toBe(201);
      }
      const mine = await cashIn(c.phone, 5_000);
      expect(mine.status).toBe(201); // weight 30 < 40: still LOW, allowed and recorded
      const a = await assessmentOf(mine.body.transaction.id);
      expect(a.signals).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'customer_velocity', hit: true, value: { operations: 4, agents: 4 } })]));
      expect(Number(a.score)).toBe(30);
      expect(a.level).toBe('low');
      await setMode(['customer_velocity'], 'shadow');
    });
  });

  it('rules are versioned: parameters cannot be edited in place', async () => {
    await expect(h.db.updateTable('agent.fraud_rules').set({ params: JSON.stringify({ window_minutes: 1 }) }).where('code', '=', 'circular').execute()).rejects.toThrow(/FRAUD_RULE_IMMUTABLE/);
  });
});
