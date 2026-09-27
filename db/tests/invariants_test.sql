-- =====================================================================
-- Invariant tests for the ledger and agent schemas.
-- Run on an EMPTY database after every db/NN_*.sql file:
--   psql -v ON_ERROR_STOP=1 -f db/tests/invariants_test.sql
-- Every block raises an exception if an invariant is broken.
-- =====================================================================

\set QUIET on
\pset tuples_only on
\pset format unaligned
SET client_min_messages = warning;

-- Helper: runs a statement and asserts it fails with the expected message.
CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql TEXT, p_expected TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
    SET CONSTRAINTS ALL IMMEDIATE;   -- fire deferred checks inside this block
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%' || p_expected || '%' THEN
      RAISE EXCEPTION 'Expected error "%", got "%"', p_expected, SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Expected error "%" but the statement succeeded: %', p_expected, p_sql;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.bal(p_number TEXT) RETURNS BIGINT
LANGUAGE sql AS $$
  SELECT b.balance FROM ledger.ledger_account_balances b
  JOIN ledger.ledger_accounts a ON a.id = b.account_id WHERE a.account_number = p_number;
$$;

CREATE OR REPLACE FUNCTION pg_temp.avail(p_number TEXT) RETURNS BIGINT
LANGUAGE sql AS $$
  SELECT b.balance - b.held FROM ledger.ledger_account_balances b
  JOIN ledger.ledger_accounts a ON a.id = b.account_id WHERE a.account_number = p_number;
$$;

CREATE OR REPLACE FUNCTION pg_temp.acc(p_number TEXT) RETURNS UUID
LANGUAGE sql AS $$ SELECT id FROM ledger.ledger_accounts WHERE account_number = p_number; $$;

CREATE OR REPLACE FUNCTION pg_temp.assert_eq(p_actual ANYELEMENT, p_expected ANYELEMENT, p_label TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'FAIL %: expected %, got %', p_label, p_expected, p_actual;
  END IF;
  RAISE NOTICE 'ok - %', p_label;
END;
$$;

SET client_min_messages = notice;

-- ---------------------------------------------------------------------
-- Ledger setup: chart of accounts
-- ---------------------------------------------------------------------
INSERT INTO ledger.ledger_accounts (account_number, owner_type, owner_ref, purpose, type, currency, track_balance) VALUES
  ('SYS-BANK-XAF',     'system',   'bank',        'settlement_bank',          'asset',     'XAF', TRUE),
  ('SYS-COMEXP-XAF',   'system',   'commissions', 'commission_expense',       'expense',   'XAF', FALSE),
  ('SYS-FEEREV-XAF',   'system',   'fees',        'fee_revenue',              'revenue',   'XAF', FALSE),
  ('AGF-AG000001-XAF', 'agent',    'AG-000001',   'agent_float',              'liability', 'XAF', TRUE),
  ('AGC-AG000001-XAF', 'agent',    'AG-000001',   'agent_commission_payable', 'liability', 'XAF', TRUE),
  ('CUS-U4821-XAF',    'customer', 'user-4821',   'customer_wallet',          'liability', 'XAF', TRUE);

-- 1) Float top-up: agent deposits 1.000.000 XAF in BataPay's bank account.
SELECT ledger.post_transaction('BTX-00000001', 'agent-service', 'idem-topup-1', 'float_topup',
  jsonb_build_array(
    jsonb_build_object('account_id', pg_temp.acc('SYS-BANK-XAF'),     'direction', 'D', 'amount', 1000000),
    jsonb_build_object('account_id', pg_temp.acc('AGF-AG000001-XAF'), 'direction', 'C', 'amount', 1000000)),
  'svc:agent-service');
SELECT pg_temp.assert_eq(pg_temp.bal('AGF-AG000001-XAF'), 1000000::bigint, 'float after top-up');

-- 2) Cash-in 100.000 XAF: hold on float while the customer confirms.
SELECT ledger.create_hold(pg_temp.acc('AGF-AG000001-XAF'), 100000, 'agent-service', 'agtx-1', NOW() + INTERVAL '3 minutes');
SELECT pg_temp.assert_eq(pg_temp.avail('AGF-AG000001-XAF'), 900000::bigint, 'available float with hold');

-- Hold is idempotent.
SELECT ledger.create_hold(pg_temp.acc('AGF-AG000001-XAF'), 100000, 'agent-service', 'agtx-1', NOW() + INTERVAL '3 minutes');
SELECT pg_temp.assert_eq(pg_temp.avail('AGF-AG000001-XAF'), 900000::bigint, 'hold not duplicated');

-- Customer confirmed: capture the hold and post cash-in + commission in ONE transaction.
SELECT ledger.post_transaction('BTX-00000002', 'agent-service', 'idem-cashin-1', 'cash_in',
  jsonb_build_array(
    jsonb_build_object('account_id', pg_temp.acc('AGF-AG000001-XAF'), 'direction', 'D', 'amount', 100000),
    jsonb_build_object('account_id', pg_temp.acc('CUS-U4821-XAF'),    'direction', 'C', 'amount', 100000),
    jsonb_build_object('account_id', pg_temp.acc('SYS-COMEXP-XAF'),   'direction', 'D', 'amount', 500),
    jsonb_build_object('account_id', pg_temp.acc('AGC-AG000001-XAF'), 'direction', 'C', 'amount', 500)),
  'svc:agent-service', 'agtx-1', NULL, '{}'::jsonb,
  ARRAY(SELECT id FROM ledger.ledger_holds WHERE external_ref = 'agtx-1'));

SELECT pg_temp.assert_eq(pg_temp.bal('AGF-AG000001-XAF'), 900000::bigint, 'float after cash-in');
SELECT pg_temp.assert_eq(pg_temp.avail('AGF-AG000001-XAF'), 900000::bigint, 'hold captured');
SELECT pg_temp.assert_eq(pg_temp.bal('CUS-U4821-XAF'), 100000::bigint, 'customer after cash-in');
SELECT pg_temp.assert_eq(pg_temp.bal('AGC-AG000001-XAF'), 500::bigint, 'commission payable after cash-in');

-- 3) Replaying the same request returns the same transaction (no double execution).
DO $$
DECLARE first_id UUID; again_id UUID; n BIGINT;
BEGIN
  SELECT id INTO first_id FROM ledger.ledger_transactions WHERE idempotency_key = 'idem-cashin-1';
  again_id := ledger.post_transaction('BTX-00000002', 'agent-service', 'idem-cashin-1', 'cash_in',
    jsonb_build_array(
      jsonb_build_object('account_id', pg_temp.acc('AGF-AG000001-XAF'), 'direction', 'D', 'amount', 100000),
      jsonb_build_object('account_id', pg_temp.acc('CUS-U4821-XAF'),    'direction', 'C', 'amount', 100000),
      jsonb_build_object('account_id', pg_temp.acc('SYS-COMEXP-XAF'),   'direction', 'D', 'amount', 500),
      jsonb_build_object('account_id', pg_temp.acc('AGC-AG000001-XAF'), 'direction', 'C', 'amount', 500)),
    'svc:agent-service', 'agtx-1');
  PERFORM pg_temp.assert_eq(again_id, first_id, 'idempotent replay returns same id');
  SELECT COUNT(*) INTO n FROM ledger.ledger_entries WHERE transaction_id = first_id;
  PERFORM pg_temp.assert_eq(n, 4::bigint, 'no duplicated entries');
  PERFORM pg_temp.assert_eq(pg_temp.bal('CUS-U4821-XAF'), 100000::bigint, 'customer not credited twice');
END $$;

-- 4) Same key, different payload => rejected.
SELECT pg_temp.expect_error($q$
  SELECT ledger.post_transaction('BTX-X', 'agent-service', 'idem-cashin-1', 'cash_in',
    jsonb_build_array(
      jsonb_build_object('account_id', pg_temp.acc('AGF-AG000001-XAF'), 'direction', 'D', 'amount', 999),
      jsonb_build_object('account_id', pg_temp.acc('CUS-U4821-XAF'),    'direction', 'C', 'amount', 999)),
    'svc:agent-service', 'agtx-1')
$q$, 'LEDGER_IDEMPOTENCY_CONFLICT');
SELECT pg_temp.assert_eq(TRUE, TRUE, 'idempotency key reuse with other payload rejected');

-- 5) Unbalanced transaction => rejected at commit.
SELECT pg_temp.expect_error($q$
  SELECT ledger.post_transaction('BTX-UNBAL', 'agent-service', 'idem-unbal', 'adjustment',
    jsonb_build_array(
      jsonb_build_object('account_id', pg_temp.acc('SYS-BANK-XAF'),  'direction', 'D', 'amount', 1000),
      jsonb_build_object('account_id', pg_temp.acc('CUS-U4821-XAF'), 'direction', 'C', 'amount', 900)),
    'svc:agent-service')
$q$, 'LEDGER_UNBALANCED');
SELECT pg_temp.assert_eq(TRUE, TRUE, 'unbalanced transaction rejected');

-- 6) Insufficient float => rejected (no negative balances).
SELECT pg_temp.expect_error($q$
  SELECT ledger.post_transaction('BTX-BIG', 'agent-service', 'idem-big', 'cash_in',
    jsonb_build_array(
      jsonb_build_object('account_id', pg_temp.acc('AGF-AG000001-XAF'), 'direction', 'D', 'amount', 5000000),
      jsonb_build_object('account_id', pg_temp.acc('CUS-U4821-XAF'),    'direction', 'C', 'amount', 5000000)),
    'svc:agent-service')
$q$, 'LEDGER_INSUFFICIENT_FUNDS');
SELECT pg_temp.expect_error($q$
  SELECT ledger.create_hold(pg_temp.acc('AGF-AG000001-XAF'), 900001, 'agent-service', 'agtx-too-big', NOW() + INTERVAL '3 minutes')
$q$, 'LEDGER_INSUFFICIENT_FUNDS');
SELECT pg_temp.assert_eq(TRUE, TRUE, 'overdraft rejected for postings and holds');

-- 7) Journal is immutable.
SELECT pg_temp.expect_error('UPDATE ledger.ledger_entries SET amount = 1', 'LEDGER_IMMUTABLE');
SELECT pg_temp.expect_error('DELETE FROM ledger.ledger_entries', 'LEDGER_IMMUTABLE');
SELECT pg_temp.expect_error('UPDATE ledger.ledger_transactions SET description = $$x$$', 'LEDGER_IMMUTABLE');
SELECT pg_temp.expect_error('TRUNCATE ledger.ledger_transactions CASCADE', 'LEDGER_IMMUTABLE');
SELECT pg_temp.assert_eq(TRUE, TRUE, 'ledger rows cannot be updated, deleted or truncated');

-- 8) Cash-out 50.000 XAF.
SELECT ledger.post_transaction('BTX-00000003', 'agent-service', 'idem-cashout-1', 'cash_out',
  jsonb_build_array(
    jsonb_build_object('account_id', pg_temp.acc('CUS-U4821-XAF'),    'direction', 'D', 'amount', 50000),
    jsonb_build_object('account_id', pg_temp.acc('AGF-AG000001-XAF'), 'direction', 'C', 'amount', 50000)),
  'svc:agent-service', 'agtx-2');
SELECT pg_temp.assert_eq(pg_temp.bal('CUS-U4821-XAF'), 50000::bigint, 'customer after cash-out');
SELECT pg_temp.assert_eq(pg_temp.bal('AGF-AG000001-XAF'), 950000::bigint, 'float after cash-out');

-- 9) Reversal of the cash-out: mirrored entries, only once.
SELECT ledger.reverse_transaction(
  (SELECT id FROM ledger.ledger_transactions WHERE reference = 'BTX-00000003'),
  'BTX-00000004', 'agent-service', 'idem-rev-1', 'staff:finance-1', 'Operación duplicada confirmada por soporte');
SELECT pg_temp.assert_eq(pg_temp.bal('CUS-U4821-XAF'), 100000::bigint, 'customer after reversal');
SELECT pg_temp.assert_eq(pg_temp.bal('AGF-AG000001-XAF'), 900000::bigint, 'float after reversal');
SELECT pg_temp.expect_error($q$
  SELECT ledger.reverse_transaction(
    (SELECT id FROM ledger.ledger_transactions WHERE reference = 'BTX-00000003'),
    'BTX-00000005', 'agent-service', 'idem-rev-2', 'staff:finance-1', 'second try')
$q$, 'duplicate key');
SELECT pg_temp.assert_eq(TRUE, TRUE, 'a transaction cannot be reversed twice');

-- 10) Reconciliation views are clean.
SELECT pg_temp.assert_eq((SELECT COUNT(*) FROM ledger.v_unbalanced_transactions), 0::bigint, 'trial balance: no unbalanced transactions');
SELECT pg_temp.assert_eq((SELECT COUNT(*) FROM ledger.v_balance_drift), 0::bigint, 'stored balances match entries');

-- ---------------------------------------------------------------------
-- Agent schema
-- ---------------------------------------------------------------------
INSERT INTO agent.agent_tiers (code, name) VALUES ('tier_1', 'Nivel 1');
INSERT INTO agent.staff_users (id, email, full_name) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'compliance@batapay.test', 'Compliance'),
  ('00000000-0000-0000-0000-00000000000b', 'admin@batapay.test', 'Admin');

INSERT INTO agent.agents (id, country, phone_e164, tier_code)
VALUES ('10000000-0000-0000-0000-000000000001', 'GQ', '+240222000001', 'tier_1');

-- 11) An agent cannot jump from pending to active.
SELECT pg_temp.expect_error($q$
  UPDATE agent.agents SET status = 'active', agent_code = 'AG-999999',
    approved_by = '00000000-0000-0000-0000-00000000000a', activated_by = '00000000-0000-0000-0000-00000000000b'
  WHERE id = '10000000-0000-0000-0000-000000000001'
$q$, 'AGENT_INVALID_TRANSITION');
SELECT pg_temp.assert_eq(TRUE, TRUE, 'pending -> active is forbidden');

-- Proper path, and the approver cannot also be the activator.
UPDATE agent.agents SET status = 'under_review' WHERE id = '10000000-0000-0000-0000-000000000001';
UPDATE agent.agents SET status = 'approved', agent_code = agent.next_agent_code(),
  approved_by = '00000000-0000-0000-0000-00000000000a', approved_at = NOW()
  WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT pg_temp.expect_error($q$
  UPDATE agent.agents SET status = 'active', activated_by = '00000000-0000-0000-0000-00000000000a'
  WHERE id = '10000000-0000-0000-0000-000000000001'
$q$, 'agents_check');
UPDATE agent.agents SET status = 'active', activated_by = '00000000-0000-0000-0000-00000000000b', activated_at = NOW()
  WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_eq((SELECT agent_code FROM agent.agents WHERE id = '10000000-0000-0000-0000-000000000001'), 'AG-000001', 'agent code assigned on approval');
SELECT pg_temp.assert_eq((SELECT COUNT(*) FROM agent.agent_status_history), 3::bigint, 'status history recorded');

-- 12) Operations: economic fields immutable, forward-only states.
INSERT INTO agent.agent_transactions (id, agent_id, type, amount, currency, method, idempotency_key, customer_ref, customer_masked)
VALUES ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
        'cash_out', 50000, 'XAF', 'qr', 'b3f1c2d4e5f60718293a4b5c', 'user-4821', '****4821');

SELECT pg_temp.expect_error($q$
  INSERT INTO agent.agent_transactions (agent_id, type, amount, currency, method, idempotency_key)
  VALUES ('10000000-0000-0000-0000-000000000001', 'cash_out', 50000, 'XAF', 'qr', 'b3f1c2d4e5f60718293a4b5c')
$q$, 'duplicate key');
SELECT pg_temp.assert_eq(TRUE, TRUE, 'same idempotency key cannot create a second operation');

SELECT pg_temp.expect_error($q$
  UPDATE agent.agent_transactions SET amount = 1 WHERE id = '20000000-0000-0000-0000-000000000001'
$q$, 'AGENT_TX_IMMUTABLE_FIELDS');
SELECT pg_temp.expect_error($q$
  UPDATE agent.agent_transactions SET status = 'completed' WHERE id = '20000000-0000-0000-0000-000000000001'
$q$, 'AGENT_TX_INVALID_TRANSITION');

UPDATE agent.agent_transactions SET status = 'processing' WHERE id = '20000000-0000-0000-0000-000000000001';
SELECT pg_temp.expect_error($q$
  UPDATE agent.agent_transactions SET status = 'completed', completed_at = NOW() WHERE id = '20000000-0000-0000-0000-000000000001'
$q$, 'agent_transactions_check');  -- completed requires a ledger transaction id
UPDATE agent.agent_transactions
   SET status = 'completed', completed_at = NOW(), commission_amount = 500,
       ledger_transaction_id = (SELECT id FROM ledger.ledger_transactions WHERE reference = 'BTX-00000003')
 WHERE id = '20000000-0000-0000-0000-000000000001';
SELECT pg_temp.expect_error($q$
  UPDATE agent.agent_transactions SET commission_amount = 9999 WHERE id = '20000000-0000-0000-0000-000000000001'
$q$, 'AGENT_TX_IMMUTABLE_FIELDS');
SELECT pg_temp.expect_error($q$
  UPDATE agent.agent_transactions SET status = 'pending' WHERE id = '20000000-0000-0000-0000-000000000001'
$q$, 'AGENT_TX_INVALID_TRANSITION');
SELECT pg_temp.expect_error($q$
  DELETE FROM agent.agent_transactions WHERE id = '20000000-0000-0000-0000-000000000001'
$q$, 'APPEND_ONLY');
SELECT pg_temp.assert_eq((SELECT COUNT(*) FROM agent.agent_transaction_events), 2::bigint, 'state changes recorded as events');
SELECT pg_temp.assert_eq(TRUE, TRUE, 'completed operations cannot be edited or deleted');

-- 13) Audit log: hash chain + append-only.
INSERT INTO agent.agent_audit_logs (stream, actor_type, actor_id, agent_id, action, resource_type, resource_id, result, ip)
VALUES ('agent:10000000-0000-0000-0000-000000000001', 'agent', 'AG-000001', '10000000-0000-0000-0000-000000000001',
        'LOGIN', 'session', NULL, 'success', '41.202.0.10');
INSERT INTO agent.agent_audit_logs (stream, actor_type, actor_id, agent_id, action, resource_type, resource_id, result, ip)
VALUES ('agent:10000000-0000-0000-0000-000000000001', 'agent', 'AG-000001', '10000000-0000-0000-0000-000000000001',
        'CASH_OUT', 'transaction', 'BTX-00000003', 'success', '41.202.0.10');
SELECT pg_temp.assert_eq(
  (SELECT prev_hash FROM agent.agent_audit_logs ORDER BY id DESC LIMIT 1),
  (SELECT hash FROM agent.agent_audit_logs ORDER BY id ASC LIMIT 1),
  'audit entries are hash-chained');
SELECT pg_temp.expect_error('UPDATE agent.agent_audit_logs SET result = $$failure$$', 'APPEND_ONLY');
SELECT pg_temp.expect_error('DELETE FROM agent.agent_audit_logs', 'APPEND_ONLY');
SELECT pg_temp.assert_eq(TRUE, TRUE, 'audit logs cannot be modified or deleted');

-- 14) Security notifications cannot be disabled.
SELECT pg_temp.expect_error($q$
  INSERT INTO agent.agent_notification_preferences (agent_id, type, push_enabled)
  VALUES ('10000000-0000-0000-0000-000000000001', 'new_device_detected', FALSE)
$q$, 'check');
SELECT pg_temp.assert_eq(TRUE, TRUE, 'security notifications are mandatory');

-- 15) PIN must be an argon2id hash, never plain text.
SELECT pg_temp.expect_error($q$
  INSERT INTO agent.agent_credentials (agent_id, pin_hash) VALUES ('10000000-0000-0000-0000-000000000001', '123456')
$q$, 'agent_credentials_pin_hash_check');
SELECT pg_temp.assert_eq(TRUE, TRUE, 'plain-text PIN rejected');

-- 16) QR payments (04_qr_payments.sql): single use, customer filled in once.
INSERT INTO agent.agent_qr (id, agent_id, kind, nonce, amount, currency, single_use, expires_at)
VALUES ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
        'collect', 'nonce-qr-test-0001', 25000, 'XAF', TRUE, NOW() + INTERVAL '5 minutes');
SELECT pg_temp.expect_error($q$
  INSERT INTO agent.agent_qr (agent_id, kind, nonce, currency, single_use)
  VALUES ('10000000-0000-0000-0000-000000000001', 'collect', 'nonce-qr-test-0002', 'XAF', TRUE)
$q$, 'agent_qr_check');
SELECT pg_temp.assert_eq(TRUE, TRUE, 'a collect QR always has amount and expiry');
SELECT pg_temp.expect_error($q$
  UPDATE agent.agent_qr SET status = 'used', used_at = NOW() WHERE id = '30000000-0000-0000-0000-000000000001'
$q$, 'agent_qr_used_has_transaction');
SELECT pg_temp.assert_eq(TRUE, TRUE, 'a used QR points at its operation');

INSERT INTO agent.agent_transactions (id, agent_id, type, amount, currency, method, idempotency_key, qr_id, expires_at)
VALUES ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
        'qr_payment', 25000, 'XAF', 'qr', 'qr-idem-key-000000000001', '30000000-0000-0000-0000-000000000001', NOW() + INTERVAL '5 minutes');
UPDATE agent.agent_qr SET transaction_id = '20000000-0000-0000-0000-000000000002' WHERE id = '30000000-0000-0000-0000-000000000001';
SELECT pg_temp.expect_error($q$
  INSERT INTO agent.agent_transactions (agent_id, type, amount, currency, method, idempotency_key, qr_id)
  VALUES ('10000000-0000-0000-0000-000000000001', 'qr_payment', 25000, 'XAF', 'qr', 'qr-idem-key-000000000002', '30000000-0000-0000-0000-000000000001')
$q$, 'uq_agent_tx_qr');
SELECT pg_temp.assert_eq(TRUE, TRUE, 'a collect QR can be paid only once');
SELECT pg_temp.expect_error($q$
  UPDATE agent.agent_transactions SET customer_ref = 'user-1111' WHERE id = '20000000-0000-0000-0000-000000000002'
$q$, 'AGENT_TX_IMMUTABLE_FIELDS');
UPDATE agent.agent_transactions SET status = 'processing', customer_ref = 'user-4821', customer_masked = '****4821'
 WHERE id = '20000000-0000-0000-0000-000000000002';
SELECT pg_temp.expect_error($q$
  UPDATE agent.agent_transactions SET customer_ref = 'user-9999' WHERE id = '20000000-0000-0000-0000-000000000002'
$q$, 'AGENT_TX_IMMUTABLE_FIELDS');
SELECT pg_temp.assert_eq(TRUE, TRUE, 'the paying customer is set once, when the payment starts');
UPDATE agent.agent_qr SET status = 'used', used_at = NOW() WHERE id = '30000000-0000-0000-0000-000000000001';
SELECT pg_temp.expect_error($q$
  UPDATE agent.agent_qr SET status = 'active' WHERE id = '30000000-0000-0000-0000-000000000001'
$q$, 'AGENT_QR_INVALID_TRANSITION');
SELECT pg_temp.expect_error($q$
  UPDATE agent.agent_qr SET amount = 1 WHERE id = '30000000-0000-0000-0000-000000000001'
$q$, 'AGENT_QR_IMMUTABLE_FIELDS');
SELECT pg_temp.expect_error($q$
  DELETE FROM agent.agent_qr WHERE id = '30000000-0000-0000-0000-000000000001'
$q$, 'APPEND_ONLY');
SELECT pg_temp.assert_eq(TRUE, TRUE, 'a used QR cannot be reactivated, edited or deleted');

\echo 'ALL INVARIANT TESTS PASSED'
