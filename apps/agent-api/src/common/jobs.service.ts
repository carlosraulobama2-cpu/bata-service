import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'kysely';
import { AGENT_DB, AgentDb } from './db/database';
import { CashInService } from '../modules/operations/cash-in.service';
import { ReconcilerService } from '../modules/operations/reconciler.service';
import { PushDispatcher } from '../modules/notifications/push-dispatcher.service';

/**
 * Periodic jobs (expire pending cash-ins, reconcile stuck operations).
 * A PostgreSQL advisory lock makes sure only one instance runs each job
 * at a time when several API replicas are deployed.
 */
@Injectable()
export class JobsService implements OnApplicationShutdown {
  private readonly logger = new Logger('Jobs');
  private timer?: NodeJS.Timeout;
  private pushTimer?: NodeJS.Timeout;
  private pushing = false;

  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly cashIn: CashInService,
    private readonly reconciler: ReconcilerService,
    private readonly push: PushDispatcher
  ) {}

  start(intervalMs = 15000, pushIntervalMs = 2000): void {
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
    // Push has its own fast loop: "Pagado" on the phone should not wait for the 15 s tick.
    this.pushTimer = setInterval(() => void this.pushTick(), pushIntervalMs);
    this.pushTimer.unref();
  }

  private async pushTick(): Promise<void> {
    if (this.pushing) return;
    this.pushing = true;
    try {
      // No advisory lock needed: rows are claimed with SKIP LOCKED, so replicas share the work.
      await this.push.run();
    } catch (err) {
      this.logger.error(`Push dispatch failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.pushing = false;
    }
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
    if (this.pushTimer) clearInterval(this.pushTimer);
  }
}
