import { randomUUID } from 'node:crypto';
import { maskPhone } from '@bata/money';
import { Clock } from '../../common/time/clock';
import { randomNumericCode, randomToken } from '../../common/crypto/secrets';
import { customerWallet, LedgerClient } from '../ledger/ledger.client';
import { CoreClient, CoreConflictError, ResolvedCustomer, WithdrawalRequest } from './core.client';

interface FakeCustomer {
  ref: string;
  phone: string;
  status: 'active' | 'blocked';
}

interface FakeDeposit {
  id: string;
  agentTransactionId: string;
  customerRef: string;
  amount: number;
  status: 'pending' | 'cancelled';
}

export interface FakeQrPayment {
  id: string;
  customerRef: string;
  amount: number;
  currency: string;
  status: 'authorized' | 'completed' | 'failed';
}

/**
 * In-memory simulator of BataPay Core for development and tests.
 * It creates real customer wallets and holds in the ledger so that the
 * money side behaves exactly as in production. Never enabled in production
 * (see config/env.ts).
 */
export class FakeCoreClient extends CoreClient {
  readonly holdSourceSystem = 'batapay-core';
  private readonly customers = new Map<string, FakeCustomer>();
  private readonly tokens = new Map<string, string>();
  private readonly withdrawals = new Map<string, WithdrawalRequest & { code: string }>();
  readonly deposits = new Map<string, FakeDeposit>();
  private readonly customerQrs = new Map<string, string>();
  readonly qrPayments = new Map<string, FakeQrPayment>();

  constructor(
    private readonly ledger: LedgerClient,
    private readonly clock: Clock
  ) {
    super();
  }

  // ---- simulator helpers (what the BataPay app / core would do) ----

  async addCustomer(phone: string, currency = 'XAF', initialBalance = 0): Promise<string> {
    const existing = [...this.customers.values()].find((c) => c.phone === phone);
    if (existing) return existing.ref;
    const ref = `cus_${randomUUID()}`;
    this.customers.set(ref, { ref, phone, status: 'active' });
    await this.ledger.openAccount(customerWallet(ref, currency), 'liability');
    if (initialBalance > 0) {
      await this.ledger.post({
        reference: `DEV-TOPUP-${ref.slice(-8)}`,
        idempotencyKey: `dev-topup-${ref}`,
        kind: 'adjustment',
        externalRef: ref,
        description: 'Development customer balance',
        entries: [
          { account: { ownerType: 'system', ownerRef: 'bank', purpose: 'settlement_bank', currency }, direction: 'D', amount: initialBalance },
          { account: customerWallet(ref, currency), direction: 'C', amount: initialBalance }
        ]
      });
    }
    return ref;
  }

  blockCustomer(ref: string): void {
    const c = this.customers.get(ref);
    if (c) c.status = 'blocked';
  }

  issueCustomerToken(ref: string): string {
    const token = `ctk_${randomToken(16)}`;
    this.tokens.set(token, ref);
    return token;
  }

  /** The customer asks to withdraw cash: Core reserves the amount in their wallet. */
  async createWithdrawal(customerRef: string, amount: number, currency = 'XAF', ttlSeconds = 600): Promise<{ id: string; code: string; qr: string }> {
    const id = `wdr_${randomUUID()}`;
    const code = randomNumericCode(9);
    const expiresAt = new Date(this.clock.now().getTime() + ttlSeconds * 1000);
    await this.ledger.createHold({
      account: customerWallet(customerRef, currency),
      amount,
      externalRef: id,
      expiresAt,
      sourceSystem: this.holdSourceSystem
    });
    const customer = this.customers.get(customerRef);
    this.withdrawals.set(id, {
      id,
      code,
      customerRef,
      masked: maskPhone(customer?.phone ?? ''),
      amount,
      currency,
      expiresAt,
      status: 'active',
      claimedBy: null
    });
    return { id, code, qr: `BSV1.W.${id}` };
  }

  /** The customer's personal QR in the BataPay app (identifies them for a deposit). */
  issueCustomerQr(ref: string): string {
    const id = randomToken(16);
    this.customerQrs.set(id, ref);
    return `BSV1.C.${id}`;
  }

  /**
   * The customer approved paying an agent's collect QR with their PIN:
   * Core reserves the amount in their wallet (the agent service captures it).
   */
  async authorizeQrPayment(customerRef: string, amount: number, currency = 'XAF'): Promise<{ paymentRequestId: string; masked: string }> {
    const id = `pay_${randomUUID()}`;
    await this.ledger.createHold({
      account: customerWallet(customerRef, currency),
      amount,
      externalRef: id,
      expiresAt: new Date(this.clock.now().getTime() + 15 * 60 * 1000),
      sourceSystem: this.holdSourceSystem
    });
    this.qrPayments.set(id, { id, customerRef, amount, currency, status: 'authorized' });
    return { paymentRequestId: id, masked: maskPhone(this.customers.get(customerRef)?.phone ?? '') };
  }

  // ---- CoreClient contract ----

  async resolveCustomerQr(payload: string): Promise<{ customerToken: string; masked: string } | null> {
    const id = payload.trim().startsWith('BSV1.C.') ? payload.trim().slice('BSV1.C.'.length) : null;
    const ref = id ? this.customerQrs.get(id) : undefined;
    const customer = ref ? this.customers.get(ref) : undefined;
    if (!customer || customer.status !== 'active') return null;
    return { customerToken: this.issueCustomerToken(customer.ref), masked: maskPhone(customer.phone) };
  }

  async settleQrPayment(paymentRequestId: string, outcome: 'completed' | 'failed'): Promise<void> {
    const p = this.qrPayments.get(paymentRequestId);
    if (!p || p.status !== 'authorized') return;
    p.status = outcome;
    if (outcome === 'failed') {
      await this.ledger
        .closeHold({ account: customerWallet(p.customerRef, p.currency), externalRef: p.id, status: 'released', sourceSystem: this.holdSourceSystem })
        .catch(() => undefined);
    }
  }


  async resolveCustomer(input: { phone?: string; customerToken?: string }): Promise<ResolvedCustomer | null> {
    let customer: FakeCustomer | undefined;
    if (input.customerToken) {
      const ref = this.tokens.get(input.customerToken);
      this.tokens.delete(input.customerToken); // single use
      customer = ref ? this.customers.get(ref) : undefined;
    } else if (input.phone) {
      customer = [...this.customers.values()].find((c) => c.phone === input.phone);
    }
    if (!customer) return null;
    return { customerRef: customer.ref, masked: maskPhone(customer.phone), canReceive: customer.status === 'active' };
  }

  async createDepositRequest(input: { agentTransactionId: string; customerRef: string; amount: number }): Promise<{ depositRequestId: string }> {
    const existing = [...this.deposits.values()].find((d) => d.agentTransactionId === input.agentTransactionId);
    if (existing) return { depositRequestId: existing.id };
    const id = `dep_${randomUUID()}`;
    this.deposits.set(id, { id, agentTransactionId: input.agentTransactionId, customerRef: input.customerRef, amount: input.amount, status: 'pending' });
    return { depositRequestId: id };
  }

  async cancelDepositRequest(depositRequestId: string): Promise<void> {
    const d = this.deposits.get(depositRequestId);
    if (d) d.status = 'cancelled';
  }

  async findWithdrawalByCode(code: string): Promise<WithdrawalRequest | null> {
    const normalized = code.replace(/\s/g, '');
    const qrId = normalized.startsWith('BSV1.W.') ? normalized.slice('BSV1.W.'.length) : null;
    const found = [...this.withdrawals.values()].find((w) => (qrId ? w.id === qrId : w.code === normalized));
    return found ? this.withStatus(found) : null;
  }

  async getWithdrawal(id: string): Promise<WithdrawalRequest | null> {
    const w = this.withdrawals.get(id);
    return w ? this.withStatus(w) : null;
  }

  async claimWithdrawal(id: string, agentTransactionId: string): Promise<void> {
    const w = this.withdrawals.get(id);
    if (!w) throw new CoreConflictError('not_active');
    if (w.status === 'claimed') {
      if (w.claimedBy === agentTransactionId) return;
      throw new CoreConflictError('already_claimed');
    }
    if (w.status !== 'active') throw new CoreConflictError('not_active');
    if (w.expiresAt <= this.clock.now()) throw new CoreConflictError('expired');
    w.status = 'claimed';
    w.claimedBy = agentTransactionId;
  }

  async releaseWithdrawalClaim(id: string, agentTransactionId: string): Promise<void> {
    const w = this.withdrawals.get(id);
    if (w && w.status === 'claimed' && w.claimedBy === agentTransactionId) {
      w.status = 'active';
      w.claimedBy = null;
    }
  }

  private withStatus(w: WithdrawalRequest & { code: string }): WithdrawalRequest {
    const { code: _code, ...rest } = w;
    return { ...rest };
  }
}
