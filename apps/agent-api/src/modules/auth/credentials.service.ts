import { Inject, Injectable } from '@nestjs/common';
import { ENV, Env } from '../../config/env';
import { PinHasher } from '../../common/crypto/secrets';
import { AGENT_DB, AgentDb } from '../../common/db/database';
import { Errors } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';

const LOCKS_BEFORE_BLOCK = 3;

export type PinCheck = { ok: true } | { ok: false; attemptsLeft: number; lockedUntil: Date | null };

/**
 * PIN verification with server-side attempt counting (reinstalling the app
 * does not reset it): 5 failures -> temporary lock, doubling each time;
 * the 3rd lock blocks the account until recovery.
 */
@Injectable()
export class CredentialsService {
  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly hasher: PinHasher,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env
  ) {}

  async verifyPin(agentId: string, pin: string): Promise<PinCheck> {
    const cred = await this.db.selectFrom('agent.agent_credentials').selectAll().where('agent_id', '=', agentId).executeTakeFirst();
    if (!cred) {
      await this.hasher.verifyDummy(pin);
      return { ok: false, attemptsLeft: 0, lockedUntil: null };
    }
    const now = this.clock.now();
    if (cred.locked_until && cred.locked_until > now) throw Errors.accountLocked({ locked_until: cred.locked_until.toISOString() });

    if (await this.hasher.verify(cred.pin_hash, pin)) {
      if (cred.failed_attempts > 0) {
        await this.db.updateTable('agent.agent_credentials').set({ failed_attempts: 0 }).where('agent_id', '=', agentId).execute();
      }
      return { ok: true };
    }

    return this.db.transaction().execute(async (trx) => {
      const locked = await trx.selectFrom('agent.agent_credentials').selectAll().where('agent_id', '=', agentId).forUpdate().executeTakeFirstOrThrow();
      const failed = locked.failed_attempts + 1;
      if (failed < this.env.PIN_MAX_ATTEMPTS) {
        await trx.updateTable('agent.agent_credentials').set({ failed_attempts: failed }).where('agent_id', '=', agentId).execute();
        return { ok: false as const, attemptsLeft: this.env.PIN_MAX_ATTEMPTS - failed, lockedUntil: null };
      }
      const lockMinutes = this.env.PIN_LOCK_MINUTES * 2 ** locked.lock_count;
      const lockedUntil = new Date(now.getTime() + lockMinutes * 60000);
      const lockCount = locked.lock_count + 1;
      await trx
        .updateTable('agent.agent_credentials')
        .set({ failed_attempts: 0, locked_until: lockedUntil, lock_count: lockCount })
        .where('agent_id', '=', agentId)
        .execute();
      await trx.insertInto('agent.agent_access_events').values({ agent_id: agentId, event: 'account_locked', phone_hmac: null, device_id: null, ip: null, approx_location: null }).execute();

      if (lockCount >= LOCKS_BEFORE_BLOCK) {
        const agent = await trx.selectFrom('agent.agents').select('status').where('id', '=', agentId).executeTakeFirstOrThrow();
        if (agent.status === 'active' || agent.status === 'suspended') {
          await trx.updateTable('agent.agents').set({ status: 'blocked', status_reason: 'too_many_pin_locks' }).where('id', '=', agentId).execute();
        }
        await trx
          .updateTable('agent.agent_sessions')
          .set({ status: 'revoked', revoked_at: now, revoked_reason: 'account_blocked' })
          .where('agent_id', '=', agentId)
          .where('status', '=', 'active')
          .execute();
      }
      return { ok: false as const, attemptsLeft: 0, lockedUntil };
    });
  }

  async resetLocks(agentId: string): Promise<void> {
    await this.db
      .updateTable('agent.agent_credentials')
      .set({ failed_attempts: 0, lock_count: 0, locked_until: null })
      .where('agent_id', '=', agentId)
      .execute();
  }
}
