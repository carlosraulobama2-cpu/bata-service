-- =====================================================================
-- VELYNT SERVICES / BataPay — FINANCIAL LEDGER (double-entry)
-- PostgreSQL 15+
--
-- Owned by the Ledger service (BataPay core). In production this schema
-- lives in its own database/cluster. The Agent service NEVER writes here
-- directly: it calls the Ledger internal API, which uses these functions.
--
-- Money is stored as BIGINT in minor units of the currency
-- (XAF has 0 decimals, so 100.000 XAF = 100000).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS ledger;

-- ---------------------------------------------------------------------
-- Currencies
-- ---------------------------------------------------------------------
CREATE TABLE ledger.currencies (
  code        CHAR(3) PRIMARY KEY,
  minor_unit  SMALLINT NOT NULL CHECK (minor_unit BETWEEN 0 AND 4),
  active      BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO ledger.currencies (code, minor_unit) VALUES ('XAF', 0);

-- ---------------------------------------------------------------------
-- Accounts
--   type: accounting class. For an e-money issuer, customer wallets and
--   agent float are LIABILITIES (money BataPay owes to their holders).
--   normal side: asset/expense = debit, liability/equity/revenue = credit.
-- ---------------------------------------------------------------------
CREATE TABLE ledger.ledger_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_number  TEXT NOT NULL UNIQUE,              -- e.g. AGF-AG000001-XAF
  owner_type      TEXT NOT NULL CHECK (owner_type IN ('customer', 'agent', 'system')),
  owner_ref       TEXT NOT NULL,                     -- BataPay user id / agent id / system code
  purpose         TEXT NOT NULL CHECK (purpose IN (
                    'customer_wallet',
                    'agent_float',
                    'agent_commission_payable',
                    'fee_revenue',
                    'commission_expense',
                    'settlement_bank',                -- trust / bank account backing e-money (provider por confirmar)
                    'settlement_clearing',
                    'suspense'
                  )),
  type            TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  currency        CHAR(3) NOT NULL REFERENCES ledger.currencies (code),
  allow_negative  BOOLEAN NOT NULL DEFAULT FALSE,
  -- Hot system accounts (fee revenue, commission expense...) skip the
  -- per-posting balance row lock; their balance is computed by rollup.
  track_balance   BOOLEAN NOT NULL DEFAULT TRUE,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'closed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_type, owner_ref, purpose, currency)
);

-- Current balance per account (maintained atomically by triggers).
--   balance: net amount on the account's normal side.
--   held:    amount reserved by active holds (not yet posted).
--   available = balance - held
CREATE TABLE ledger.ledger_account_balances (
  account_id     UUID PRIMARY KEY REFERENCES ledger.ledger_accounts (id),
  balance        BIGINT NOT NULL DEFAULT 0,
  held           BIGINT NOT NULL DEFAULT 0 CHECK (held >= 0),
  version        BIGINT NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- Transactions (journal headers) — immutable
-- ---------------------------------------------------------------------
CREATE TABLE ledger.ledger_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference        TEXT NOT NULL UNIQUE,              -- BTX-00092831 (shared with the agent transaction)
  source_system    TEXT NOT NULL,                     -- 'agent-service', 'batapay-core', 'settlement-job'
  idempotency_key  TEXT NOT NULL,
  request_hash     TEXT NOT NULL,                     -- sha256 of the posting request; detects key reuse with a different payload
  kind             TEXT NOT NULL CHECK (kind IN (
                     'cash_in', 'cash_out', 'qr_payment', 'float_topup', 'float_withdrawal',
                     'commission', 'settlement', 'fee', 'refund', 'adjustment', 'reversal'
                   )),
  external_ref     TEXT,                              -- agent_transactions.id, settlement id...
  reversal_of      UUID UNIQUE REFERENCES ledger.ledger_transactions (id), -- a transaction can be reversed only once
  description      TEXT,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by       TEXT NOT NULL,                     -- service principal (never an end user)
  posted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_system, idempotency_key),
  CHECK ((kind = 'reversal') = (reversal_of IS NOT NULL))
);

CREATE INDEX idx_ledger_tx_posted_at ON ledger.ledger_transactions (posted_at);
CREATE INDEX idx_ledger_tx_external_ref ON ledger.ledger_transactions (source_system, external_ref);

-- ---------------------------------------------------------------------
-- Entries (journal lines) — immutable, partitioned by month.
-- Every transaction: SUM(debits) = SUM(credits) per currency.
-- ---------------------------------------------------------------------
CREATE TABLE ledger.ledger_entries (
  id              BIGINT GENERATED ALWAYS AS IDENTITY,
  transaction_id  UUID NOT NULL REFERENCES ledger.ledger_transactions (id),
  account_id      UUID NOT NULL REFERENCES ledger.ledger_accounts (id),
  direction       CHAR(1) NOT NULL CHECK (direction IN ('D', 'C')),
  amount          BIGINT NOT NULL CHECK (amount > 0),
  currency        CHAR(3) NOT NULL REFERENCES ledger.currencies (code),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Monthly partitions are created ahead of time by a scheduled job
-- (e.g. pg_partman). The default partition catches anything else.
CREATE TABLE ledger.ledger_entries_default PARTITION OF ledger.ledger_entries DEFAULT;

CREATE INDEX idx_ledger_entries_tx ON ledger.ledger_entries (transaction_id);
CREATE INDEX idx_ledger_entries_account_time ON ledger.ledger_entries (account_id, created_at DESC);

-- ---------------------------------------------------------------------
-- Holds (reservations of available balance, e.g. while a cash-in waits
-- for the customer's confirmation). Holds are NOT ledger entries.
-- ---------------------------------------------------------------------
CREATE TABLE ledger.ledger_holds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES ledger.ledger_accounts (id),
  amount          BIGINT NOT NULL CHECK (amount > 0),
  currency        CHAR(3) NOT NULL REFERENCES ledger.currencies (code),
  source_system   TEXT NOT NULL,
  external_ref    TEXT NOT NULL,                      -- agent transaction id
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'captured', 'released', 'expired')),
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at       TIMESTAMPTZ,
  UNIQUE (source_system, external_ref, account_id)
);

CREATE INDEX idx_ledger_holds_active_expiry ON ledger.ledger_holds (expires_at) WHERE status = 'active';

-- ---------------------------------------------------------------------
-- Reconciliation runs (daily jobs; results reviewed by FINANCE)
-- ---------------------------------------------------------------------
CREATE TABLE ledger.reconciliation_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT NOT NULL CHECK (kind IN (
                    'trial_balance',          -- SUM(D) = SUM(C) over the period
                    'balances_vs_entries',    -- stored balances = recomputed from entries
                    'agent_vs_ledger',        -- every completed agent tx has exactly one ledger tx
                    'bank_statement'          -- settlement_bank vs provider statement (provider por confirmar)
                  )),
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'discrepancies', 'failed')),
  discrepancies   JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ
);

-- =====================================================================
-- INTEGRITY RULES
-- =====================================================================

-- 1) Immutability: journal rows can never be updated or deleted.
--    Corrections are made with a reversal transaction.
CREATE FUNCTION ledger.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'LEDGER_IMMUTABLE: % on %.% is not allowed', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER trg_ledger_tx_immutable
  BEFORE UPDATE OR DELETE ON ledger.ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION ledger.forbid_mutation();

CREATE TRIGGER trg_ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON ledger.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger.forbid_mutation();

CREATE TRIGGER trg_ledger_tx_no_truncate
  BEFORE TRUNCATE ON ledger.ledger_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION ledger.forbid_mutation();

CREATE TRIGGER trg_ledger_entries_no_truncate
  BEFORE TRUNCATE ON ledger.ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger.forbid_mutation();

-- 2) Each entry: currency matches the account, account is active,
--    then the balance is updated and overdraft is checked.
CREATE FUNCTION ledger.apply_entry() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  acc      ledger.ledger_accounts%ROWTYPE;
  delta    BIGINT;
  new_bal  BIGINT;
  new_held BIGINT;
BEGIN
  SELECT * INTO acc FROM ledger.ledger_accounts WHERE id = NEW.account_id;

  IF acc.currency <> NEW.currency THEN
    RAISE EXCEPTION 'LEDGER_CURRENCY_MISMATCH: account % is %, entry is %', acc.account_number, acc.currency, NEW.currency;
  END IF;
  IF acc.status <> 'active' THEN
    RAISE EXCEPTION 'LEDGER_ACCOUNT_NOT_ACTIVE: %', acc.account_number;
  END IF;
  IF NOT acc.track_balance THEN
    RETURN NEW;
  END IF;

  -- Positive delta = increase on the account's normal side.
  IF acc.type IN ('asset', 'expense') THEN
    delta := CASE NEW.direction WHEN 'D' THEN NEW.amount ELSE -NEW.amount END;
  ELSE
    delta := CASE NEW.direction WHEN 'C' THEN NEW.amount ELSE -NEW.amount END;
  END IF;

  UPDATE ledger.ledger_account_balances
     SET balance = balance + delta, version = version + 1, updated_at = NOW()
   WHERE account_id = NEW.account_id
   RETURNING balance, held INTO new_bal, new_held;

  IF NOT acc.allow_negative AND new_bal - new_held < 0 THEN
    RAISE EXCEPTION 'LEDGER_INSUFFICIENT_FUNDS: account %', acc.account_number USING ERRCODE = 'P0002';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ledger_entries_apply
  AFTER INSERT ON ledger.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger.apply_entry();

-- 3) Double entry: checked at COMMIT (deferred), so all lines of a
--    transaction are inserted before the check runs.
CREATE FUNCTION ledger.check_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  bad RECORD;
BEGIN
  SELECT currency,
         SUM(CASE direction WHEN 'D' THEN amount ELSE 0 END) AS debits,
         SUM(CASE direction WHEN 'C' THEN amount ELSE 0 END) AS credits
    INTO bad
    FROM ledger.ledger_entries
   WHERE transaction_id = NEW.transaction_id
   GROUP BY currency
  HAVING SUM(CASE direction WHEN 'D' THEN amount ELSE -amount END) <> 0
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'LEDGER_UNBALANCED: transaction % (% D=% C=%)', NEW.transaction_id, bad.currency, bad.debits, bad.credits;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_ledger_entries_balanced
  AFTER INSERT ON ledger.ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger.check_balanced();

-- Every new account gets a balance row.
CREATE FUNCTION ledger.init_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ledger.ledger_account_balances (account_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ledger_accounts_init_balance
  AFTER INSERT ON ledger.ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION ledger.init_balance();

-- =====================================================================
-- POSTING API (called only by the Ledger service)
-- =====================================================================

-- Creates a hold on an account's available balance. Idempotent on
-- (source_system, external_ref, account_id).
CREATE FUNCTION ledger.create_hold(
  p_account_id    UUID,
  p_amount        BIGINT,
  p_source_system TEXT,
  p_external_ref  TEXT,
  p_expires_at    TIMESTAMPTZ
) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  acc      ledger.ledger_accounts%ROWTYPE;
  bal      ledger.ledger_account_balances%ROWTYPE;
  hold_id  UUID;
BEGIN
  SELECT id INTO hold_id FROM ledger.ledger_holds
   WHERE source_system = p_source_system AND external_ref = p_external_ref AND account_id = p_account_id;
  IF FOUND THEN
    RETURN hold_id;
  END IF;

  SELECT * INTO acc FROM ledger.ledger_accounts WHERE id = p_account_id;
  IF acc.status <> 'active' THEN
    RAISE EXCEPTION 'LEDGER_ACCOUNT_NOT_ACTIVE: %', acc.account_number;
  END IF;

  SELECT * INTO bal FROM ledger.ledger_account_balances WHERE account_id = p_account_id FOR UPDATE;
  IF NOT acc.allow_negative AND bal.balance - bal.held < p_amount THEN
    RAISE EXCEPTION 'LEDGER_INSUFFICIENT_FUNDS: account %', acc.account_number USING ERRCODE = 'P0002';
  END IF;

  UPDATE ledger.ledger_account_balances
     SET held = held + p_amount, version = version + 1, updated_at = NOW()
   WHERE account_id = p_account_id;

  INSERT INTO ledger.ledger_holds (account_id, amount, currency, source_system, external_ref, expires_at)
  VALUES (p_account_id, p_amount, acc.currency, p_source_system, p_external_ref, p_expires_at)
  RETURNING id INTO hold_id;

  RETURN hold_id;
END;
$$;

-- Closes a hold (released / expired / captured) and frees the reserved amount.
CREATE FUNCTION ledger.close_hold(p_hold_id UUID, p_status TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  h ledger.ledger_holds%ROWTYPE;
BEGIN
  IF p_status NOT IN ('captured', 'released', 'expired') THEN
    RAISE EXCEPTION 'LEDGER_INVALID_HOLD_STATUS: %', p_status;
  END IF;

  SELECT * INTO h FROM ledger.ledger_holds WHERE id = p_hold_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEDGER_HOLD_NOT_FOUND: %', p_hold_id;
  END IF;
  IF h.status <> 'active' THEN
    RETURN; -- already closed: idempotent
  END IF;

  UPDATE ledger.ledger_account_balances
     SET held = held - h.amount, version = version + 1, updated_at = NOW()
   WHERE account_id = h.account_id;

  UPDATE ledger.ledger_holds SET status = p_status, closed_at = NOW() WHERE id = p_hold_id;
END;
$$;

-- Posts a balanced transaction atomically.
--   p_entries: [{"account_id": "...", "direction": "D"|"C", "amount": 100000}, ...]
--   p_capture_holds: holds consumed by this posting (released first).
-- Idempotent: the same (source_system, idempotency_key) returns the
-- original transaction id; reusing a key with a different payload fails.
CREATE FUNCTION ledger.post_transaction(
  p_reference       TEXT,
  p_source_system   TEXT,
  p_idempotency_key TEXT,
  p_kind            TEXT,
  p_entries         JSONB,
  p_created_by      TEXT,
  p_external_ref    TEXT DEFAULT NULL,
  p_description     TEXT DEFAULT NULL,
  p_metadata        JSONB DEFAULT '{}'::jsonb,
  p_capture_holds   UUID[] DEFAULT '{}',
  p_reversal_of     UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_hash      TEXT;
  v_existing  ledger.ledger_transactions%ROWTYPE;
  v_tx_id     UUID;
  v_hold      UUID;
  v_entry     JSONB;
  v_currency  CHAR(3);
BEGIN
  v_hash := encode(digest(p_kind || '|' || p_entries::text || '|' || COALESCE(p_external_ref, ''), 'sha256'), 'hex');

  -- Serialize concurrent calls with the same key.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_source_system || ':' || p_idempotency_key, 0));

  SELECT * INTO v_existing FROM ledger.ledger_transactions
   WHERE source_system = p_source_system AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash <> v_hash THEN
      RAISE EXCEPTION 'LEDGER_IDEMPOTENCY_CONFLICT: key % was used with a different request', p_idempotency_key;
    END IF;
    RETURN v_existing.id;
  END IF;

  IF jsonb_array_length(p_entries) < 2 THEN
    RAISE EXCEPTION 'LEDGER_INVALID: a transaction needs at least two entries';
  END IF;

  -- Lock balance rows in a stable order to avoid deadlocks.
  PERFORM 1 FROM ledger.ledger_account_balances
   WHERE account_id IN (SELECT (e->>'account_id')::uuid FROM jsonb_array_elements(p_entries) e)
   ORDER BY account_id
   FOR UPDATE;

  FOREACH v_hold IN ARRAY p_capture_holds LOOP
    PERFORM ledger.close_hold(v_hold, 'captured');
  END LOOP;

  INSERT INTO ledger.ledger_transactions
    (reference, source_system, idempotency_key, request_hash, kind, external_ref,
     reversal_of, description, metadata, created_by)
  VALUES
    (p_reference, p_source_system, p_idempotency_key, v_hash, p_kind, p_external_ref,
     p_reversal_of, p_description, p_metadata, p_created_by)
  RETURNING id INTO v_tx_id;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    SELECT currency INTO v_currency FROM ledger.ledger_accounts WHERE id = (v_entry->>'account_id')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'LEDGER_ACCOUNT_NOT_FOUND: %', v_entry->>'account_id';
    END IF;
    INSERT INTO ledger.ledger_entries (transaction_id, account_id, direction, amount, currency)
    VALUES (v_tx_id, (v_entry->>'account_id')::uuid, v_entry->>'direction', (v_entry->>'amount')::bigint, v_currency);
  END LOOP;

  RETURN v_tx_id;
END;
$$;

-- Reverses a posted transaction with mirrored entries. Can happen only
-- once per transaction (UNIQUE reversal_of).
CREATE FUNCTION ledger.reverse_transaction(
  p_original_id     UUID,
  p_reference       TEXT,
  p_source_system   TEXT,
  p_idempotency_key TEXT,
  p_created_by      TEXT,
  p_reason          TEXT
) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_entries JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ledger.ledger_transactions WHERE id = p_original_id) THEN
    RAISE EXCEPTION 'LEDGER_TX_NOT_FOUND: %', p_original_id;
  END IF;
  IF EXISTS (SELECT 1 FROM ledger.ledger_transactions WHERE id = p_original_id AND kind = 'reversal') THEN
    RAISE EXCEPTION 'LEDGER_INVALID: a reversal cannot be reversed';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'account_id', account_id,
           'direction', CASE direction WHEN 'D' THEN 'C' ELSE 'D' END,
           'amount', amount) ORDER BY id)
    INTO v_entries
    FROM ledger.ledger_entries
   WHERE transaction_id = p_original_id;

  RETURN ledger.post_transaction(
    p_reference, p_source_system, p_idempotency_key, 'reversal', v_entries, p_created_by,
    p_original_id::text, p_reason, jsonb_build_object('reason', p_reason), '{}', p_original_id);
END;
$$;

-- Trial balance for a period: must return zero rows.
CREATE VIEW ledger.v_unbalanced_transactions AS
SELECT transaction_id, currency,
       SUM(CASE direction WHEN 'D' THEN amount ELSE -amount END) AS difference
  FROM ledger.ledger_entries
 GROUP BY transaction_id, currency
HAVING SUM(CASE direction WHEN 'D' THEN amount ELSE -amount END) <> 0;

-- Stored balances vs balances recomputed from entries: must return zero rows.
CREATE VIEW ledger.v_balance_drift AS
SELECT a.id AS account_id, a.account_number, b.balance AS stored,
       COALESCE(SUM(CASE
         WHEN a.type IN ('asset', 'expense') THEN CASE e.direction WHEN 'D' THEN e.amount ELSE -e.amount END
         ELSE CASE e.direction WHEN 'C' THEN e.amount ELSE -e.amount END
       END), 0) AS computed
  FROM ledger.ledger_accounts a
  JOIN ledger.ledger_account_balances b ON b.account_id = a.id
  LEFT JOIN ledger.ledger_entries e ON e.account_id = a.id
 WHERE a.track_balance
 GROUP BY a.id, a.account_number, b.balance
HAVING b.balance <> COALESCE(SUM(CASE
         WHEN a.type IN ('asset', 'expense') THEN CASE e.direction WHEN 'D' THEN e.amount ELSE -e.amount END
         ELSE CASE e.direction WHEN 'C' THEN e.amount ELSE -e.amount END
       END), 0);
