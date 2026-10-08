import { randomUUID } from 'node:crypto';
import { maskPhone } from '@bata/money';
import { Clock } from '../../common/time/clock';
import { randomNumericCode, randomToken } from '../../common/crypto/secrets';
import { customerWallet, LedgerClient } from '../ledger/ledger.client';
import { CoreClient, CoreConflictError, CustomerKycStatus, CustomerVerification, ResolvedCustomer, WithdrawalRequest } from './core.client';
import { displayName, namesMatch } from './name-match';

interface FakeCustomer {
  ref: string;
  phone: string;
  fullName: string;
  status: 'active' | 'blocked';
  kycStatus: CustomerKycStatus;
  verifiedAt: Date | null;
}

const TOKEN_TTL_MS = 5 * 60 * 1000;

interface FakeDeposit {
  id: string;
  agentTransactionId: string;
  customerRef: string;
  amount: number;
  status: 'pending' | 'cancelled';
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
  private readonly tokens = new Map<string, { ref: string; expiresAt: Date }>();
  private readonly withdrawals = new Map<string, WithdrawalRequest & { code: string }>();
  readonly deposits = new Map<string, FakeDeposit>();

  constructor(
    private readonly ledger: LedgerClient,
    private readonly clock: Clock
  ) {
    super();
  }

  // ---- simulator helpers (what the BataPay app / core would do) ----

  async addCustomer(
    phone: string,
    currency = 'XAF',
    initialBalance = 0,
    profile: { fullName?: string; kycStatus?: CustomerKycStatus } = {}
  ): Promise<string> {
    const existing = [...this.customers.values()].find((c) => c.phone === phone);
    if (existing) return existing.ref;
    const ref = `cus_${randomUUID()}`;
    const kycStatus = profile.kycStatus ?? 'verified';
    this.customers.set(ref, {
      ref,
      phone,
      fullName: profile.fullName ?? 'Cliente Demo',
      status: 'active',
      kycStatus,
      verifiedAt: kycStatus === 'verified' ? this.clock.now() : null
    });
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

  /** What the BataPay control panel does when staff approve (or revoke) a customer's verification. */
  setKycStatus(phone: string, kycStatus: CustomerKycStatus): boolean {
    const c = [...this.customers.values()].find((x) => x.phone === phone);
    if (!c) return false;
    c.kycStatus = kycStatus;
    c.verifiedAt = kycStatus === 'verified' ? this.clock.now() : null;
    return true;
  }

  issueCustomerToken(ref: string): string {
    const token = `ctk_${randomToken(16)}`;
    this.tokens.set(token, { ref, expiresAt: new Date(this.clock.now().getTime() + TOKEN_TTL_MS) });
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

  // ---- CoreClient contract ----

  async resolveCustomer(input: { phone?: string; customerToken?: string }): Promise<ResolvedCustomer | null> {
    let customer: FakeCustomer | undefined;
    if (input.customerToken) {
      const entry = this.tokens.get(input.customerToken);
      this.tokens.delete(input.customerToken); // single use
      customer = entry && entry.expiresAt > this.clock.now() ? this.customers.get(entry.ref) : undefined;
    } else if (input.phone) {
      customer = [...this.customers.values()].find((c) => c.phone === input.phone);
    }
    if (!customer) return null;
    return { customerRef: customer.ref, masked: maskPhone(customer.phone), canReceive: customer.status === 'active', kycStatus: customer.kycStatus };
  }

  async verifyCustomer(input: { phone: string; fullName: string }): Promise<CustomerVerification | null> {
    const customer = [...this.customers.values()].find((c) => c.phone === input.phone);
    if (!customer || !namesMatch(input.fullName, customer.fullName)) return null;
    const customerToken = this.issueCustomerToken(customer.ref);
    return {
      customerRef: customer.ref,
      masked: maskPhone(customer.phone),
      canReceive: customer.status === 'active',
      kycStatus: customer.kycStatus,
      displayName: displayName(customer.fullName),
      verifiedAt: customer.verifiedAt,
      customerToken,
      tokenExpiresAt: this.tokens.get(customerToken)!.expiresAt
    };
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
