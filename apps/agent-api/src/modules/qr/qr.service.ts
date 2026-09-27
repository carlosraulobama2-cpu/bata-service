import { Inject, Injectable } from '@nestjs/common';
import { ENV, Env } from '../../config/env';
import { AuditService } from '../../common/audit/audit.service';
import type { AgentContext } from '../../common/auth/request-context';
import { AGENT_DB, AgentDb, setActor } from '../../common/db/database';
import type { AgentQr, AgentTransaction } from '../../common/db/schema';
import { AppError, Errors } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { CoreClient } from '../../integrations/core/core.client';
import { assertCanOperate, CashOutService } from '../operations/cash-out.service';
import { CodeAttemptsService } from '../operations/code-attempts.service';
import { CommissionsService } from '../operations/commissions.service';
import { LimitsService } from '../operations/limits.service';
import { OperationLifecycleService } from '../operations/operation-lifecycle.service';
import { presentTransaction } from '../operations/presenter';
import { newQrNonce, parseQr, QrCodec } from './qr-codec';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type QrPaymentResult =
  | { result: 'completed' | 'processing'; transaction_reference: string }
  | { result: 'rejected'; reason: string };

/**
 * QR module (docs/07-flujos.md §7):
 *  - collect QR ("Cobrar"): fixed amount, single use, short expiry. Creating
 *    it creates the pending `qr_payment` operation and reserves limits;
 *  - agent static QR ("Mi QR"): identifies the agent, never has an amount;
 *  - unified scan: withdrawal QR -> cash-out, customer QR -> cash-in;
 *  - BataPay Core resolves an agent QR for the paying customer and then
 *    reports the authorized payment, which is posted to the ledger here.
 */
@Injectable()
export class QrService {
  constructor(
    @Inject(AGENT_DB) private readonly db: AgentDb,
    private readonly codec: QrCodec,
    private readonly core: CoreClient,
    private readonly cashOut: CashOutService,
    private readonly limits: LimitsService,
    private readonly commissions: CommissionsService,
    private readonly lifecycle: OperationLifecycleService,
    private readonly audit: AuditService,
    private readonly codeAttempts: CodeAttemptsService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env
  ) {}

  /** What the agent app sees for a QR. Status `expired` is reported as soon as the time is up. */
  present(qr: AgentQr, tx: AgentTransaction | null, agentCode: string) {
    const expired = qr.status === 'active' && qr.expires_at !== null && qr.expires_at <= this.clock.now();
    return {
      qr_id: qr.id,
      kind: qr.kind,
      status: expired ? 'expired' : qr.status,
      payload: this.codec.encode(qr.kind === 'agent_static' ? 'A' : 'K', qr.nonce),
      amount: qr.amount,
      currency: qr.currency,
      expires_at: qr.expires_at?.toISOString() ?? null,
      single_use: qr.single_use,
      transaction: tx ? presentTransaction(tx, agentCode) : null
    };
  }

  async createCollect(agent: AgentContext, input: { amount: number; currency: string }, idempotencyKey: string) {
    assertCanOperate(agent);
    const existing = await this.db.selectFrom('agent.agent_transactions').selectAll().where('agent_id', '=', agent.agentId).where('idempotency_key', '=', idempotencyKey).executeTakeFirst();
    if (existing?.qr_id) return this.get(agent, existing.qr_id);
    if (existing) throw Errors.idempotencyKeyReused();

    const { qr, tx } = await this.db.transaction().execute(async (trx) => {
      await setActor(trx, 'agent', agent.agentCode);
      const createdAt = this.clock.now();
      const expiresAt = new Date(createdAt.getTime() + this.env.QR_COLLECT_TTL_SECONDS * 1000);
      const commission = await this.commissions.quote(trx, 'qr_payment', input.amount, input.currency, agent.tierCode);
      await this.limits.reserve(trx, agent, 'qr_payment', input.amount, input.currency, createdAt);
      const qr = await trx
        .insertInto('agent.agent_qr')
        .values({
          agent_id: agent.agentId,
          kind: 'collect',
          nonce: newQrNonce(),
          amount: input.amount,
          currency: input.currency,
          transaction_id: null,
          single_use: true,
          expires_at: expiresAt,
          used_at: null,
          created_at: createdAt
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const tx = await trx
        .insertInto('agent.agent_transactions')
        .values({
          agent_id: agent.agentId,
          device_id: agent.deviceId,
          session_id: agent.sessionId,
          type: 'qr_payment',
          status: 'pending',
          status_reason: null,
          amount: input.amount,
          currency: input.currency,
          commission_amount: commission.amount,
          commission_rule_id: commission.ruleId,
          customer_ref: null,
          customer_masked: null,
          method: 'qr',
          qr_id: qr.id,
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
      const linked = await trx.updateTable('agent.agent_qr').set({ transaction_id: tx.id }).where('id', '=', qr.id).returningAll().executeTakeFirstOrThrow();
      await trx
        .insertInto('agent.agent_transaction_events')
        .values({ transaction_id: tx.id, from_status: null, to_status: 'pending', event: 'created', actor_type: 'agent', actor_id: agent.agentCode, details: JSON.stringify({ qr_id: qr.id }) })
        .execute();
      await this.audit.record(trx, {
        actorType: 'agent',
        actorId: agent.agentCode,
        agentId: agent.agentId,
        action: 'QR_CREATED',
        resourceType: 'qr',
        resourceId: qr.id,
        result: 'success',
        deviceId: agent.deviceId,
        metadata: { kind: 'collect', amount: input.amount, currency: input.currency, reference: tx.reference }
      });
      return { qr: linked, tx };
    });
    return this.present(qr, tx, agent.agentCode);
  }

  /** The agent's static QR; created on first use (one active per agent). */
  async staticQr(agent: AgentContext) {
    assertCanOperate(agent);
    const find = () =>
      this.db.selectFrom('agent.agent_qr').selectAll().where('agent_id', '=', agent.agentId).where('kind', '=', 'agent_static').where('status', '=', 'active').executeTakeFirst();
    let qr = await find();
    if (!qr) {
      qr = await this.db
        .insertInto('agent.agent_qr')
        .values({ agent_id: agent.agentId, kind: 'agent_static', nonce: newQrNonce(), amount: null, currency: this.env.DEFAULT_CURRENCY, transaction_id: null, single_use: false, expires_at: null, used_at: null })
        .onConflict((oc) => oc.column('agent_id').where('kind', '=', 'agent_static').where('status', '=', 'active').doNothing())
        .returningAll()
        .executeTakeFirst();
      qr ??= await find(); // created concurrently by another request
      if (!qr) throw Errors.internal();
      await this.audit.record(this.db, { actorType: 'agent', actorId: agent.agentCode, agentId: agent.agentId, action: 'QR_CREATED', resourceType: 'qr', resourceId: qr.id, result: 'success', deviceId: agent.deviceId, metadata: { kind: 'agent_static' } });
    }
    return this.present(qr, null, agent.agentCode);
  }

  async get(agent: AgentContext, qrId: string) {
    if (!UUID.test(qrId)) throw Errors.notFound();
    const qr = await this.db.selectFrom('agent.agent_qr').selectAll().where('id', '=', qrId).where('agent_id', '=', agent.agentId).executeTakeFirst();
    if (!qr) throw Errors.notFound();
    const tx = qr.transaction_id ? await this.db.selectFrom('agent.agent_transactions').selectAll().where('id', '=', qr.transaction_id).executeTakeFirst() : undefined;
    return this.present(qr, tx ?? null, agent.agentCode);
  }

  /** Unified scan: the server decides what a code means. */
  async scan(agent: AgentContext, payload: string) {
    assertCanOperate(agent);
    const parsed = parseQr(payload);
    let outcome: { action: string; [k: string]: unknown } | null = null;
    let error: AppError | null = null;
    try {
      if (parsed?.type === 'W') {
        outcome = { action: 'cash_out', withdrawal: await this.cashOut.resolve(agent, { type: 'qr', value: parsed.raw }) };
      } else {
        outcome = await this.codeAttempts.guard(agent.agentId, 'qr', async () => {
          // Agent codes (A/K) are for customers to pay with; anything else is unknown.
          if (parsed?.type !== 'C') throw Errors.qrInvalid();
          const customer = await this.core.resolveCustomerQr(parsed.raw);
          if (!customer) throw Errors.qrInvalid();
          return { action: 'cash_in', customer: { customer_token: customer.customerToken, customer_masked: customer.masked } };
        });
      }
      return outcome;
    } catch (err) {
      error = err instanceof AppError ? err : Errors.internal();
      throw err;
    } finally {
      await this.audit.record(this.db, {
        actorType: 'agent',
        actorId: agent.agentCode,
        agentId: agent.agentId,
        action: 'QR_SCANNED',
        resourceType: 'qr',
        resourceId: null,
        result: error ? 'failure' : 'success',
        reasonCode: error?.code,
        deviceId: agent.deviceId,
        metadata: { type: parsed?.type ?? 'unknown', action: outcome?.action ?? null }
      });
    }
  }

  private async byPayload(payload: string): Promise<AgentQr> {
    const parsed = parseQr(payload);
    if (!parsed || !this.codec.verify(parsed)) throw Errors.qrInvalid();
    const qr = await this.db.selectFrom('agent.agent_qr').selectAll().where('nonce', '=', parsed.id).executeTakeFirst();
    const expectedKind = parsed.type === 'A' ? 'agent_static' : 'collect';
    if (!qr || qr.kind !== expectedKind) throw Errors.qrInvalid();
    return qr;
  }

  private assertPayable(qr: AgentQr): void {
    if (qr.status === 'used') throw Errors.qrAlreadyUsed();
    if (qr.status === 'expired' || (qr.expires_at && qr.expires_at <= this.clock.now())) throw Errors.qrExpired();
    if (qr.status !== 'active') throw Errors.qrInvalid();
  }

  /**
   * Internal API for BataPay Core: the customer scanned an agent QR in the
   * BataPay app. Returns what the customer must be shown before paying.
   */
  async resolveForCore(payload: string) {
    const qr = await this.byPayload(payload);
    this.assertPayable(qr);
    const agent = await this.db
      .selectFrom('agent.agents as a')
      .leftJoin('agent.agent_businesses as b', 'b.agent_id', 'a.id')
      .select(['a.agent_code', 'a.status', 'b.trade_name'])
      .where('a.id', '=', qr.agent_id)
      .executeTakeFirst();
    if (!agent || agent.status !== 'active') throw Errors.qrInvalid();
    return {
      qr_id: qr.id,
      kind: qr.kind,
      agent_code: agent.agent_code,
      merchant_name: agent.trade_name ?? agent.agent_code,
      amount: qr.amount,
      currency: qr.currency,
      expires_at: qr.expires_at?.toISOString() ?? null
    };
  }

  /**
   * Core reports that the customer approved the payment with their PIN and
   * that the amount is on hold in their wallet. Idempotent per payment
   * request. `rejected` tells Core to release the customer's hold.
   */
  async onPaymentAuthorized(event: { payment_request_id: string; qr_id: string; customer_ref: string; customer_masked: string; amount: number; currency: string }): Promise<QrPaymentResult> {
    const qr = UUID.test(event.qr_id) ? await this.db.selectFrom('agent.agent_qr').selectAll().where('id', '=', event.qr_id).executeTakeFirst() : undefined;
    if (!qr || qr.kind !== 'collect' || !qr.transaction_id) return { result: 'rejected', reason: 'QR_INVALID' };
    const tx = await this.db.selectFrom('agent.agent_transactions').selectAll().where('id', '=', qr.transaction_id).executeTakeFirstOrThrow();

    // The same payment delivered again.
    if (tx.core_request_ref === event.payment_request_id) return this.followUp(tx);

    if (tx.status !== 'pending') return { result: 'rejected', reason: tx.status_reason === 'expired' ? 'QR_EXPIRED' : 'QR_ALREADY_USED' };
    if (event.amount !== tx.amount || event.currency !== tx.currency) return { result: 'rejected', reason: 'AMOUNT_MISMATCH' };
    if (tx.expires_at && tx.expires_at <= this.clock.now()) {
      await this.lifecycle.fail(tx, 'expired', Errors.qrExpired(), 'cancelled');
      return { result: 'rejected', reason: 'QR_EXPIRED' };
    }

    const processing = await this.db
      .transaction()
      .execute(async (trx) => {
        await setActor(trx, 'customer', event.customer_ref);
        const locked = await trx.selectFrom('agent.agent_qr').select('status').where('id', '=', qr.id).forUpdate().executeTakeFirstOrThrow();
        if (locked.status !== 'active') return null;
        const row = await this.lifecycle.transition(trx, tx.id, ['pending'], 'processing', 'customer_paid', {
          customer_ref: event.customer_ref,
          customer_masked: event.customer_masked,
          core_request_ref: event.payment_request_id
        });
        if (!row) return null;
        await trx.updateTable('agent.agent_qr').set({ status: 'used', used_at: this.clock.now() }).where('id', '=', qr.id).execute();
        return row;
      })
      .catch((err: { code?: string; constraint?: string }) => {
        // The payment request was already used for another QR.
        if (err.code === '23505' && err.constraint === 'uq_agent_tx_core_request') return null;
        throw err;
      });
    if (!processing) {
      const current = await this.db.selectFrom('agent.agent_transactions').selectAll().where('id', '=', tx.id).executeTakeFirstOrThrow();
      if (current.core_request_ref === event.payment_request_id) return this.followUp(current);
      return { result: 'rejected', reason: current.status_reason === 'expired' ? 'QR_EXPIRED' : 'QR_ALREADY_USED' };
    }
    return this.followUp(processing);
  }

  private async followUp(tx: AgentTransaction): Promise<QrPaymentResult> {
    if (tx.status === 'completed') return { result: 'completed', transaction_reference: tx.reference };
    if (tx.status === 'processing') {
      const outcome = await this.lifecycle.post(tx);
      if (outcome.kind === 'completed') return { result: 'completed', transaction_reference: tx.reference };
      if (outcome.kind === 'unknown') return { result: 'processing', transaction_reference: tx.reference };
      return { result: 'rejected', reason: outcome.error.code };
    }
    return { result: 'rejected', reason: tx.status_reason ?? 'QR_INVALID' };
  }
}
