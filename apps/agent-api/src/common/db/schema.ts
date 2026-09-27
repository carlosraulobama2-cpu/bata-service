import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';

/**
 * Kysely table types for the "agent" schema (db/02_agent.sql).
 * Only the columns the service uses are typed. BIGINT money columns are
 * parsed to JS numbers (see database.ts) and checked to be safe integers.
 */
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type Json<T = Record<string, unknown>> = ColumnType<T, string | undefined, string>;

export interface AgentsTable {
  id: Generated<string>;
  agent_code: string | null;
  status: string;
  status_reason: string | null;
  tier_code: string | null;
  country: string;
  phone_e164: string;
  email: string | null;
  region: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  activated_by: string | null;
  activated_at: Date | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AgentProfilesTable {
  agent_id: string;
  first_name: string;
  last_name: string;
  city: string | null;
  country: string | null;
  preferred_language: Generated<string>;
}

export interface AgentBusinessesTable {
  id: Generated<string>;
  agent_id: string;
  trade_name: string;
  business_type: string;
  address_line: string;
  city: string;
  country: string;
}

export interface AgentTiersTable {
  code: string;
  name: string;
}

export interface StaffUsersTable {
  id: Generated<string>;
  email: string;
  full_name: string;
}

export interface AgentCredentialsTable {
  agent_id: string;
  pin_hash: string;
  pin_set_at: Timestamp;
  failed_attempts: Generated<number>;
  locked_until: Date | null;
  lock_count: Generated<number>;
  must_change_pin: Generated<boolean>;
}

export interface AgentOtpChallengesTable {
  id: Generated<string>;
  agent_id: string;
  purpose: string;
  channel: string;
  code_hash: string;
  attempts: Generated<number>;
  max_attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
  context: Json<DeviceContext>;
  created_at: Timestamp;
}

export interface DeviceContext {
  installation_id: string;
  platform: 'android' | 'ios' | 'web';
  model?: string;
  os_version?: string;
  app_version?: string;
}

export interface AgentDevicesTable {
  id: Generated<string>;
  agent_id: string;
  installation_id: string;
  public_key: string;
  biometric_public_key: string | null;
  key_algorithm: string;
  platform: string;
  model: string | null;
  os_version: string | null;
  app_version: string | null;
  biometric_enabled: Generated<boolean>;
  push_token: string | null;
  status: string;
  trusted_at: Date | null;
  cooldown_until: Date | null;
  last_seen_at: Date | null;
  last_ip: string | null;
  approx_location: string | null;
  revoked_at: Date | null;
  revoked_by: string | null;
  revoked_reason: string | null;
  created_at: Timestamp;
}

export interface AgentSessionsTable {
  id: Generated<string>;
  agent_id: string;
  device_id: string;
  token_family: string;
  refresh_token_hash: string;
  status: string;
  auth_level: string;
  created_at: Timestamp;
  last_used_at: Date | null;
  idle_expires_at: Date;
  absolute_expires_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
  ip: string | null;
}

export interface AgentAccessEventsTable {
  id: Generated<string>;
  agent_id: string | null;
  phone_hmac: string | null;
  event: string;
  device_id: string | null;
  ip: string | null;
  approx_location: string | null;
  created_at: Timestamp;
}

export interface LimitPoliciesTable {
  id: Generated<string>;
  tier_code: string;
  operation_type: string;
  currency: string;
  per_tx_min: number;
  per_tx_max: number;
  daily_amount_max: number;
  daily_count_max: number | null;
  monthly_amount_max: number;
  version: number;
  effective_from: Timestamp;
  effective_to: Date | null;
}

export interface AgentLimitsTable {
  id: Generated<string>;
  agent_id: string;
  operation_type: string;
  currency: string;
  per_tx_max: number | null;
  daily_amount_max: number | null;
  daily_count_max: number | null;
  monthly_amount_max: number | null;
  status: string;
  valid_from: Timestamp;
  valid_to: Date | null;
}

export interface AgentLimitUsageTable {
  agent_id: string;
  operation_type: string;
  period_type: 'day' | 'month';
  period_start: string;
  currency: string;
  amount: Generated<number>;
  count: Generated<number>;
}

export interface AgentBalancesTable {
  agent_id: string;
  balance_type: 'float' | 'commission';
  currency: string;
  ledger_account_id: string;
  ledger_balance: Generated<number>;
  available_balance: Generated<number>;
  ledger_version: Generated<number>;
  refreshed_at: Timestamp;
}

export interface AgentTransactionsTable {
  id: Generated<string>;
  reference: Generated<string>;
  agent_id: string;
  device_id: string | null;
  session_id: string | null;
  type: string;
  status: Generated<string>;
  status_reason: string | null;
  amount: number;
  currency: string;
  fee_amount: Generated<number>;
  commission_amount: Generated<number>;
  commission_rule_id: string | null;
  customer_ref: string | null;
  customer_masked: string | null;
  method: string;
  qr_id: string | null;
  core_request_ref: string | null;
  idempotency_key: string;
  ledger_hold_id: string | null;
  ledger_transaction_id: string | null;
  risk_level: string | null;
  expires_at: Date | null;
  completed_at: Date | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AgentQrTable {
  id: Generated<string>;
  agent_id: string;
  kind: 'agent_static' | 'collect' | 'deposit';
  nonce: string;
  amount: number | null;
  currency: string;
  transaction_id: string | null;
  single_use: boolean;
  status: Generated<'active' | 'used' | 'expired' | 'revoked'>;
  expires_at: Date | null;
  used_at: Date | null;
  created_at: Timestamp;
}

export interface AgentTransactionEventsTable {
  id: Generated<string>;
  transaction_id: string;
  from_status: string | null;
  to_status: string;
  event: string;
  actor_type: string;
  actor_id: string | null;
  details: Json;
  created_at: Timestamp;
}

export interface CommissionPlansTable {
  id: Generated<string>;
  code: string;
  version: number;
  name: string;
  currency: string;
  status: string;
  effective_from: Date | null;
  effective_to: Date | null;
  created_by: string | null;
  approved_by: string | null;
}

export interface CommissionRulesTable {
  id: Generated<string>;
  plan_id: string;
  operation_type: string;
  tier_code: string | null;
  amount_from: Generated<number>;
  amount_to: number | null;
  fixed_amount: Generated<number>;
  rate_bps: Generated<number>;
  min_amount: number | null;
  max_amount: number | null;
}

export interface AgentCommissionsTable {
  id: Generated<string>;
  agent_id: string;
  transaction_id: string;
  rule_id: string;
  operation_type: string;
  base_amount: number;
  commission_amount: number;
  currency: string;
  status: Generated<string>;
  settlement_id: string | null;
  ledger_transaction_id: string;
  accrued_at: Timestamp;
}

export interface AgentCommissionDailyTable {
  agent_id: string;
  day: string;
  operation_type: string;
  currency: string;
  count: Generated<number>;
  amount: Generated<number>;
}

export interface AgentNotificationsTable {
  id: Generated<string>;
  agent_id: string;
  type: string;
  title_key: string;
  body_key: string;
  params: Json;
  related_transaction_id: string | null;
  created_at: Timestamp;
  read_at: Date | null;
}

export interface AgentPinHistoryTable {
  id: Generated<string>;
  agent_id: string;
  pin_hash: string;
  created_at: Timestamp;
}

export interface AgentCodeFailuresTable {
  id: Generated<string>;
  agent_id: string;
  kind: 'withdrawal_code' | 'qr';
  created_at: Timestamp;
}

export interface AgentNotificationDeliveriesTable {
  id: Generated<string>;
  notification_id: string;
  channel: 'push' | 'sms' | 'email';
  status: Generated<'queued' | 'sent' | 'failed' | 'skipped'>;
  provider_ref: string | null;
  attempts: Generated<number>;
  last_error: string | null;
  sent_to: Generated<number>;
  next_attempt_at: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AgentNotificationPreferencesTable {
  agent_id: string;
  type: string;
  push_enabled: boolean;
}

export interface IdempotencyKeysTable {
  agent_id: string;
  key: string;
  endpoint: string;
  request_hash: string;
  status: Generated<string>;
  response_code: number | null;
  response_body: Json<unknown> | null;
  created_at: Timestamp;
  expires_at: Timestamp;
}

export interface OutboxEventsTable {
  id: Generated<string>;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Json;
  created_at: Timestamp;
  published_at: Date | null;
}

export interface AgentAuditLogsTable {
  id: Generated<string>;
  occurred_at: Timestamp;
  stream: string;
  actor_type: string;
  actor_id: string | null;
  agent_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  result: string;
  reason_code: string | null;
  device_id: string | null;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  metadata: Json;
  prev_hash: Buffer | null;
  hash: Generated<Buffer>;
}

export interface AgentDatabase {
  'agent.agents': AgentsTable;
  'agent.agent_profiles': AgentProfilesTable;
  'agent.agent_businesses': AgentBusinessesTable;
  'agent.agent_tiers': AgentTiersTable;
  'agent.staff_users': StaffUsersTable;
  'agent.agent_credentials': AgentCredentialsTable;
  'agent.agent_otp_challenges': AgentOtpChallengesTable;
  'agent.agent_devices': AgentDevicesTable;
  'agent.agent_sessions': AgentSessionsTable;
  'agent.agent_access_events': AgentAccessEventsTable;
  'agent.limit_policies': LimitPoliciesTable;
  'agent.agent_limits': AgentLimitsTable;
  'agent.agent_limit_usage': AgentLimitUsageTable;
  'agent.agent_balances': AgentBalancesTable;
  'agent.agent_qr': AgentQrTable;
  'agent.agent_pin_history': AgentPinHistoryTable;
  'agent.agent_code_failures': AgentCodeFailuresTable;
  'agent.agent_transactions': AgentTransactionsTable;
  'agent.agent_transaction_events': AgentTransactionEventsTable;
  'agent.commission_plans': CommissionPlansTable;
  'agent.commission_rules': CommissionRulesTable;
  'agent.agent_commissions': AgentCommissionsTable;
  'agent.agent_commission_daily': AgentCommissionDailyTable;
  'agent.agent_notifications': AgentNotificationsTable;
  'agent.agent_notification_deliveries': AgentNotificationDeliveriesTable;
  'agent.agent_notification_preferences': AgentNotificationPreferencesTable;
  'agent.idempotency_keys': IdempotencyKeysTable;
  'agent.outbox_events': OutboxEventsTable;
  'agent.agent_audit_logs': AgentAuditLogsTable;
}

export type Agent = Selectable<AgentsTable>;
export type AgentTransaction = Selectable<AgentTransactionsTable>;
export type AgentQr = Selectable<AgentQrTable>;
export type AgentDevice = Selectable<AgentDevicesTable>;
export type NewAgentTransaction = Insertable<AgentTransactionsTable>;
