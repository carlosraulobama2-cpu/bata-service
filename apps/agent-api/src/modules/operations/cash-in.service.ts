import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, Env } from '../../config/env';
import type { AgentContext } from '../../common/auth/request-context';
import { AGENT_DB, AgentDb, setActor } from '../../common/db/database';
import type { AgentTransaction } from '../../common/db/schema';
import { Errors } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { CoreClient } from '../../integrations/core/core.client';
import { agentFloat, LedgerClient, LedgerInsufficientFundsError } from '../../integrations/ledger/ledger.client';
import { assertCanOperate } from './cash-out.service';
import { CommissionsService } from './commissions.service';
import { LimitsService } from './limits.service';
import { OperationLifecycleService } from './operation-lifecycle.service';

/**
 * Cash-in: the agent's float is reserved (ledger hold) while the customer
 * confirms in the BataPay app; Core notifies the confirmation and only then
 * is the money posted.
 */
@Injectable()
export class CashInService {
  private readonly logger = new Logger('CashInService');

  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly core: CoreClient,
    private readonly ledger: LedgerClient,
    private readonly limits: LimitsService,
    private readonly commissions: CommissionsService,
    private readonly lifecycle: OperationLifecycleService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env
  ) {}

  async create(agent: AgentContext, input: { customer: { type: 'phone' | 'token'; value: string }; amount: number; currency: string }, idempotencyKey: string): Promise<AgentTransaction> {
    assertCanOperate(agent);
    const existing = await this.db.selectFrom('agent.agent_transactions').selectAll().where('agent_id', '=', agent.agentId).where('idempotency_key', '=', idempotencyKey).executeTakeFirst();
    if (existing) return existing;

    const customer = await this.core.resolveCustomer(input.customer.type === 'phone' ? { phone: input.customer.value } : { customerToken: input.customer.value });
    if (!customer || !customer.canReceive) throw Errors.customerUnavailable();

    const expiresAt = new Date(this.clock.now().getTime() + this.env.CASH_IN_CONFIRMATION_TTL_SECONDS * 1000);
    let tx = await this.db.transaction().execute(async (trx) => {
      await setActor(trx, 'agent', agent.agentCode);
      const commission = await this.commissions.quote(trx, 'cash_in', input.amount, input.currency, agent.tierCode);
      const createdAt = this.clock.now();
      await this.limits.reserve(trx, agent, 'cash_in', input.amount, input.currency, createdAt);
      const inserted = await trx
        .insertInto('agent.agent_transactions')
        .values({
          agent_id: agent.agentId,
          device_id: agent.deviceId,
          session_id: agent.sessionId,
          type: 'cash_in',
          status: 'pending',
          status_reason: null,
          amount: input.amount,
          currency: input.currency,
          commission_amount: commission.amount,
          commission_rule_id: commission.ruleId,
          customer_ref: customer.customerRef,
          customer_masked: customer.masked,
          method: input.customer.type === 'token' ? 'qr' : 'phone',
          qr_id: null,
          core_request_ref: null,
          idempotency_key: idempotencyKey,
          ledger_hold_id: null,
          ledger_transaction_id: null,
          risk_level: null,
          expires_at: expiresAt,
          completed_at: null,
          created_at: createdAt
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('agent.agent_transaction_events')
        .values({ transaction_id: inserted.id, from_status: null, to_status: 'pending', event: 'created', actor_type: 'agent', actor_id: agent.agentCode, details: '{}' })
        .execute();
      return inserted;
    });

    try {
      const holdId = await this.ledger.createHold({ account: agentFloat(agent.agentCode, tx.currency), amount: tx.amount, externalRef: tx.id, expiresAt });
      tx = await this.db.updateTable('agent.agent_transactions').set({ ledger_hold_id: holdId }).where('id', '=', tx.id).returningAll().executeTakeFirstOrThrow();
    } catch (err) {
      if (err instanceof LedgerInsufficientFundsError) {
        await this.lifecycle.fail(tx, 'insufficient_float', Errors.insufficientFloat());
        throw Errors.insufficientFloat();
      }
      throw err; // stays pending; the expiry job cancels it and releases any hold
    }

    const { depositRequestId } = await this.core.createDepositRequest({
      agentCode: agent.agentCode,
      agentTransactionId: tx.id,
      customerRef: tx.customer_ref!,
      amount: tx.amount,
      currency: tx.currency,
      expiresAt
    });
    return this.db.updateTable('agent.agent_transactions').set({ core_request_ref: depositRequestId }).where('id', '=', tx.id).returningAll().executeTakeFirstOrThrow();
  }

  private async byDepositRequest(depositRequestId: string, agentTransactionId: string): Promise<AgentTransaction | undefined> {
    return this.db
      .selectFrom('agent.agent_transactions')
      .selectAll()
      .where('id', '=', agentTransactionId)
      .where('core_request_ref', '=', depositRequestId)
      .where('type', '=', 'cash_in')
      .executeTakeFirst();
  }

  /** Core says the customer confirmed. Idempotent. */
  async onCustomerConfirmed(depositRequestId: string, agentTransactionId: string): Promise<'completed' | 'processing' | 'ignored' | 'expired'> {
    const tx = await this.byDepositRequest(depositRequestId, agentTransactionId);
    if (!tx) return 'ignored';
    if (tx.status === 'completed') return 'completed';
    if (tx.status === 'processing') {
      const outcome = await this.lifecycle.post(tx);
      return outcome.kind === 'completed' ? 'completed' : 'processing';
    }
    if (tx.status !== 'pending') return 'ignored';
    if (tx.expires_at && tx.expires_at <= this.clock.now()) {
      await this.lifecycle.fail(tx, 'expired', Errors.qrExpired(), 'cancelled');
      return 'expired';
    }
    const processing = await this.db.transaction().execute(async (trx) => {
      await setActor(trx, 'customer', tx.customer_ref);
      return this.lifecycle.transition(trx, tx.id, ['pending'], 'processing', 'customer_confirmed');
    });
    if (!processing) return 'ignored';
    const outcome = await this.lifecycle.post(processing);
    return outcome.kind === 'completed' ? 'completed' : outcome.kind === 'unknown' ? 'processing' : 'ignored';
  }

  async onCustomerRejected(depositRequestId: string, agentTransactionId: string): Promise<'failed' | 'ignored'> {
    const tx = await this.byDepositRequest(depositRequestId, agentTransactionId);
    if (!tx || tx.status !== 'pending') return 'ignored';
    const updated = await this.lifecycle.fail(tx, 'customer_rejected', Errors.customerUnavailable());
    return updated ? 'failed' : 'ignored';
  }

  async cancel(agent: AgentContext, transactionId: string): Promise<AgentTransaction> {
    const tx = await this.db.selectFrom('agent.agent_transactions').selectAll().where('id', '=', transactionId).where('agent_id', '=', agent.agentId).executeTakeFirst();
    if (!tx) throw Errors.notFound();
    if (tx.status !== 'pending') throw Errors.operationNotCancellable();
    const updated = await this.lifecycle.fail(tx, 'agent_cancelled', Errors.operationNotCancellable(), 'cancelled');
    if (!updated) throw Errors.operationNotCancellable();
    if (updated.core_request_ref) await this.core.cancelDepositRequest(updated.core_request_ref).catch(() => undefined);
    return updated;
  }

  /** Job: cancels cash-ins the customer didn't confirm in time and frees the float. */
  async expirePending(): Promise<number> {
    const expired = await this.db
      .selectFrom('agent.agent_transactions')
      .selectAll()
      .where('status', '=', 'pending')
      .where('type', '=', 'cash_in')
      .where('expires_at', '<=', this.clock.now())
      .limit(200)
      .execute();
    let count = 0;
    for (const tx of expired) {
      const updated = await this.lifecycle.fail(tx, 'expired', Errors.qrExpired(), 'cancelled');
      if (updated) {
        count++;
        if (updated.core_request_ref) await this.core.cancelDepositRequest(updated.core_request_ref).catch(() => undefined);
      }
    }
    if (count) this.logger.log(`Expired ${count} pending cash-in(s)`);
    return count;
  }
}
