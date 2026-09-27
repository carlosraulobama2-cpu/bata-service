/** Shapes returned by the Agent API (docs/05-api.md). */
export type TransactionType = 'cash_in' | 'cash_out' | 'qr_payment' | 'commission' | 'settlement' | 'refund' | 'authorized_adjustment';
export type TransactionStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'reversed' | 'cancelled' | 'disputed';

export interface Transaction {
  id: string;
  reference: string;
  type: TransactionType;
  status: TransactionStatus;
  status_reason: string | null;
  amount: number;
  currency: string;
  commission: number;
  fee: number;
  customer_masked: string | null;
  agent_code: string;
  method: string;
  created_at: string;
  completed_at: string | null;
  expires_at: string | null;
  next_action: string | null;
  events?: { status: string; event: string; at: string }[];
}

export interface Me {
  agent: {
    agent_code: string;
    first_name: string | null;
    last_name_initial: string | null;
    status: string;
    tier: { code: string; name: string } | null;
    location: { city: string | null; country: string };
    business: { trade_name: string } | null;
  };
  features: string[];
  device: { id: string; cooldown_until: string | null };
  min_app_version: string;
}

export interface Balance {
  float: { currency: string; available: number; held: number; ledger_balance: number; as_of: string };
  commissions_pending: { currency: string; amount: number };
  declared_cash: { amount: number; declared_at: string } | null;
}

export interface Totals {
  cash_in: number;
  cash_out: number;
  qr_payment: number;
  commissions: number;
  currency: string;
}

export interface TransactionPage {
  data: Transaction[];
  totals: Totals;
  next_cursor: string | null;
}

export interface LimitView {
  operation_type: 'cash_in' | 'cash_out' | 'qr_payment';
  currency: string;
  per_transaction: { min: number; max: number };
  daily: { max: number; used: number; remaining: number; count_max: number | null; count_used: number };
  monthly: { max: number; used: number; remaining: number };
  cooldown_applied: boolean;
}

export interface Limits {
  tier: string | null;
  cooldown_until: string | null;
  limits: LimitView[];
}

export interface WithdrawalPreview {
  withdrawal_request_id: string;
  amount: number;
  currency: string;
  customer_masked: string;
  expires_at: string;
  commission: number;
}

export type QrStatus = 'active' | 'used' | 'expired' | 'revoked';

export interface AgentQr {
  qr_id: string;
  kind: 'collect' | 'agent_static';
  status: QrStatus;
  payload: string;
  amount: number | null;
  currency: string;
  expires_at: string | null;
  single_use: boolean;
  transaction: Transaction | null;
}

export type ScanResult =
  | { action: 'cash_out'; withdrawal: WithdrawalPreview }
  | { action: 'cash_in'; customer: { customer_token: string; customer_masked: string } };

export type LoginResponse =
  | { status: 'authenticated'; access_token: string; refresh_token: string; access_token_expires_in: number; agent: { agent_code: string; first_name: string | null; status: string } }
  | { status: 'otp_required'; challenge_id: string; destination_masked: string; expires_in: number; reason: string };

export type StepUp = { method: 'pin'; pin: string } | { method: 'biometric' };
