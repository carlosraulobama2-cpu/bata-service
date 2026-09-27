/**
 * Contract with the Ledger service (docs/05-api.md §17).
 * The Agent service never writes ledger tables itself: it goes through
 * this client. LocalLedgerClient calls the ledger SQL functions directly
 * (development / single-database deployments); an HTTP implementation
 * against the Ledger internal API replaces it when the Ledger runs as its
 * own service.
 */
export type OwnerType = 'customer' | 'agent' | 'system';

export interface AccountRef {
  ownerType: OwnerType;
  ownerRef: string;
  purpose: string;
  currency: string;
}

export interface HoldRef {
  sourceSystem: string;
  externalRef: string;
  account: AccountRef;
}

export interface LedgerEntryInput {
  account: AccountRef;
  direction: 'D' | 'C';
  amount: number;
}

export interface PostTransactionInput {
  reference: string;
  idempotencyKey: string;
  kind: 'cash_in' | 'cash_out' | 'qr_payment' | 'float_topup' | 'commission' | 'settlement' | 'adjustment';
  externalRef: string;
  entries: LedgerEntryInput[];
  captureHolds?: HoldRef[];
  description?: string;
}

export interface Balance {
  balance: number;
  held: number;
  available: number;
}

export class LedgerInsufficientFundsError extends Error {
  constructor(readonly account: AccountRef | null) {
    super('LEDGER_INSUFFICIENT_FUNDS');
  }
}

/** A definite, non-retryable refusal by the ledger (unbalanced, frozen account...). */
export class LedgerRejectedError extends Error {}

export abstract class LedgerClient {
  abstract readonly sourceSystem: string;
  abstract openAccount(ref: AccountRef, type: 'asset' | 'liability' | 'revenue' | 'expense', options?: { trackBalance?: boolean }): Promise<string>;
  abstract createHold(input: { account: AccountRef; amount: number; externalRef: string; expiresAt: Date; sourceSystem?: string }): Promise<string>;
  abstract closeHold(input: { account: AccountRef; externalRef: string; status: 'released' | 'expired'; sourceSystem?: string }): Promise<void>;
  abstract post(input: PostTransactionInput): Promise<{ transactionId: string }>;
  abstract findTransaction(idempotencyKey: string): Promise<{ transactionId: string } | null>;
  abstract getBalance(account: AccountRef): Promise<Balance>;
  abstract close(): Promise<void>;
}

export const SYSTEM_ACCOUNTS = {
  bank: (currency: string): AccountRef => ({ ownerType: 'system', ownerRef: 'bank', purpose: 'settlement_bank', currency }),
  commissionExpense: (currency: string): AccountRef => ({ ownerType: 'system', ownerRef: 'commissions', purpose: 'commission_expense', currency }),
  feeRevenue: (currency: string): AccountRef => ({ ownerType: 'system', ownerRef: 'fees', purpose: 'fee_revenue', currency })
};

export const agentFloat = (agentCode: string, currency: string): AccountRef => ({ ownerType: 'agent', ownerRef: agentCode, purpose: 'agent_float', currency });
export const agentCommission = (agentCode: string, currency: string): AccountRef => ({
  ownerType: 'agent',
  ownerRef: agentCode,
  purpose: 'agent_commission_payable',
  currency
});
export const customerWallet = (customerRef: string, currency: string): AccountRef => ({
  ownerType: 'customer',
  ownerRef: customerRef,
  purpose: 'customer_wallet',
  currency
});
