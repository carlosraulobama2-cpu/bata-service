import { Inject, Injectable, Logger } from '@nestjs/common';
import { AGENT_DB, AgentDb } from '../../common/db/database';
import { Clock } from '../../common/time/clock';
import { CashOutService } from './cash-out.service';
import { OperationLifecycleService } from './operation-lifecycle.service';

const STUCK_AFTER_MS = 30_000;

/**
 * Resolves operations stuck in `processing` (a dependency timed out).
 * Retrying is safe: Core claims and ledger postings are idempotent on the
 * operation id, so money can never move twice.
 */
@Injectable()
export class ReconcilerService {
  private readonly logger = new Logger('Reconciler');

  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly lifecycle: OperationLifecycleService,
    private readonly cashOut: CashOutService,
    private readonly clock: Clock
  ) {}

  async run(olderThanMs = STUCK_AFTER_MS): Promise<{ checked: number; completed: number; failed: number }> {
    const stuck = await this.db
      .selectFrom('agent.agent_transactions')
      .selectAll()
      .where('status', '=', 'processing')
      .where('updated_at', '<=', new Date(this.clock.now().getTime() - olderThanMs))
      .orderBy('updated_at')
      .limit(100)
      .execute();

    let completed = 0;
    let failed = 0;
    for (const tx of stuck) {
      try {
        const result = tx.type === 'cash_out' ? await this.cashOut.process(tx) : (await this.lifecycle.post(tx)).kind === 'completed' ? { status: 'completed' } : { status: 'processing' };
        if (result.status === 'completed') completed++;
      } catch {
        failed++;
      }
    }
    if (stuck.length) this.logger.log(`Reconciled ${stuck.length}: ${completed} completed, ${failed} failed`);
    return { checked: stuck.length, completed, failed };
  }
}
