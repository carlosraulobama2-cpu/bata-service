import { PinHasher } from '../src/common/crypto/secrets';
import type { AgentDb } from '../src/common/db/database';
import { agentCommission, agentFloat, LedgerClient, SYSTEM_ACCOUNTS } from '../src/integrations/ledger/ledger.client';

/**
 * Reference data for development and tests. Values are EXAMPLES (see
 * docs/08-modulos-negocio.md): real limits and commissions are business
 * decisions still "por confirmar".
 */
export async function seedReferenceData(db: AgentDb, ledger: LedgerClient, currency = 'XAF') {
  await db.insertInto('agent.agent_tiers').values({ code: 'tier_1', name: 'Agente' }).onConflict((oc) => oc.column('code').doNothing()).execute();

  const staff = async (email: string, name: string) =>
    (
      await db
        .insertInto('agent.staff_users')
        .values({ email, full_name: name })
        .onConflict((oc) => oc.column('email').doUpdateSet({ full_name: name }))
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  const compliance = await staff('compliance@velynt.test', 'Compliance (dev)');
  const admin = await staff('admin@velynt.test', 'Admin (dev)');
  const finance = await staff('finance@velynt.test', 'Finance (dev)');
  const finance2 = await staff('finance2@velynt.test', 'Finance approver (dev)');

  for (const op of ['cash_in', 'cash_out', 'qr_payment'] as const) {
    await db
      .insertInto('agent.limit_policies')
      .values({
        tier_code: 'tier_1',
        operation_type: op,
        currency,
        per_tx_min: 500,
        per_tx_max: 500000,
        daily_amount_max: 2000000,
        daily_count_max: 100,
        monthly_amount_max: 20000000,
        version: 1,
        effective_from: new Date('2026-01-01T00:00:00Z'),
        effective_to: null
      })
      .onConflict((oc) => oc.columns(['tier_code', 'operation_type', 'currency', 'version']).doNothing())
      .execute();
  }

  const existingPlan = await db.selectFrom('agent.commission_plans').select('id').where('code', '=', 'standard').where('version', '=', 1).executeTakeFirst();
  if (!existingPlan) {
    const plan = await db
      .insertInto('agent.commission_plans')
      .values({
        code: 'standard',
        version: 1,
        name: 'Plan estándar (ejemplo)',
        currency,
        status: 'active',
        effective_from: new Date('2026-01-01T00:00:00Z'),
        effective_to: null,
        created_by: finance,
        approved_by: finance2
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('agent.commission_rules')
      .values([
        { plan_id: plan.id, operation_type: 'cash_in', tier_code: null, amount_to: null, rate_bps: 50, min_amount: 100, max_amount: 5000 },
        { plan_id: plan.id, operation_type: 'cash_out', tier_code: null, amount_to: null, rate_bps: 100, min_amount: 100, max_amount: 5000 }
      ])
      .execute();
  }

  await ledger.openAccount(SYSTEM_ACCOUNTS.bank(currency), 'asset');
  await ledger.openAccount(SYSTEM_ACCOUNTS.commissionExpense(currency), 'expense', { trackBalance: false });
  await ledger.openAccount(SYSTEM_ACCOUNTS.feeRevenue(currency), 'revenue', { trackBalance: false });

  return { staff: { compliance, admin, finance, finance2 } };
}

/** Creates an ACTIVE agent through the real approval path, with ledger accounts and float. */
export async function createActiveAgent(
  db: AgentDb,
  ledger: LedgerClient,
  hasher: PinHasher,
  staff: { compliance: string; admin: string },
  input: { phone: string; pin: string; firstName: string; lastName: string; city?: string; tradeName?: string; float?: number; currency?: string }
) {
  const currency = input.currency ?? 'XAF';
  const existing = await db.selectFrom('agent.agents').select(['id', 'agent_code']).where('phone_e164', '=', input.phone).executeTakeFirst();
  if (existing) return { id: existing.id, agentCode: existing.agent_code! };

  const agent = await db.insertInto('agent.agents').values({ country: 'GQ', phone_e164: input.phone, tier_code: 'tier_1', status: 'pending' }).returning('id').executeTakeFirstOrThrow();
  await db.updateTable('agent.agents').set({ status: 'under_review' }).where('id', '=', agent.id).execute();
  const { code } = await db
    .selectNoFrom((eb) => eb.fn<string>('agent.next_agent_code').as('code'))
    .executeTakeFirstOrThrow();
  await db.updateTable('agent.agents').set({ status: 'approved', agent_code: code, approved_by: staff.compliance, approved_at: new Date() }).where('id', '=', agent.id).execute();
  await db.updateTable('agent.agents').set({ status: 'active', activated_by: staff.admin, activated_at: new Date() }).where('id', '=', agent.id).execute();

  await db.insertInto('agent.agent_profiles').values({ agent_id: agent.id, first_name: input.firstName, last_name: input.lastName, city: input.city ?? 'Bata', country: 'GQ' }).execute();
  await db
    .insertInto('agent.agent_businesses')
    .values({ agent_id: agent.id, trade_name: input.tradeName ?? 'Velynt Services Agent', business_type: 'shop', address_line: 'Centro', city: input.city ?? 'Bata', country: 'GQ' })
    .execute();
  await db.insertInto('agent.agent_credentials').values({ agent_id: agent.id, pin_hash: await hasher.hash(input.pin), pin_set_at: new Date() }).execute();

  const floatId = await ledger.openAccount(agentFloat(code, currency), 'liability');
  const commissionId = await ledger.openAccount(agentCommission(code, currency), 'liability');
  await db
    .insertInto('agent.agent_balances')
    .values([
      { agent_id: agent.id, balance_type: 'float', currency, ledger_account_id: floatId },
      { agent_id: agent.id, balance_type: 'commission', currency, ledger_account_id: commissionId }
    ])
    .execute();

  if (input.float) {
    await ledger.post({
      reference: `TOPUP-${code}-INITIAL`,
      idempotencyKey: `float-topup-initial-${code}`,
      kind: 'float_topup',
      externalRef: agent.id,
      description: 'Initial float (development)',
      entries: [
        { account: SYSTEM_ACCOUNTS.bank(currency), direction: 'D', amount: input.float },
        { account: agentFloat(code, currency), direction: 'C', amount: input.float }
      ]
    });
  }
  return { id: agent.id, agentCode: code };
}
