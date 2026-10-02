-- =====================================================================
-- VELYNT SERVICES — AGENT SERVICE DATABASE
-- PostgreSQL 15+
--
-- Owned by the Agent service. It holds agent identity, onboarding, KYC
-- metadata, devices, sessions, limits, the agent-side view of
-- operations, commissions, settlements, QR, notifications, support and
-- audit.
--
-- It does NOT hold money. Balances shown to agents come from the Ledger
-- (agent_balances is a read-model projection). References to the ledger
-- and to BataPay core (customers) are opaque ids without foreign keys,
-- because they live in other services/databases.
--
-- Money: BIGINT in currency minor units (XAF = 0 decimals).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS agent;

-- =====================================================================
-- REFERENCE DATA
-- =====================================================================

CREATE TABLE agent.agent_tiers (
  code         TEXT PRIMARY KEY,                -- e.g. 'tier_1', 'tier_2', 'tier_3' (names por confirmar)
  name         TEXT NOT NULL,
  description  TEXT,
  active       BOOLEAN NOT NULL DEFAULT TRUE
);

-- =====================================================================
-- STAFF + RBAC (back-office users: SUPERVISOR, ADMIN, COMPLIANCE,
-- SUPPORT, FINANCE). Agents have the implicit role AGENT.
-- In production staff authenticate through the corporate IdP (SSO+MFA).
-- =====================================================================

CREATE TABLE agent.staff_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  idp_subject   TEXT UNIQUE,                    -- subject in the corporate identity provider
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent.roles (
  code         TEXT PRIMARY KEY CHECK (code IN ('AGENT', 'SUPERVISOR', 'ADMIN', 'COMPLIANCE', 'SUPPORT', 'FINANCE')),
  description  TEXT NOT NULL
);

CREATE TABLE agent.permissions (
  code         TEXT PRIMARY KEY,                -- e.g. 'cash_in:create', 'agent:approve'
  description  TEXT NOT NULL
);

CREATE TABLE agent.role_permissions (
  role_code        TEXT NOT NULL REFERENCES agent.roles (code),
  permission_code  TEXT NOT NULL REFERENCES agent.permissions (code),
  PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE agent.staff_role_assignments (
  staff_id     UUID NOT NULL REFERENCES agent.staff_users (id),
  role_code    TEXT NOT NULL REFERENCES agent.roles (code) CHECK (role_code <> 'AGENT'),
  scope        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- e.g. {"regions": ["Litoral"]} for SUPERVISOR
  granted_by   UUID NOT NULL REFERENCES agent.staff_users (id),
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (staff_id, role_code),
  CHECK (granted_by <> staff_id)                     -- nobody grants themselves a role
);

-- =====================================================================
-- AGENTS
-- =====================================================================

CREATE SEQUENCE agent.agent_code_seq START 1;

CREATE TABLE agent.agents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_code      TEXT UNIQUE,                  -- AG-000001, assigned on approval
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                    'pending', 'under_review', 'approved', 'active',
                    'suspended', 'rejected', 'blocked', 'terminated')),
  status_reason   TEXT,
  tier_code       TEXT REFERENCES agent.agent_tiers (code),
  country         CHAR(2) NOT NULL,             -- ISO 3166-1 alpha-2, e.g. 'GQ'
  phone_e164      TEXT NOT NULL UNIQUE CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email           CITEXT UNIQUE,
  region          TEXT,                         -- operating area (for supervisors)
  supervisor_staff_id UUID REFERENCES agent.staff_users (id),
  approved_by     UUID REFERENCES agent.staff_users (id),
  approved_at     TIMESTAMPTZ,
  activated_by    UUID REFERENCES agent.staff_users (id),
  activated_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('pending', 'under_review', 'rejected') OR agent_code IS NOT NULL),
  CHECK (status NOT IN ('approved', 'active') OR approved_by IS NOT NULL),
  CHECK (status <> 'active' OR activated_by IS NOT NULL),
  -- four-eyes: who approves is not who activates (can be relaxed per config)
  CHECK (activated_by IS NULL OR activated_by <> approved_by)
);

CREATE INDEX idx_agents_status ON agent.agents (status);
CREATE INDEX idx_agents_region ON agent.agents (region);

-- Allowed status transitions. Enforced in the DB as a last line of
-- defence; the service also checks role permissions for each one.
CREATE FUNCTION agent.valid_agent_transition(p_from TEXT, p_to TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_from, p_to) IN (
    ('pending', 'under_review'),
    ('pending', 'rejected'),
    ('under_review', 'approved'),
    ('under_review', 'rejected'),
    ('under_review', 'pending'),       -- more information requested
    ('approved', 'active'),
    ('approved', 'rejected'),
    ('active', 'suspended'),
    ('active', 'blocked'),
    ('active', 'terminated'),
    ('suspended', 'active'),
    ('suspended', 'blocked'),
    ('suspended', 'terminated'),
    ('blocked', 'suspended'),
    ('blocked', 'terminated')
  );
$$;

CREATE TABLE agent.agent_status_history (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_id     UUID NOT NULL REFERENCES agent.agents (id),
  from_status  TEXT NOT NULL,
  to_status    TEXT NOT NULL,
  reason       TEXT,
  changed_by   UUID REFERENCES agent.staff_users (id),   -- NULL = system (e.g. automatic block)
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE FUNCTION agent.on_agent_status_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT agent.valid_agent_transition(OLD.status, NEW.status) THEN
      RAISE EXCEPTION 'AGENT_INVALID_TRANSITION: % -> %', OLD.status, NEW.status;
    END IF;
    INSERT INTO agent.agent_status_history (agent_id, from_status, to_status, reason, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, NEW.status_reason,
            CASE NEW.status WHEN 'active' THEN NEW.activated_by
                            WHEN 'approved' THEN NEW.approved_by
                            ELSE NULLIF(current_setting('app.staff_id', true), '')::uuid END);
  END IF;
  -- The agent id / phone of an existing agent cannot be reassigned.
  IF NEW.agent_code IS DISTINCT FROM OLD.agent_code AND OLD.agent_code IS NOT NULL THEN
    RAISE EXCEPTION 'AGENT_CODE_IMMUTABLE';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_agents_status
  BEFORE UPDATE ON agent.agents
  FOR EACH ROW EXECUTE FUNCTION agent.on_agent_status_change();

-- Assigns AG-000001 style codes on approval.
CREATE FUNCTION agent.next_agent_code() RETURNS TEXT
LANGUAGE sql AS $$
  SELECT 'AG-' || lpad(nextval('agent.agent_code_seq')::text, 6, '0');
$$;

-- Links an agent to BataPay core identities (their own wallet, the
-- wallet used for settlements...). Only opaque references.
CREATE TABLE agent.agent_user_links (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id           UUID NOT NULL REFERENCES agent.agents (id),
  batapay_user_ref   TEXT NOT NULL,
  link_type          TEXT NOT NULL CHECK (link_type IN ('owner', 'settlement_wallet')),
  verified_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, link_type),
  UNIQUE (batapay_user_ref, link_type)
);

-- =====================================================================
-- PROFILE, BUSINESS, SETTLEMENT ACCOUNTS
-- Sensitive identifiers are encrypted by the application (envelope
-- encryption with a KMS key) and stored as BYTEA. A keyed hash (HMAC)
-- allows exact-match lookups without decrypting.
-- =====================================================================

CREATE TABLE agent.agent_profiles (
  agent_id            UUID PRIMARY KEY REFERENCES agent.agents (id),
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  date_of_birth       DATE,
  nationality         CHAR(2),
  address_line        TEXT,
  city                TEXT,
  country             CHAR(2),
  preferred_language  TEXT NOT NULL DEFAULT 'es',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent.agent_businesses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         UUID NOT NULL UNIQUE REFERENCES agent.agents (id),
  trade_name       TEXT NOT NULL,
  business_type    TEXT NOT NULL,              -- catalogue configurable per country
  address_line     TEXT NOT NULL,
  city             TEXT NOT NULL,
  country          CHAR(2) NOT NULL,
  latitude         NUMERIC(9, 6),
  longitude        NUMERIC(9, 6),
  opening_hours    JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {"mon": [["08:00","20:00"]], ...}
  phone_e164       TEXT,
  tax_id_enc       BYTEA,                      -- only if required (por confirmar)
  verification     TEXT NOT NULL DEFAULT 'unverified' CHECK (verification IN ('unverified', 'verified', 'rejected')),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent.agent_settlement_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id            UUID NOT NULL REFERENCES agent.agents (id),
  method              TEXT NOT NULL CHECK (method IN ('bank_account', 'batapay_wallet', 'other')),  -- methods por confirmar
  holder_name         TEXT NOT NULL,
  account_ref_enc     BYTEA NOT NULL,          -- IBAN / account number / wallet id, encrypted
  account_ref_masked  TEXT NOT NULL,           -- '****1234' for display
  institution_code    TEXT,
  verification        TEXT NOT NULL DEFAULT 'pending' CHECK (verification IN ('pending', 'verified', 'rejected')),
  is_default          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_settlement_account_default
  ON agent.agent_settlement_accounts (agent_id) WHERE is_default;

-- =====================================================================
-- KYC — requirements are DATA, configurable per country / tier /
-- regulated provider. No legal requirement is hard-coded.
-- =====================================================================

CREATE TABLE agent.kyc_requirement_sets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country         CHAR(2) NOT NULL,
  tier_code       TEXT REFERENCES agent.agent_tiers (code),
  provider_code   TEXT,                         -- KYC provider (por confirmar)
  version         INT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  effective_from  TIMESTAMPTZ,
  created_by      UUID REFERENCES agent.staff_users (id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (country, tier_code, version)
);

CREATE TABLE agent.kyc_requirements (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id                 UUID NOT NULL REFERENCES agent.kyc_requirement_sets (id),
  code                   TEXT NOT NULL,         -- 'first_name', 'identity_document', 'selfie'...
  category               TEXT NOT NULL CHECK (category IN (
                           'personal', 'identity_document', 'selfie', 'address_proof', 'business', 'settlement')),
  requirement_type       TEXT NOT NULL CHECK (requirement_type IN ('field', 'document')),
  accepted_document_types TEXT[] NOT NULL DEFAULT '{}',
  required               BOOLEAN NOT NULL DEFAULT TRUE,
  rules                  JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {"min_age": ..., "max_file_mb": 8, "expires_warning_days": 30}
  sort_order             INT NOT NULL DEFAULT 0,
  UNIQUE (set_id, code)
);

CREATE TABLE agent.agent_kyc (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id               UUID NOT NULL REFERENCES agent.agents (id),
  requirement_set_id     UUID NOT NULL REFERENCES agent.kyc_requirement_sets (id),
  status                 TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN (
                           'not_started', 'in_progress', 'submitted', 'under_review',
                           'approved', 'rejected', 'resubmission_required', 'expired')),
  provider_code          TEXT,
  provider_ref           TEXT,                  -- case id at the KYC provider
  submitted_at           TIMESTAMPTZ,
  reviewed_by            UUID REFERENCES agent.staff_users (id),
  reviewed_at            TIMESTAMPTZ,
  rejection_reason_code  TEXT,
  expires_at             TIMESTAMPTZ,           -- periodic review date (policy por confirmar)
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one open KYC case per agent.
CREATE UNIQUE INDEX uq_agent_kyc_open ON agent.agent_kyc (agent_id)
  WHERE status NOT IN ('rejected', 'expired', 'approved');

CREATE TABLE agent.agent_documents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id              UUID NOT NULL REFERENCES agent.agents (id),
  kyc_id                UUID REFERENCES agent.agent_kyc (id),
  requirement_code      TEXT NOT NULL,
  document_type         TEXT NOT NULL CHECK (document_type IN (
                          'national_id', 'passport', 'residence_permit', 'selfie',
                          'proof_of_address', 'business_registration', 'tax_document',
                          'settlement_account_proof', 'other')),
  -- File lives in encrypted object storage; never in the database.
  storage_key           TEXT NOT NULL UNIQUE,
  sha256                TEXT NOT NULL,
  mime_type             TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes            INT NOT NULL CHECK (size_bytes > 0),
  document_number_enc   BYTEA,
  document_number_hmac  TEXT,                   -- detects the same document used by two agents
  issuing_country       CHAR(2),
  issued_on             DATE,
  expires_on            DATE,
  status                TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'verified', 'rejected', 'expired', 'superseded')),
  reviewed_by           UUID REFERENCES agent.staff_users (id),
  rejection_reason_code TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_documents_agent ON agent.agent_documents (agent_id);
CREATE INDEX idx_agent_documents_hmac ON agent.agent_documents (document_number_hmac) WHERE document_number_hmac IS NOT NULL;
CREATE INDEX idx_agent_documents_expiry ON agent.agent_documents (expires_on) WHERE status = 'verified';

-- =====================================================================
-- AUTHENTICATION: credentials, OTP, devices, sessions, access history
-- =====================================================================

CREATE TABLE agent.agent_credentials (
  agent_id          UUID PRIMARY KEY REFERENCES agent.agents (id),
  pin_hash          TEXT NOT NULL,             -- argon2id encoded string (salt+params inside) + server pepper
  pin_set_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  failed_attempts   INT NOT NULL DEFAULT 0,
  locked_until      TIMESTAMPTZ,
  lock_count        INT NOT NULL DEFAULT 0,    -- escalates lock duration; above threshold => status 'blocked'
  must_change_pin   BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (pin_hash LIKE '$argon2id$%')
);

CREATE TABLE agent.agent_otp_challenges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID NOT NULL REFERENCES agent.agents (id),
  purpose       TEXT NOT NULL CHECK (purpose IN ('login', 'new_device', 'recovery', 'step_up', 'pin_reset')),
  channel       TEXT NOT NULL CHECK (channel IN ('sms', 'email')),   -- SMS provider por confirmar
  code_hash     TEXT NOT NULL,                 -- HMAC-SHA256(code), never the code
  attempts      INT NOT NULL DEFAULT 0,
  max_attempts  INT NOT NULL DEFAULT 3,
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  context       JSONB NOT NULL DEFAULT '{}'::jsonb,   -- e.g. the device being registered (no secrets)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (attempts <= max_attempts)
);

CREATE INDEX idx_otp_agent_created ON agent.agent_otp_challenges (agent_id, created_at DESC);

CREATE TABLE agent.agent_devices (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id             UUID NOT NULL REFERENCES agent.agents (id),
  installation_id      TEXT NOT NULL,          -- random id generated by the app on install
  public_key           TEXT NOT NULL,          -- device key (Android Keystore / iOS Secure Enclave), JWK
  biometric_public_key TEXT,                   -- key that needs biometric unlock to sign (optional), JWK
  key_algorithm        TEXT NOT NULL CHECK (key_algorithm IN ('ES256')),
  platform             TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  model                TEXT,                   -- 'Samsung Galaxy A14'
  os_version           TEXT,
  app_version          TEXT,
  biometric_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  push_token           TEXT,
  status               TEXT NOT NULL DEFAULT 'pending_verification' CHECK (status IN ('pending_verification', 'trusted', 'revoked')),
  trusted_at           TIMESTAMPTZ,
  cooldown_until       TIMESTAMPTZ,            -- reduced limits after a device change
  last_seen_at         TIMESTAMPTZ,
  last_ip              INET,
  approx_location      TEXT,                   -- city-level only ('Bata'), never precise GPS history
  revoked_at           TIMESTAMPTZ,
  revoked_by           TEXT,                   -- 'agent' | staff id | 'system'
  revoked_reason       TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_agent_device_active ON agent.agent_devices (agent_id, installation_id) WHERE status <> 'revoked';
CREATE INDEX idx_agent_devices_agent ON agent.agent_devices (agent_id, status);

CREATE TABLE agent.agent_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id             UUID NOT NULL REFERENCES agent.agents (id),
  device_id            UUID NOT NULL REFERENCES agent.agent_devices (id),
  token_family         UUID NOT NULL,          -- all rotations of one login share a family
  refresh_token_hash   TEXT NOT NULL UNIQUE,   -- SHA-256 of the opaque refresh token
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rotated', 'revoked', 'expired')),
  auth_level           TEXT NOT NULL CHECK (auth_level IN ('pin', 'pin_otp', 'device_key_biometric')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at         TIMESTAMPTZ,
  idle_expires_at      TIMESTAMPTZ NOT NULL,
  absolute_expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at           TIMESTAMPTZ,
  revoked_reason       TEXT,                   -- 'logout', 'remote_logout', 'reuse_detected', 'agent_suspended'...
  ip                   INET
);

CREATE INDEX idx_sessions_agent_active ON agent.agent_sessions (agent_id) WHERE status = 'active';
CREATE INDEX idx_sessions_family ON agent.agent_sessions (token_family);

CREATE TABLE agent.agent_access_events (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_id         UUID REFERENCES agent.agents (id),
  phone_hmac       TEXT,                       -- for failed logins of unknown numbers
  event            TEXT NOT NULL CHECK (event IN (
                     'login_success', 'login_failed', 'otp_sent', 'otp_failed', 'account_locked',
                     'new_device_detected', 'device_trusted', 'device_revoked', 'logout',
                     'session_revoked', 'pin_changed', 'recovery_started', 'recovery_completed')),
  device_id        UUID REFERENCES agent.agent_devices (id),
  ip               INET,
  approx_location  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_access_events_agent ON agent.agent_access_events (agent_id, created_at DESC);

-- =====================================================================
-- LIMITS — configurable per tier; per-agent overrides need approval.
-- =====================================================================

CREATE TABLE agent.limit_policies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_code           TEXT NOT NULL REFERENCES agent.agent_tiers (code),
  operation_type      TEXT NOT NULL CHECK (operation_type IN ('cash_in', 'cash_out', 'qr_payment')),
  currency            CHAR(3) NOT NULL,
  per_tx_min          BIGINT NOT NULL CHECK (per_tx_min > 0),
  per_tx_max          BIGINT NOT NULL,
  daily_amount_max    BIGINT NOT NULL,
  daily_count_max     INT,
  monthly_amount_max  BIGINT NOT NULL,
  version             INT NOT NULL,
  effective_from      TIMESTAMPTZ NOT NULL,
  effective_to        TIMESTAMPTZ,
  created_by          UUID REFERENCES agent.staff_users (id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (per_tx_min <= per_tx_max AND per_tx_max <= daily_amount_max AND daily_amount_max <= monthly_amount_max),
  UNIQUE (tier_code, operation_type, currency, version)
);

-- Per-agent overrides (maker-checker: requester <> approver).
CREATE TABLE agent.agent_limits (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id            UUID NOT NULL REFERENCES agent.agents (id),
  operation_type      TEXT NOT NULL CHECK (operation_type IN ('cash_in', 'cash_out', 'qr_payment')),
  currency            CHAR(3) NOT NULL,
  per_tx_max          BIGINT,
  daily_amount_max    BIGINT,
  daily_count_max     INT,
  monthly_amount_max  BIGINT,
  reason              TEXT NOT NULL,
  requested_by        UUID NOT NULL REFERENCES agent.staff_users (id),
  approved_by         UUID REFERENCES agent.staff_users (id),
  status              TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'active', 'rejected', 'expired')),
  valid_from          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to            TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CHECK (status <> 'active' OR approved_by IS NOT NULL)
);

CREATE INDEX idx_agent_limits_agent ON agent.agent_limits (agent_id, operation_type) WHERE status = 'active';

-- Running usage counters, updated in the same DB transaction that
-- accepts an operation (row lock => no race between parallel requests).
CREATE TABLE agent.agent_limit_usage (
  agent_id        UUID NOT NULL REFERENCES agent.agents (id),
  operation_type  TEXT NOT NULL,
  period_type     TEXT NOT NULL CHECK (period_type IN ('day', 'month')),
  period_start    DATE NOT NULL,               -- in the operating time zone (Africa/Malabo)
  currency        CHAR(3) NOT NULL,
  amount          BIGINT NOT NULL DEFAULT 0 CHECK (amount >= 0),
  count           INT NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (agent_id, operation_type, period_type, period_start, currency)
);

-- =====================================================================
-- BALANCES (read model) and declared physical cash
-- =====================================================================

-- Projection of ledger balances for fast display. NOT the source of
-- truth: refreshed from ledger events; money checks always hit the ledger.
CREATE TABLE agent.agent_balances (
  agent_id           UUID NOT NULL REFERENCES agent.agents (id),
  balance_type       TEXT NOT NULL CHECK (balance_type IN ('float', 'commission')),
  currency           CHAR(3) NOT NULL,
  ledger_account_id  UUID NOT NULL UNIQUE,
  ledger_balance     BIGINT NOT NULL DEFAULT 0,
  available_balance  BIGINT NOT NULL DEFAULT 0,
  ledger_version     BIGINT NOT NULL DEFAULT 0,  -- ignore out-of-order events
  refreshed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (agent_id, balance_type, currency)
);

-- Physical cash is only known if the agent declares it.
CREATE TABLE agent.agent_cash_declarations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     UUID NOT NULL REFERENCES agent.agents (id),
  amount       BIGINT NOT NULL CHECK (amount >= 0),
  currency     CHAR(3) NOT NULL,
  note         TEXT,
  declared_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cash_decl_agent ON agent.agent_cash_declarations (agent_id, declared_at DESC);

-- =====================================================================
-- QR — agent-issued codes. The payload only carries an opaque id and a
-- signature; amount and purpose are always read from here.
-- (Withdrawal codes are issued by the customer's BataPay app and are
-- validated through BataPay core.)
-- =====================================================================

CREATE TABLE agent.agent_qr (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES agent.agents (id),
  kind            TEXT NOT NULL CHECK (kind IN ('agent_static', 'collect', 'deposit')),
  nonce           TEXT NOT NULL UNIQUE,         -- 128-bit random, base64url
  amount          BIGINT CHECK (amount > 0),
  currency        CHAR(3) NOT NULL,
  transaction_id  UUID,                         -- operation bound to this QR
  single_use      BOOLEAN NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'expired', 'revoked')),
  expires_at      TIMESTAMPTZ,
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (kind = 'agent_static' OR (single_use AND expires_at IS NOT NULL AND amount IS NOT NULL)),
  CHECK (kind <> 'agent_static' OR amount IS NULL)
);

CREATE UNIQUE INDEX uq_agent_static_qr ON agent.agent_qr (agent_id) WHERE kind = 'agent_static' AND status = 'active';
CREATE INDEX idx_agent_qr_active_expiry ON agent.agent_qr (expires_at) WHERE status = 'active' AND expires_at IS NOT NULL;

-- =====================================================================
-- OPERATIONS (agent-side record of each financial operation)
-- =====================================================================

CREATE SEQUENCE agent.transaction_ref_seq START 1;

CREATE FUNCTION agent.next_transaction_reference() RETURNS TEXT
LANGUAGE sql AS $$
  SELECT 'BTX-' || lpad(nextval('agent.transaction_ref_seq')::text, 8, '0');
$$;

CREATE TABLE agent.agent_transactions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference              TEXT NOT NULL UNIQUE DEFAULT agent.next_transaction_reference(),
  agent_id               UUID NOT NULL REFERENCES agent.agents (id),
  device_id              UUID REFERENCES agent.agent_devices (id),
  session_id             UUID REFERENCES agent.agent_sessions (id),
  type                   TEXT NOT NULL CHECK (type IN (
                           'cash_in', 'cash_out', 'qr_payment', 'commission',
                           'settlement', 'refund', 'authorized_adjustment')),
  status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                           'pending', 'processing', 'completed', 'failed', 'reversed', 'cancelled', 'disputed')),
  status_reason          TEXT,                  -- e.g. 'customer_timeout', 'insufficient_float', 'risk_review'
  amount                 BIGINT NOT NULL CHECK (amount > 0),
  currency               CHAR(3) NOT NULL,
  fee_amount             BIGINT NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),         -- charged to customer (policy por confirmar)
  commission_amount      BIGINT NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),  -- earned by the agent
  commission_rule_id     UUID,                  -- rule used for the quote the agent confirmed
  customer_ref           TEXT,                  -- opaque BataPay user id
  customer_masked        TEXT,                  -- '****4821' snapshot for display
  method                 TEXT NOT NULL CHECK (method IN ('qr', 'code', 'phone', 'system')),
  qr_id                  UUID REFERENCES agent.agent_qr (id),
  core_request_ref       TEXT,                  -- withdrawal / payment request id in BataPay core
  idempotency_key        TEXT NOT NULL,
  ledger_hold_id         UUID,
  ledger_transaction_id  UUID,                  -- set when posted in the ledger
  risk_level             TEXT CHECK (risk_level IN ('low', 'medium', 'high')),
  expires_at             TIMESTAMPTZ,           -- pending operations expire (e.g. 3 min)
  completed_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, idempotency_key),
  CHECK (status NOT IN ('completed', 'reversed') OR ledger_transaction_id IS NOT NULL),
  CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

CREATE INDEX idx_agent_tx_agent_created ON agent.agent_transactions (agent_id, created_at DESC, id DESC);
CREATE INDEX idx_agent_tx_agent_type_created ON agent.agent_transactions (agent_id, type, created_at DESC);
CREATE INDEX idx_agent_tx_pending_expiry ON agent.agent_transactions (expires_at) WHERE status = 'pending';
CREATE INDEX idx_agent_tx_status_created ON agent.agent_transactions (status, created_at) WHERE status IN ('processing', 'disputed');
-- A customer withdrawal/payment request can be used only once.
CREATE UNIQUE INDEX uq_agent_tx_core_request ON agent.agent_transactions (core_request_ref)
  WHERE core_request_ref IS NOT NULL AND status NOT IN ('failed', 'cancelled');

CREATE TABLE agent.agent_transaction_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id  UUID NOT NULL REFERENCES agent.agent_transactions (id),
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  event           TEXT NOT NULL,                -- 'created', 'customer_confirmed', 'risk_assessed', 'ledger_posted'...
  actor_type      TEXT NOT NULL CHECK (actor_type IN ('agent', 'customer', 'staff', 'system')),
  actor_id        TEXT,
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_tx_events_tx ON agent.agent_transaction_events (transaction_id, id);

-- Allowed operation state machine.
CREATE FUNCTION agent.valid_tx_transition(p_from TEXT, p_to TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_from, p_to) IN (
    ('pending', 'processing'),
    ('pending', 'cancelled'),
    ('pending', 'failed'),
    ('processing', 'completed'),
    ('processing', 'failed'),
    ('completed', 'reversed'),
    ('completed', 'disputed'),
    ('disputed', 'completed'),
    ('disputed', 'reversed')
  );
$$;

-- Once created, the economic content of an operation never changes;
-- only its status moves forward, and every move is recorded.
CREATE FUNCTION agent.guard_agent_transaction() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.reference <> OLD.reference OR NEW.agent_id <> OLD.agent_id
     OR NEW.type <> OLD.type OR NEW.amount <> OLD.amount OR NEW.currency <> OLD.currency
     OR NEW.customer_ref IS DISTINCT FROM OLD.customer_ref
     OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'AGENT_TX_IMMUTABLE_FIELDS: operation % cannot be edited', OLD.reference;
  END IF;

  IF OLD.status IN ('completed', 'reversed', 'disputed')
     AND (NEW.fee_amount <> OLD.fee_amount OR NEW.commission_amount <> OLD.commission_amount
          OR NEW.commission_rule_id IS DISTINCT FROM OLD.commission_rule_id
          OR NEW.ledger_transaction_id IS DISTINCT FROM OLD.ledger_transaction_id) THEN
    RAISE EXCEPTION 'AGENT_TX_IMMUTABLE_FIELDS: operation % is settled', OLD.reference;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT agent.valid_tx_transition(OLD.status, NEW.status) THEN
      RAISE EXCEPTION 'AGENT_TX_INVALID_TRANSITION: % -> %', OLD.status, NEW.status;
    END IF;
    INSERT INTO agent.agent_transaction_events (transaction_id, from_status, to_status, event, actor_type, actor_id, details)
    VALUES (NEW.id, OLD.status, NEW.status, 'status_changed',
            COALESCE(NULLIF(current_setting('app.actor_type', true), ''), 'system'),
            NULLIF(current_setting('app.actor_id', true), ''),
            jsonb_build_object('reason', NEW.status_reason));
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_agent_tx_guard
  BEFORE UPDATE ON agent.agent_transactions
  FOR EACH ROW EXECUTE FUNCTION agent.guard_agent_transaction();

CREATE FUNCTION agent.forbid_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: % on %.% is not allowed', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_agent_tx_no_delete
  BEFORE DELETE ON agent.agent_transactions
  FOR EACH ROW EXECUTE FUNCTION agent.forbid_delete();

CREATE TRIGGER trg_agent_tx_events_append_only
  BEFORE UPDATE OR DELETE ON agent.agent_transaction_events
  FOR EACH ROW EXECUTE FUNCTION agent.forbid_delete();

-- =====================================================================
-- FRAUD / RISK
-- =====================================================================

CREATE TABLE agent.fraud_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         TEXT NOT NULL,                  -- 'velocity_agent_5m', 'amount_vs_baseline'...
  version      INT NOT NULL,
  description  TEXT NOT NULL,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  mode         TEXT NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow', 'active')),  -- shadow = evaluate & log only
  weight       NUMERIC(5, 2) NOT NULL,         -- contribution to the 0-100 score
  params       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by   UUID REFERENCES agent.staff_users (id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (code, version)
);

CREATE TABLE agent.risk_assessments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID REFERENCES agent.agent_transactions (id),
  agent_id        UUID NOT NULL REFERENCES agent.agents (id),
  subject         TEXT NOT NULL CHECK (subject IN ('transaction', 'login', 'device')),
  score           NUMERIC(5, 2) NOT NULL CHECK (score BETWEEN 0 AND 100),
  level           TEXT NOT NULL CHECK (level IN ('low', 'medium', 'high')),
  decision        TEXT NOT NULL CHECK (decision IN ('allow', 'step_up', 'review', 'block')),
  signals         JSONB NOT NULL DEFAULT '[]'::jsonb,    -- [{"rule":"velocity_agent_5m","hit":true,"value":12}]
  rules_version   TEXT NOT NULL,
  compliance_hook JSONB,                        -- result of external compliance screening (provider por confirmar)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_risk_agent_created ON agent.risk_assessments (agent_id, created_at DESC);

CREATE TABLE agent.fraud_cases (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference          TEXT NOT NULL UNIQUE,     -- 'FRC-000123'
  agent_id           UUID NOT NULL REFERENCES agent.agents (id),
  transaction_id     UUID REFERENCES agent.agent_transactions (id),
  risk_assessment_id UUID REFERENCES agent.risk_assessments (id),
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'cleared', 'confirmed', 'escalated')),
  assigned_to        UUID REFERENCES agent.staff_users (id),
  resolution_notes   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at          TIMESTAMPTZ
);

CREATE INDEX idx_fraud_cases_open ON agent.fraud_cases (status, created_at) WHERE status IN ('open', 'investigating');

-- =====================================================================
-- COMMISSIONS — rules are configuration, never hard-coded.
-- =====================================================================

CREATE TABLE agent.commission_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL,
  version         INT NOT NULL,
  name            TEXT NOT NULL,
  currency        CHAR(3) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  effective_from  TIMESTAMPTZ,
  effective_to    TIMESTAMPTZ,
  created_by      UUID REFERENCES agent.staff_users (id),
  approved_by     UUID REFERENCES agent.staff_users (id),
  UNIQUE (code, version),
  CHECK (approved_by IS NULL OR approved_by <> created_by),
  CHECK (status <> 'active' OR approved_by IS NOT NULL)
);

CREATE TABLE agent.commission_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         UUID NOT NULL REFERENCES agent.commission_plans (id),
  operation_type  TEXT NOT NULL CHECK (operation_type IN ('cash_in', 'cash_out', 'qr_payment')),
  tier_code       TEXT REFERENCES agent.agent_tiers (code),   -- NULL = all tiers
  amount_from     BIGINT NOT NULL DEFAULT 0,
  amount_to       BIGINT,                                     -- NULL = no upper bound
  fixed_amount    BIGINT NOT NULL DEFAULT 0 CHECK (fixed_amount >= 0),
  rate_bps        INT NOT NULL DEFAULT 0 CHECK (rate_bps BETWEEN 0 AND 10000),  -- 100 bps = 1%
  min_amount      BIGINT,
  max_amount      BIGINT,
  CHECK (amount_to IS NULL OR amount_to > amount_from)
);

CREATE TABLE agent.agent_commissions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id               UUID NOT NULL REFERENCES agent.agents (id),
  transaction_id         UUID NOT NULL UNIQUE REFERENCES agent.agent_transactions (id),
  rule_id                UUID NOT NULL REFERENCES agent.commission_rules (id),
  operation_type         TEXT NOT NULL,
  base_amount            BIGINT NOT NULL,
  commission_amount      BIGINT NOT NULL CHECK (commission_amount >= 0),
  currency               CHAR(3) NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'accrued' CHECK (status IN ('accrued', 'in_settlement', 'settled', 'reversed')),
  settlement_id          UUID,
  ledger_transaction_id  UUID NOT NULL,
  accrued_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_commissions_agent_time ON agent.agent_commissions (agent_id, accrued_at DESC);
CREATE INDEX idx_commissions_unsettled ON agent.agent_commissions (agent_id) WHERE status = 'accrued';

-- Daily rollup for fast "today / week / month / total" screens.
CREATE TABLE agent.agent_commission_daily (
  agent_id        UUID NOT NULL REFERENCES agent.agents (id),
  day             DATE NOT NULL,
  operation_type  TEXT NOT NULL,
  currency        CHAR(3) NOT NULL,
  count           INT NOT NULL DEFAULT 0,
  amount          BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, day, operation_type, currency)
);

-- =====================================================================
-- SETTLEMENTS
-- =====================================================================

CREATE TABLE agent.agent_settlements (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference              TEXT NOT NULL UNIQUE,         -- 'STL-2026-09-000123'
  agent_id               UUID NOT NULL REFERENCES agent.agents (id),
  period_start           DATE NOT NULL,
  period_end             DATE NOT NULL,
  volume_amount          BIGINT NOT NULL DEFAULT 0,
  commission_amount      BIGINT NOT NULL DEFAULT 0,
  deductions_amount      BIGINT NOT NULL DEFAULT 0,    -- taxes/withholdings if applicable (por confirmar)
  net_amount             BIGINT NOT NULL,
  currency               CHAR(3) NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'processing', 'completed', 'failed')),
  settlement_account_id  UUID REFERENCES agent.agent_settlement_accounts (id),
  method                 TEXT,
  provider_ref           TEXT,                         -- bank / provider payout reference
  ledger_transaction_id  UUID,
  scheduled_for          DATE,
  completed_at           TIMESTAMPTZ,
  failure_reason         TEXT,
  prepared_by            TEXT NOT NULL DEFAULT 'system',
  approved_by            UUID REFERENCES agent.staff_users (id),   -- FINANCE
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, period_start, period_end),
  CHECK (period_end >= period_start),
  CHECK (net_amount = commission_amount - deductions_amount),
  CHECK (status <> 'completed' OR (ledger_transaction_id IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE INDEX idx_settlements_agent ON agent.agent_settlements (agent_id, period_end DESC);

ALTER TABLE agent.agent_commissions
  ADD CONSTRAINT fk_commission_settlement FOREIGN KEY (settlement_id) REFERENCES agent.agent_settlements (id);

-- =====================================================================
-- NOTIFICATIONS
-- =====================================================================

CREATE TABLE agent.agent_notifications (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id                UUID NOT NULL REFERENCES agent.agents (id),
  type                    TEXT NOT NULL CHECK (type IN (
                            'cash_in_completed', 'cash_out_completed', 'new_device_detected',
                            'account_suspended', 'settlement_completed', 'kyc_document_expiring',
                            'operation_pending', 'security_alert', 'limit_changed', 'support_reply')),
  title_key               TEXT NOT NULL,                -- i18n key, e.g. 'notif.cash_in_completed.title'
  body_key                TEXT NOT NULL,
  params                  JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {"amount": 100000, "currency": "XAF", "reference": "BTX-..."}
  related_transaction_id  UUID REFERENCES agent.agent_transactions (id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at                 TIMESTAMPTZ
);

CREATE INDEX idx_notifications_agent ON agent.agent_notifications (agent_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON agent.agent_notifications (agent_id) WHERE read_at IS NULL;

CREATE TABLE agent.agent_notification_deliveries (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notification_id  UUID NOT NULL REFERENCES agent.agent_notifications (id),
  channel          TEXT NOT NULL CHECK (channel IN ('push', 'sms', 'email')),
  status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  provider_ref     TEXT,
  attempts         INT NOT NULL DEFAULT 0,
  last_error       TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent.agent_notification_preferences (
  agent_id      UUID NOT NULL REFERENCES agent.agents (id),
  type          TEXT NOT NULL,
  push_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (agent_id, type),
  -- security and account notifications cannot be switched off
  CHECK (push_enabled OR type NOT IN ('new_device_detected', 'account_suspended', 'security_alert'))
);

-- =====================================================================
-- SUPPORT
-- =====================================================================

CREATE SEQUENCE agent.ticket_ref_seq START 1;

CREATE TABLE agent.agent_support_tickets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference        TEXT NOT NULL UNIQUE DEFAULT ('TCK-' || lpad(nextval('agent.ticket_ref_seq')::text, 6, '0')),
  agent_id         UUID NOT NULL REFERENCES agent.agents (id),
  category         TEXT NOT NULL CHECK (category IN (
                     'operation_problem', 'customer_not_credited', 'cash_in_error', 'cash_out_error',
                     'qr_problem', 'settlement_problem', 'account_blocked', 'kyc_problem', 'other')),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_agent', 'resolved', 'closed')),
  priority         TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  description      TEXT NOT NULL CHECK (length(description) BETWEEN 10 AND 2000),
  transaction_id   UUID REFERENCES agent.agent_transactions (id),
  assigned_to      UUID REFERENCES agent.staff_users (id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ
);

CREATE INDEX idx_tickets_agent ON agent.agent_support_tickets (agent_id, created_at DESC);
CREATE INDEX idx_tickets_queue ON agent.agent_support_tickets (status, priority, created_at) WHERE status IN ('open', 'in_progress');

CREATE TABLE agent.agent_support_messages (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id     UUID NOT NULL REFERENCES agent.agent_support_tickets (id),
  author_type   TEXT NOT NULL CHECK (author_type IN ('agent', 'staff', 'system')),
  author_id     TEXT,
  body          TEXT NOT NULL,
  attachments   JSONB NOT NULL DEFAULT '[]'::jsonb,   -- storage keys, never raw files
  internal      BOOLEAN NOT NULL DEFAULT FALSE,       -- internal staff notes are never shown to the agent
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (NOT internal OR author_type = 'staff')
);

CREATE INDEX idx_support_messages_ticket ON agent.agent_support_messages (ticket_id, id);

-- =====================================================================
-- IDEMPOTENCY + OUTBOX
-- =====================================================================

CREATE TABLE agent.idempotency_keys (
  agent_id       UUID NOT NULL,
  key            TEXT NOT NULL CHECK (length(key) BETWEEN 16 AND 128),
  endpoint       TEXT NOT NULL,
  request_hash   TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  response_code  INT,
  response_body  JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '48 hours',
  PRIMARY KEY (agent_id, key)
);

-- Events written in the same DB transaction as the business change,
-- then published to the queue by a relay (transactional outbox).
CREATE TABLE agent.outbox_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aggregate_type  TEXT NOT NULL,
  aggregate_id    TEXT NOT NULL,
  event_type      TEXT NOT NULL,                -- 'agent.transaction.completed'
  payload         JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at    TIMESTAMPTZ
);

CREATE INDEX idx_outbox_unpublished ON agent.outbox_events (id) WHERE published_at IS NULL;

-- =====================================================================
-- AUDIT LOG — append-only, tamper-evident (hash chain per agent/actor
-- stream). Also shipped to WORM object storage.
-- =====================================================================

CREATE TABLE agent.agent_audit_logs (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stream         TEXT NOT NULL,                -- 'agent:<uuid>' or 'staff:<uuid>' or 'system'
  actor_type     TEXT NOT NULL CHECK (actor_type IN ('agent', 'staff', 'system', 'service')),
  actor_id       TEXT,
  agent_id       UUID,                         -- agent affected (if any)
  action         TEXT NOT NULL,                -- 'CASH_OUT', 'LOGIN', 'AGENT_APPROVE', 'LIMIT_CHANGE'...
  resource_type  TEXT,
  resource_id    TEXT,
  result         TEXT NOT NULL CHECK (result IN ('success', 'failure', 'denied')),
  reason_code    TEXT,
  device_id      UUID,
  ip             INET,
  user_agent     TEXT,
  request_id     TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,   -- never PINs, OTPs, tokens or full documents
  prev_hash      BYTEA,
  hash           BYTEA NOT NULL
);

CREATE INDEX idx_audit_agent_time ON agent.agent_audit_logs (agent_id, occurred_at DESC);
CREATE INDEX idx_audit_action_time ON agent.agent_audit_logs (action, occurred_at DESC);
CREATE INDEX idx_audit_stream ON agent.agent_audit_logs (stream, id DESC);

CREATE FUNCTION agent.audit_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- One writer at a time per stream keeps the chain linear.
  PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || NEW.stream, 0));
  SELECT hash INTO NEW.prev_hash FROM agent.agent_audit_logs
   WHERE stream = NEW.stream ORDER BY id DESC LIMIT 1;
  NEW.hash := digest(
    COALESCE(encode(NEW.prev_hash, 'hex'), '') || '|' || NEW.occurred_at::text || '|' || NEW.stream || '|' ||
    NEW.actor_type || '|' || COALESCE(NEW.actor_id, '') || '|' || NEW.action || '|' ||
    COALESCE(NEW.resource_type, '') || '|' || COALESCE(NEW.resource_id, '') || '|' || NEW.result || '|' ||
    NEW.metadata::text,
    'sha256');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_chain
  BEFORE INSERT ON agent.agent_audit_logs
  FOR EACH ROW EXECUTE FUNCTION agent.audit_chain();

CREATE TRIGGER trg_audit_append_only
  BEFORE UPDATE OR DELETE ON agent.agent_audit_logs
  FOR EACH ROW EXECUTE FUNCTION agent.forbid_delete();

CREATE TRIGGER trg_audit_no_truncate
  BEFORE TRUNCATE ON agent.agent_audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION agent.forbid_delete();
