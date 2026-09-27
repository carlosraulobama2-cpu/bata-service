import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'kysely';
import { AGENT_DB, AgentDb } from './db/database';
import { CashInService } from '../modules/operations/cash-in.service';
import { ReconcilerService } from '../modules/operations/reconciler.service';

/**
 * Periodic jobs (expire pending cash-ins, reconcile stuck operations).
 * A PostgreSQL advisory lock makes sure only one instance runs each job
 * at a time when several API replicas are deployed.
 */
@Injectable()
export class JobsService implements OnApplicationShutdown {
  private readonly logger = new Logger('Jobs');
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly cashIn: CashInService,
    private readonly reconciler: ReconcilerService
  ) {}

  start(intervalMs = 15000): void {
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
  }

  async tick(): Promise<void> {
    await this.exclusive('jobs:expire-cash-in', () => this.cashIn.expirePending());
    await this.exclusive('jobs:reconcile', () => this.reconciler.run());
  }

  private async exclusive(name: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await this.db.connection().execute(async (conn) => {
        const { rows } = await sql<{ locked: boolean }>`SELECT pg_try_advisory_lock(hashtext(${name})) AS locked`.execute(conn);
        if (!rows[0]?.locked) return;
        try {
          await fn();
        } finally {
          await sql`SELECT pg_advisory_unlock(hashtext(${name}))`.execute(conn);
        }
      });
    } catch (err) {
      this.logger.error(`Job ${name} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
