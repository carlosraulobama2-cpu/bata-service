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

export interface CommissionSummary {
  currency: string;
  today: number;
  last_7_days: number;
  this_month: number;
  all_time: number;
  pending_settlement: number;
  by_type_this_month: { operation_type: TransactionType; count: number; amount: number }[];
}

export interface CommissionLine {
  id: string;
  transaction_id: string;
  reference: string;
  operation_type: TransactionType;
  base_amount: number;
  commission: number;
  currency: string;
  status: 'accrued' | 'in_settlement' | 'settled' | 'reversed';
  accrued_at: string;
}

export interface AppNotification {
  id: string;
  type: string;
  title_key: string;
  body_key: string;
  params: Record<string, unknown>;
  related_transaction_id: string | null;
  created_at: string;
  read_at: string | null;
}

export interface NotificationPage {
  data: AppNotification[];
  unread_count: number;
  next_cursor: string | null;
}

export interface SecurityOverview {
  this_device: { id: string; model: string | null; platform: string; trusted_at: string | null; cooldown_until: string | null };
  biometric_enabled: boolean;
  pin: { set_at: string; must_change: boolean };
  previous_login: { at: string; device_model: string | null; ip_masked: string | null; approx_location: string | null } | null;
  active_sessions: number;
  trusted_devices: number;
  failed_attempts_last_7_days: number;
}

export interface DeviceInfo {
  id: string;
  model: string | null;
  platform: string;
  os_version: string | null;
  app_version: string | null;
  status: 'trusted' | 'revoked';
  current: boolean;
  trusted_at: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
}

export interface SessionInfo {
  id: string;
  current: boolean;
  device_model: string | null;
  platform: string;
  ip_masked: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface AccessEvent {
  id: string;
  event: string;
  at: string;
  device_model: string | null;
  ip_masked: string | null;
  approx_location: string | null;
}
