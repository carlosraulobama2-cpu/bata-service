/**
 * Contract with Velynt Core (docs/05-api.md §17). Core owns end
 * customers: their identity, status, limits, their confirmation of a
 * deposit and their withdrawal requests. The agent service only ever
 * receives an opaque customer reference and a masked phone.
 */
export interface ResolvedCustomer {
  customerRef: string;
  masked: string;
  canReceive: boolean;
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
  /** A customer's personal QR (BSV1.C...) -> single-use customer token for cash-in. */
  abstract resolveCustomerQr(payload: string): Promise<{ customerToken: string; masked: string } | null>;
  /**
   * Final outcome of a QR payment Core reported with `qr_payment.authorized`.
   * On `failed` Core releases the hold it placed on the customer's wallet.
   */
  abstract settleQrPayment(paymentRequestId: string, outcome: 'completed' | 'failed'): Promise<void>;
}
