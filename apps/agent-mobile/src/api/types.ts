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
  /** "1" | "2" | "3" | "enterprise": sets the maximum float and the daily limits. */
  level: string;
  max_float: number;
  created_at: string;
}

export interface AgentUser {
  id: string;
  name: string;
  email: string;
  phone_number: string | null;
  kyc_status: string;
  has_pin: boolean;
  has_avatar?: boolean;
  /** Changes with every new photo: the image is cached by it. */
  avatar_version?: number | null;
}

export interface Me {
  user: AgentUser;
  /** null: this Velynt account has not applied to be an agent. */
  agent: AgentProfile | null;
  /** E-money available to serve deposits. */
  float: number;
  /** Cash in the till: last count and what Velynt expects now. null before the agent is active. */
  cash: CashPosition | null;
  as_of: string;
}

export interface CashPosition {
  declared: number | null;
  declared_at: string | null;
  cash_in_since: number;
  cash_out_since: number;
  expected: number | null;
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

// ---- Reinforced agent verification (velynt/backend/agent_onboarding.py) ----

export type RequirementStatus = 'done' | 'missing' | 'in_review' | 'rejected';

export interface Requirement {
  code: string;
  label: string;
  status: RequirementStatus;
  detail: string;
  /** Whose turn it is: the applicant has to act, or Velynt is checking. */
  who: 'applicant' | 'velynt';
}

export type LegalForm = 'individual' | 'company';
export type Activity = 'shop' | 'pharmacy' | 'phone_shop' | 'kiosk' | 'market_stall' | 'supermarket' | 'service_station' | 'other';

export interface BusinessProfile {
  legal_form: LegalForm | '';
  license_number: string;
  activity: Activity | '';
  years_in_business: number;
  opening_hours: string;
  alt_phone_number: string;
  expected_daily_volume_minor: number;
  float_source: string;
  is_pep: boolean;
  pep_details: string;
  no_criminal_record: boolean;
  rules_version: string;
  rules_accepted_at: string | null;
  site_visit_at: string | null;
  site_visit_ok: boolean | null;
  next_review_at: string | null;
}

export interface VerificationDocument {
  id: string;
  kind: string;
  label: string;
  status: 'pending' | 'approved' | 'rejected';
  review_note: string;
  created_at: string;
}

export interface Onboarding {
  rules_version: string;
  requirements: Requirement[];
  complete_for_applicant: boolean;
  ready_to_approve: boolean;
  profile: BusinessProfile | null;
  documents: { kind: string; label: string; required: boolean; document: VerificationDocument | null }[];
}

export interface BusinessProfileInput {
  legal_form: LegalForm;
  license_number: string;
  activity: Activity;
  years_in_business: number;
  opening_hours: string;
  alt_phone_number: string;
  expected_daily_volume_minor: number;
  float_source: string;
  is_pep: boolean;
  pep_details: string;
  no_criminal_record: boolean;
  accept_rules_version: string;
}

// ---- Float, cash, transfers, customers (velynt/api-agente/agent_routes/network.py) ----

export interface FloatRequest {
  id: string;
  code: string;
  amount: number;
  reason: string;
  payment_reference: string;
  has_proof: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decision_note: string;
  created_at: string;
  decided_at: string | null;
}

export interface FloatMovement {
  id: string;
  code: string;
  kind: 'float_assign' | 'float_withdraw' | 'agent_transfer' | 'liquidity_in' | 'liquidity_out';
  label: string;
  direction: 'in' | 'out';
  amount: number;
  reason: string;
  other_agent: { code: string; business_name: string } | null;
  created_at: string;
}

export interface ServedCustomer {
  customer_id: string | null;
  name: string;
  phone_number: string | null;
  operations: number;
  deposits: number;
  withdrawals: number;
  last_at: string;
}

export interface NearbyAgent {
  code: string;
  business_name: string;
  address: string;
  opening_hours: string;
}

export interface StatsDay {
  date: string;
  cash_in: Figures;
  cash_out: Figures;
  commission: number;
}

export interface Preferences {
  theme: 'system' | 'light' | 'dark';
  hide_balance: boolean;
  language: string;
  notify_payments: boolean;
  notify_security: boolean;
  notify_marketing: boolean;
  notify_agent_float: boolean;
}
