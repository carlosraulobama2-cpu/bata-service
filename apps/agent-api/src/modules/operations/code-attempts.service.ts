import { Inject, Injectable } from '@nestjs/common';
import { AGENT_DB, AgentDb } from '../../common/db/database';
import { AppError, Errors } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;
const BLOCK_MS = 15 * 60 * 1000;
/** Only "this code does not exist" counts: expired or used codes are honest mistakes. */
const COUNTED = new Set(['WITHDRAWAL_CODE_INVALID', 'QR_INVALID']);

/**
 * Anti code-guessing (docs/06-seguridad.md): 5 invalid withdrawal/QR codes
 * in 10 minutes block scanning and typing codes for 15 minutes.
 */
@Injectable()
export class CodeAttemptsService {
  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly clock: Clock
  ) {}

  /** Throws RATE_LIMITED (with retry_after_seconds) while the agent is blocked. */
  async assertAllowed(agentId: string): Promise<void> {
    const now = this.clock.now().getTime();
    const recent = await this.db
      .selectFrom('agent.agent_code_failures')
      .select('created_at')
      .where('agent_id', '=', agentId)
      .where('created_at', '>', new Date(now - WINDOW_MS - BLOCK_MS))
      .orderBy('created_at', 'desc')
      .limit(50)
      .execute();
    // Blocked if, at some failure within the last BLOCK_MS, MAX_FAILURES happened within WINDOW_MS.
    const times = recent.map((r) => r.created_at.getTime());
    for (let i = 0; i + MAX_FAILURES - 1 < times.length; i++) {
      const newest = times[i]!;
      if (now - newest >= BLOCK_MS) break;
      if (newest - times[i + MAX_FAILURES - 1]! <= WINDOW_MS) {
        throw Errors.rateLimited({ retry_after_seconds: Math.ceil((newest + BLOCK_MS - now) / 1000) });
      }
    }
  }

  /** Runs a code lookup, recording it if the code does not exist. */
  async guard<T>(agentId: string, kind: 'withdrawal_code' | 'qr', fn: () => Promise<T>): Promise<T> {
    await this.assertAllowed(agentId);
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AppError && COUNTED.has(err.code)) {
        await this.db.insertInto('agent.agent_code_failures').values({ agent_id: agentId, kind, created_at: this.clock.now() }).execute();
      }
      throw err;
    }
  }
}
