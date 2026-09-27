import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { ENV, Env } from '../../config/env';
import { AuditService } from '../../common/audit/audit.service';
import { AGENT_DB, AgentDb, AgentTrx, setActor } from '../../common/db/database';
import type { AgentTransaction } from '../../common/db/schema';
import { AppError, Errors } from '../../common/errors/app-error';
import { Clock, operatingPeriods } from '../../common/time/clock';
import { CoreClient } from '../../integrations/core/core.client';
import {
  agentCommission,
  agentFloat,
  customerWallet,
  LedgerClient,
  LedgerInsufficientFundsError,
  LedgerRejectedError,
  PostTransactionInput,
  SYSTEM_ACCOUNTS
} from '../../integrations/ledger/ledger.client';
import { LimitsService } from './limits.service';

export type PostOutcome = { kind: 'completed'; tx: AgentTransaction } | { kind: 'failed'; error: AppError } | { kind: 'unknown'; tx: AgentTransaction };

/**
 * Shared lifecycle of an operation:
 *   pending -> processing -> completed | failed   (plus cancelled from pending)
 * Every status change is a conditional UPDATE (WHERE status = expected), so
 * two workers can never both move the same operation; the DB trigger
 * rejects illegal transitions and records an event for each change.
 */
@Injectable()
export class OperationLifecycleService {
  private readonly logger = new Logger('OperationLifecycle');

  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly ledger: LedgerClient,
    private readonly core: CoreClient,
    private readonly limits: LimitsService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env
  ) {}

  async agentCode(agentId: string): Promise<string> {
    const row = await this.db.selectFrom('agent.agents').select('agent_code').where('id', '=', agentId).executeTakeFirstOrThrow();
    return row.agent_code ?? '';
  }

  /** Moves status if (and only if) it is currently `from`. Returns the updated row or null. */
  async transition(trx: AgentTrx, id: string, from: string[], to: string, reason: string | null, extra: Record<string, unknown> = {}): Promise<AgentTransaction | null> {
    const row = await trx
      .updateTable('agent.agent_transactions')
      .set({ status: to, status_reason: reason, ...extra })
      .where('id', '=', id)
      .where('status', 'in', from)
      .returningAll()
      .executeTakeFirst();
    return row ?? null;
  }

  ledgerRequest(tx: AgentTransaction, agentCode: string): PostTransactionInput {
    const c = tx.currency;
    const commission = tx.commission_amount;
    const commissionEntries = [
      { account: SYSTEM_ACCOUNTS.commissionExpense(c), direction: 'D' as const, amount: commission },
      { account: agentCommission(agentCode, c), direction: 'C' as const, amount: commission }
    ];
    if (tx.type === 'cash_out') {
      return {
        reference: tx.reference,
        idempotencyKey: tx.id,
        kind: 'cash_out',
        externalRef: tx.id,
        entries: [
          { account: customerWallet(tx.customer_ref!, c), direction: 'D', amount: tx.amount },
          { account: agentFloat(agentCode, c), direction: 'C', amount: tx.amount },
          ...commissionEntries
        ],
        captureHolds: [{ sourceSystem: this.core.holdSourceSystem, externalRef: tx.core_request_ref!, account: customerWallet(tx.customer_ref!, c) }]
      };
    }
    if (tx.type === 'cash_in') {
      return {
        reference: tx.reference,
        idempotencyKey: tx.id,
        kind: 'cash_in',
        externalRef: tx.id,
        entries: [
          { account: agentFloat(agentCode, c), direction: 'D', amount: tx.amount },
          { account: customerWallet(tx.customer_ref!, c), direction: 'C', amount: tx.amount },
          ...commissionEntries
        ],
        captureHolds: [{ sourceSystem: this.ledger.sourceSystem, externalRef: tx.id, account: agentFloat(agentCode, c) }]
      };
    }
    throw new Error(`No ledger mapping for ${tx.type}`);
  }

  /**
   * Posts a `processing` operation to the ledger and settles its outcome.
   * Safe to call again for the same operation (the ledger is idempotent on
   * the operation id), which is exactly what the reconciler does.
   */
  async post(tx: AgentTransaction): Promise<PostOutcome> {
    const agentCode = await this.agentCode(tx.agent_id);
    let ledgerTxId: string;
    try {
      ({ transactionId: ledgerTxId } = await this.ledger.post(this.ledgerRequest(tx, agentCode)));
    } catch (err) {
      if (err instanceof LedgerInsufficientFundsError) {
        const isFloat = err.account?.purpose === 'agent_float';
        const error = isFloat ? Errors.insufficientFloat() : Errors.customerUnavailable();
        await this.fail(tx, isFloat ? 'insufficient_float' : 'customer_insufficient_funds', error);
        return { kind: 'failed', error };
      }
      if (err instanceof LedgerRejectedError) {
        this.logger.error(`Ledger rejected ${tx.reference}: ${err.message}`);
        await this.fail(tx, 'ledger_rejected', Errors.internal());
        return { kind: 'failed', error: Errors.internal() };
      }
      // Timeout / connection error: outcome unknown. Stay in processing;
      // the reconciler will retry with the same idempotency key.
      this.logger.warn(`Ledger outcome unknown for ${tx.reference}: ${err instanceof Error ? err.message : String(err)}`);
      return { kind: 'unknown', tx };
    }
    return { kind: 'completed', tx: await this.complete(tx, ledgerTxId, agentCode) };
  }

  async complete(tx: AgentTransaction, ledgerTxId: string, agentCode: string): Promise<AgentTransaction> {
    const now = this.clock.now();
    return this.db.transaction().execute(async (trx) => {
      await setActor(trx, 'system', 'agent-service');
      const done = await this.transition(trx, tx.id, ['processing'], 'completed', null, { completed_at: now, ledger_transaction_id: ledgerTxId });
      if (!done) {
        // Someone else completed it first (e.g. the reconciler): return the current state.
        return trx.selectFrom('agent.agent_transactions').selectAll().where('id', '=', tx.id).executeTakeFirstOrThrow();
      }
      if (done.commission_amount > 0 && done.commission_rule_id) {
        await trx
          .insertInto('agent.agent_commissions')
          .values({
            agent_id: done.agent_id,
            transaction_id: done.id,
            rule_id: done.commission_rule_id,
            operation_type: done.type,
            base_amount: done.amount,
            commission_amount: done.commission_amount,
            currency: done.currency,
            settlement_id: null,
            ledger_transaction_id: ledgerTxId
          })
          .execute();
        const { day } = operatingPeriods(now, this.env.OPERATING_TIMEZONE);
        await trx
          .insertInto('agent.agent_commission_daily')
          .values({ agent_id: done.agent_id, day, operation_type: done.type, currency: done.currency, count: 1, amount: done.commission_amount })
          .onConflict((oc) =>
            oc.columns(['agent_id', 'day', 'operation_type', 'currency']).doUpdateSet({ count: sql`agent.agent_commission_daily.count + 1`, amount: sql`agent.agent_commission_daily.amount + ${done.commission_amount}` })
          )
          .execute();
      }
      const type = done.type === 'cash_in' ? 'cash_in_completed' : 'cash_out_completed';
      await trx
        .insertInto('agent.agent_notifications')
        .values({
          agent_id: done.agent_id,
          type,
          title_key: `notif.${type}.title`,
          body_key: `notif.${type}.body`,
          params: JSON.stringify({ amount: done.amount, currency: done.currency, reference: done.reference }),
          related_transaction_id: done.id,
          read_at: null
        })
        .execute();
      await trx
        .insertInto('agent.outbox_events')
        .values({
          aggregate_type: 'agent_transaction',
          aggregate_id: done.id,
          event_type: 'agent.transaction.completed',
          payload: JSON.stringify({ reference: done.reference, type: done.type, amount: done.amount, currency: done.currency, agent_code: agentCode }),
          published_at: null
        })
        .execute();
      await this.audit.record(trx, {
        actorType: 'agent',
        actorId: agentCode,
        agentId: done.agent_id,
        action: done.type === 'cash_in' ? 'CASH_IN' : 'CASH_OUT',
        resourceType: 'transaction',
        resourceId: done.reference,
        result: 'success',
        deviceId: done.device_id,
        metadata: { amount: done.amount, currency: done.currency, commission: done.commission_amount }
      });
      return done;
    });
  }

  /** Marks an operation failed (from pending/processing) and gives back its limit usage. */
  async fail(tx: AgentTransaction, reason: string, error: AppError, to: 'failed' | 'cancelled' = 'failed'): Promise<AgentTransaction | null> {
    const agentCode = await this.agentCode(tx.agent_id);
    const updated = await this.db.transaction().execute(async (trx) => {
      await setActor(trx, 'system', 'agent-service');
      const from = to === 'cancelled' ? ['pending'] : ['pending', 'processing'];
      const row = await this.transition(trx, tx.id, from, to, reason);
      if (!row) return null;
      await this.limits.release(trx, row);
      await this.audit.record(trx, {
        actorType: 'agent',
        actorId: agentCode,
        agentId: row.agent_id,
        action: row.type === 'cash_in' ? 'CASH_IN' : 'CASH_OUT',
        resourceType: 'transaction',
        resourceId: row.reference,
        result: 'failure',
        reasonCode: error.code,
        deviceId: row.device_id,
        metadata: { amount: row.amount, currency: row.currency, status: to, reason }
      });
      return row;
    });
    if (updated?.type === 'cash_out' && updated.core_request_ref) {
      await this.core.releaseWithdrawalClaim(updated.core_request_ref, updated.id).catch(() => undefined);
    }
    if (updated?.type === 'cash_in') {
      await this.ledger.closeHold({ account: agentFloat(agentCode, updated.currency), externalRef: updated.id, status: 'released' }).catch(() => undefined);
    }
    return updated;
  }
}
