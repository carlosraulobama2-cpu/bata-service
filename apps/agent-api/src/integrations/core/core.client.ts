/**
 * Contract with BataPay Core (docs/05-api.md §17). Core owns end
 * customers: their identity, status, limits, their confirmation of a
 * deposit and their withdrawal requests. The agent service only ever
 * receives an opaque customer reference and a masked phone.
 */
/** Customer verification (KYC) status, managed by BataPay in its control panel. */
export type CustomerKycStatus = 'verified' | 'pending' | 'unverified' | 'rejected';

export interface ResolvedCustomer {
  customerRef: string;
  masked: string;
  canReceive: boolean;
  kycStatus: CustomerKycStatus;
}

/**
 * Result of checking name + phone typed by the agent. Only returned when
 * the name matches the customer's registered name; the agent never sees
 * the registered name in full, only "Juan M.".
 */
export interface CustomerVerification extends ResolvedCustomer {
  displayName: string;
  verifiedAt: Date | null;
  /** Single-use, short-lived reference to this customer for the next operation. */
  customerToken: string;
  tokenExpiresAt: Date;
}

export interface WithdrawalRequest {
  id: string;
  customerRef: string;
  masked: string;
  amount: number;
  currency: string;
  expiresAt: Date;
  status: 'active' | 'claimed' | 'cancelled';
  claimedBy: string | null;
}

export class CoreNotFoundError extends Error {}
export class CoreConflictError extends Error {
  constructor(readonly reason: 'already_claimed' | 'expired' | 'not_active') {
    super(reason);
  }
}

export abstract class CoreClient {
  /** Only these customer-hold references are captured by the ledger on cash-out. */
  abstract readonly holdSourceSystem: string;
  abstract resolveCustomer(input: { phone?: string; customerToken?: string }): Promise<ResolvedCustomer | null>;
  /** null = no customer with that phone, or the name does not match (indistinguishable on purpose). */
  abstract verifyCustomer(input: { phone: string; fullName: string }): Promise<CustomerVerification | null>;
  abstract createDepositRequest(input: {
    agentCode: string;
    agentTransactionId: string;
    customerRef: string;
    amount: number;
    currency: string;
    expiresAt: Date;
  }): Promise<{ depositRequestId: string }>;
  abstract cancelDepositRequest(depositRequestId: string): Promise<void>;
  abstract findWithdrawalByCode(code: string): Promise<WithdrawalRequest | null>;
  abstract getWithdrawal(id: string): Promise<WithdrawalRequest | null>;
  /** Atomically marks the request as used by this agent transaction. Idempotent for the same transaction. */
  abstract claimWithdrawal(id: string, agentTransactionId: string): Promise<void>;
  /** Undo a claim when the operation failed definitively (the customer can use the code again). */
  abstract releaseWithdrawalClaim(id: string, agentTransactionId: string): Promise<void>;
}
