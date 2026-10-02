/**
 * Shapes the app works with. They come from the Velynt agents API (velynt/api-agente, `/agent/v1`)
 * through `endpoints.ts`, which turns the API's `*_minor` fields into plain amounts. XAF has no
 * cents: every amount is whole francs.
 */
export type TransactionType = 'cash_in' | 'cash_out';
/** The agents API only returns operations that already moved money. */
export type TransactionStatus = 'completed';

/** Masked on purpose by the server: enough to confirm with the customer, nothing more. */
export interface Customer {
  id: string;
  public_id: string;
  name: string;
  phone_number: string | null;
}

export interface Transaction {
  id: string;
  reference: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: number;
  /** What the customer paid on top (withdrawals only). */
  fee: number;
  commission: number;
  customer: Customer | null;
  /** "María N. O. · +240 •••• 4821" */
  customer_masked: string | null;
  agent_code: string;
  agent_name: string;
  created_at: string;
}

export type AgentStatus = 'pending' | 'active' | 'suspended' | 'rejected';

export interface AgentProfile {
  id: string;
  code: string;
  business_name: string;
  city: string;
  address: string;
  status: AgentStatus;
  status_note: string;
  daily_cash_in_limit: number;
  daily_cash_out_limit: number;
  created_at: string;
}

export interface AgentUser {
  id: string;
  name: string;
  email: string;
  phone_number: string | null;
  kyc_status: string;
  has_pin: boolean;
}

export interface Me {
  user: AgentUser;
  /** null: this Velynt account has not applied to be an agent. */
  agent: AgentProfile | null;
  /** E-money available to serve deposits. */
  float: number;
  as_of: string;
}

export interface Figures {
  count: number;
  volume: number;
  commission: number;
}

export interface Totals {
  cash_in: Figures;
  cash_out: Figures;
  commission: number;
}

export interface TransactionPage {
  data: Transaction[];
  totals: Totals;
  next_offset: number | null;
}

export interface LimitView {
  operation_type: TransactionType;
  daily: { max: number; used: number; remaining: number };
}

export interface Limits {
  limits: LimitView[];
}

export interface WithdrawalPreview {
  cashout_id: string;
  amount: number;
  fee: number;
  expires_at: string;
  customer: Customer;
  customer_masked: string;
  /** The code that unlocked it (from the QR or typed by the agent); sent again to complete. */
  code: string;
}

export interface TopupPreview {
  topup_id: string;
  amount: number;
  expires_at: string;
  customer: Customer;
  customer_masked: string;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  related_operation_id: string | null;
  created_at: string;
  read_at: string | null;
}

export interface NotificationPage {
  data: AppNotification[];
  unread_count: number;
  next_offset: number | null;
}

export interface CommissionSummary {
  today: number;
  last_7_days: number;
  this_month: number;
  by_type_this_month: { operation_type: TransactionType; count: number; amount: number }[];
}

/** How the agent confirms: the payment PIN, typed or unlocked from the keystore with biometrics. */
export type StepUp = { method: 'pin'; pin: string } | { method: 'biometric' };
