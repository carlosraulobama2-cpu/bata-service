import { loadEnv } from '../src/config/env';
import { PinHasher } from '../src/common/crypto/secrets';
import { createAgentDb } from '../src/common/db/database';
import { LocalLedgerClient } from '../src/integrations/ledger/local-ledger.client';
import { createActiveAgent, seedReferenceData } from './seed-lib';

async function main() {
  const env = loadEnv();
  if (env.NODE_ENV === 'production') throw new Error('Refusing to seed development data in production');
  const db = createAgentDb(env.DATABASE_URL, 2);
  const ledger = new LocalLedgerClient(env.LEDGER_DATABASE_URL);
  try {
    const { staff } = await seedReferenceData(db, ledger);
    const phone = process.env.SEED_AGENT_PHONE ?? '+240222000001';
    const pin = process.env.SEED_AGENT_PIN;
    if (!pin) throw new Error('Set SEED_AGENT_PIN');
    const agent = await createActiveAgent(db, ledger, new PinHasher(env.PIN_PEPPER), staff, {
      phone,
      pin,
      firstName: 'Carlos',
      lastName: 'Demo',
      float: 2_450_000
    });
    console.log(`Seeded agent ${agent.agentCode} (${phone}) with example limits and commission plan.`);
  } finally {
    await db.destroy();
    await ledger.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
