import { Inject, Injectable } from '@nestjs/common';
import { AGENT_DB, AgentDb } from '../db/database';
import { AppError, Errors } from '../errors/app-error';
import { sha256Hex } from '../crypto/secrets';
import { Clock } from '../time/clock';

const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const TTL_MS = 48 * 3600 * 1000;

export interface HandlerResult<T> {
  status: number;
  body: T;
}

/** Stable JSON (sorted keys) so the same request always hashes the same. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * API-level idempotency (docs/05-api.md §1): the same Idempotency-Key with
 * the same request returns the stored response; with a different request
 * it is rejected. The agent's step-up credentials (agent_auth) are left
 * out of the hash so a PIN is never part of stored data.
 */
@Injectable()
export class IdempotencyService {
  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly clock: Clock
  ) {}

  async run<T>(agentId: string, key: string | undefined, endpoint: string, body: Record<string, unknown>, handler: () => Promise<HandlerResult<T>>): Promise<HandlerResult<T> & { replayed: boolean }> {
    if (!key) throw Errors.idempotencyKeyRequired();
    if (!KEY_PATTERN.test(key)) throw Errors.validation({ fields: ['Idempotency-Key'] });

    const { agent_auth: _omit, ...hashable } = body;
    const requestHash = sha256Hex(`${endpoint}\n${stableStringify(hashable)}`);
    const now = this.clock.now();

    await this.db.deleteFrom('agent.idempotency_keys').where('agent_id', '=', agentId).where('key', '=', key).where('expires_at', '<', now).execute();

    const inserted = await this.db
      .insertInto('agent.idempotency_keys')
      .values({ agent_id: agentId, key, endpoint, request_hash: requestHash, expires_at: new Date(now.getTime() + TTL_MS) })
      .onConflict((oc) => oc.columns(['agent_id', 'key']).doNothing())
      .returning('key')
      .executeTakeFirst();

    if (!inserted) {
      const existing = await this.db
        .selectFrom('agent.idempotency_keys')
        .selectAll()
        .where('agent_id', '=', agentId)
        .where('key', '=', key)
        .executeTakeFirstOrThrow();
      if (existing.request_hash !== requestHash) throw Errors.idempotencyKeyReused();
      if (existing.status === 'completed' && existing.response_code !== null) {
        return { status: existing.response_code, body: existing.response_body as T, replayed: true };
      }
      throw Errors.operationInProgress();
    }

    try {
      const result = await handler();
      await this.store(agentId, key, result.status, result.body);
      return { ...result, replayed: false };
    } catch (err) {
      if (err instanceof AppError && err.status < 500) {
        // A definite answer: replay it for the same key.
        await this.store(agentId, key, err.status, { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
      } else {
        // Unknown outcome: free the key so the client can retry with it.
        // Double execution is still impossible: the operation row is unique
        // per (agent, key) and the ledger is idempotent per operation.
        await this.db.deleteFrom('agent.idempotency_keys').where('agent_id', '=', agentId).where('key', '=', key).execute();
      }
      throw err;
    }
  }

  private async store(agentId: string, key: string, status: number, body: unknown): Promise<void> {
    await this.db
      .updateTable('agent.idempotency_keys')
      .set({ status: 'completed', response_code: status, response_body: JSON.stringify(body) })
      .where('agent_id', '=', agentId)
      .where('key', '=', key)
      .execute();
  }
}
