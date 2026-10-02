import { Kysely, PostgresDialect, sql, Transaction } from 'kysely';
import { Pool, types } from 'pg';
import type { AgentDatabase } from './schema';

// BIGINT (money, counters) -> number, refusing values that would lose precision.
types.setTypeParser(20, (value: string) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`BIGINT out of safe range: ${value}`);
  return n;
});
// DATE -> 'YYYY-MM-DD' string (no time zone shifts).
types.setTypeParser(1082, (value: string) => value);

export type AgentDb = Kysely<AgentDatabase>;
export type AgentTrx = Transaction<AgentDatabase>;

export const AGENT_DB = Symbol('AGENT_DB');

export function createAgentDb(connectionString: string, max = 20): AgentDb {
  return new Kysely<AgentDatabase>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString, max }) })
  });
}

/** Identifies who is acting, for the status-change triggers in the database. */
export async function setActor(trx: AgentTrx, actorType: 'agent' | 'customer' | 'staff' | 'system', actorId: string | null) {
  await sql`SELECT set_config('app.actor_type', ${actorType}, true), set_config('app.actor_id', ${actorId ?? ''}, true)`.execute(trx);
}
