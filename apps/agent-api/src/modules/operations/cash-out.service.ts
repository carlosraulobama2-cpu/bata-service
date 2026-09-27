import { Inject, Injectable } from '@nestjs/common';
import type { AgentContext } from '../../common/auth/request-context';
import { AGENT_DB, AgentDb, setActor } from '../../common/db/database';
import type { AgentTransaction } from '../../common/db/schema';
import { Errors } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { CoreClient, CoreConflictError, WithdrawalRequest } from '../../integrations/core/core.client';
import { CodeAttemptsService } from './code-attempts.service';
import { CommissionsService } from './commissions.service';
import { LimitsService } from './limits.service';
import { OperationLifecycleService } from './operation-lifecycle.service';

export function assertCanOperate(agent: AgentContext): void {
  if (agent.status === 'suspended') throw Errors.accountSuspended();
  if (agent.status !== 'active') throw Errors.accountNotActive();
}

@Injectable()
export class CashOutService {
  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly core: CoreClient,
    private readonly limits: LimitsService,
    private readonly commissions: CommissionsService,
    private readonly lifecycle: OperationLifecycleService,
    private readonly codeAttempts: CodeAttemptsService,
    private readonly clock: Clock
  ) {}

  private checkUsable(w: WithdrawalRequest | null): WithdrawalRequest {
    if (!w || w.status === 'cancelled') throw Errors.withdrawalCodeInvalid();
    if (w.status === 'claimed') throw Errors.qrAlreadyUsed();
    if (w.expiresAt <= this.clock.now()) throw Errors.qrExpired();
    return w;
  }

  /** What is behind this QR / code? No side effects. */
  async resolve(agent: AgentContext, code: { type: 'qr' | 'code'; value: string }) {
    assertCanOperate(agent);
    const w = await this.codeAttempts.guard(agent.agentId, code.type === 'qr' ? 'qr' : 'withdrawal_code', async () => this.checkUsable(await this.core.findWithdrawalByCode(code.value)));
    const commission = await this.commissions.quote(this.db, 'cash_out', w.amount, w.currency, agent.tierCode);
    return {
      withdrawal_request_id: w.id,
      amount: w.amount,
      currency: w.currency,
      customer_masked: w.masked,
      expires_at: w.expiresAt.toISOString(),
      commission: commission.amount
    };
  }

  async execute(agent: AgentContext, input: { withdrawal_request_id: string; amount: number; currency: string }, idempotencyKey: string): Promise<AgentTransaction> {
    assertCanOperate(agent);

    // Resuming an operation created by an earlier attempt with the same key.
    const existing = await this.db.selectFrom('agent.agent_transactions').selectAll().where('agent_id', '=', agent.agentId).where('idempotency_key', '=', idempotencyKey).executeTakeFirst();
    if (existing) return existing.status === 'processing' ? this.process(existing) : existing;

    const w = this.checkUsable(await this.core.getWithdrawal(input.withdrawal_request_id));
    if (w.amount !== input.amount || w.currency !== input.currency) throw Errors.amountMismatch();

    const tx = await this.db.transaction().execute(async (trx) => {
      await setActor(trx, 'agent', agent.agentCode);
      const commission = await this.commissions.quote(trx, 'cash_out', w.amount, w.currency, agent.tierCode);
      const createdAt = this.clock.now();
      await this.limits.reserve(trx, agent, 'cash_out', w.amount, w.currency, createdAt);
      const inserted = await trx
        .insertInto('agent.agent_transactions')
        .values({
          agent_id: agent.agentId,
          device_id: agent.deviceId,
          session_id: agent.sessionId,
          type: 'cash_out',
          status: 'processing',
          status_reason: null,
          amount: w.amount,
          currency: w.currency,
          commission_amount: commission.amount,
          commission_rule_id: commission.ruleId,
          customer_ref: w.customerRef,
          customer_masked: w.masked,
          method: 'qr',
          qr_id: null,
          core_request_ref: w.id,
          idempotency_key: idempotencyKey,
          ledger_hold_id: null,
          ledger_transaction_id: null,
          risk_level: null,
          expires_at: null,
          completed_at: null,
          created_at: createdAt
        })
        .returningAll()
        .executeTakeFirstOrThrow()
        .catch((err: { code?: string; constraint?: string }) => {
          if (err.code === '23505' && err.constraint === 'uq_agent_tx_core_request') throw Errors.qrAlreadyUsed();
          throw err;
        });
      await trx
        .insertInto('agent.agent_transaction_events')
        .values({ transaction_id: inserted.id, from_status: null, to_status: 'processing', event: 'created', actor_type: 'agent', actor_id: agent.agentCode, details: JSON.stringify({ withdrawal_request_id: w.id }) })
        .execute();
      return inserted;
    });
    return this.process(tx);
  }

  /** Claim the customer's request at Core, then post to the ledger. Re-runnable. */
  async process(tx: AgentTransaction): Promise<AgentTransaction> {
    try {
      await this.core.claimWithdrawal(tx.core_request_ref!, tx.id);
    } catch (err) {
      if (err instanceof CoreConflictError) {
        const error = err.reason === 'expired' ? Errors.qrExpired() : err.reason === 'already_claimed' ? Errors.qrAlreadyUsed() : Errors.withdrawalCodeInvalid();
        await this.lifecycle.fail(tx, `core_${err.reason}`, error);
        throw error;
      }
      return tx; // Core unreachable: stays processing, reconciler retries.
    }
    const outcome = await this.lifecycle.post(tx);
    if (outcome.kind === 'failed') throw outcome.error;
    return outcome.tx;
  }
}
