-- =====================================================================
-- VELYNT SERVICES — QR payments (cobro QR)
--
-- A "collect" QR is created by the agent with a fixed amount. At that
-- moment the operation already exists as a pending `qr_payment` (limits
-- are reserved and it shows in the history as "Pago QR ⏳"). The paying
-- customer is only known when BataPay Core reports the payment, so the
-- customer reference may be filled in exactly once, on pending ->
-- processing. Everything else stays as immutable as before.
-- =====================================================================

-- One operation per collect QR, ever (single use).
CREATE UNIQUE INDEX uq_agent_tx_qr ON agent.agent_transactions (qr_id) WHERE qr_id IS NOT NULL;

-- A used QR always points at the operation that used it.
ALTER TABLE agent.agent_qr
  ADD CONSTRAINT agent_qr_used_has_transaction CHECK (status <> 'used' OR (transaction_id IS NOT NULL AND used_at IS NOT NULL));

CREATE INDEX idx_agent_qr_agent_created ON agent.agent_qr (agent_id, created_at DESC);

-- New notification type.
ALTER TABLE agent.agent_notifications DROP CONSTRAINT agent_notifications_type_check;
ALTER TABLE agent.agent_notifications ADD CONSTRAINT agent_notifications_type_check CHECK (type IN (
  'cash_in_completed', 'cash_out_completed', 'qr_payment_completed', 'new_device_detected',
  'account_suspended', 'settlement_completed', 'kyc_document_expiring',
  'operation_pending', 'security_alert', 'limit_changed', 'support_reply'));

-- Same guard as in 02_agent.sql, except that a pending operation without
-- a customer may get one when it starts processing (QR payments).
CREATE OR REPLACE FUNCTION agent.guard_agent_transaction() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.reference <> OLD.reference OR NEW.agent_id <> OLD.agent_id
     OR NEW.type <> OLD.type OR NEW.amount <> OLD.amount OR NEW.currency <> OLD.currency
     OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.created_at <> OLD.created_at
     OR NEW.qr_id IS DISTINCT FROM OLD.qr_id THEN
    RAISE EXCEPTION 'AGENT_TX_IMMUTABLE_FIELDS: operation % cannot be edited', OLD.reference;
  END IF;

  IF NEW.customer_ref IS DISTINCT FROM OLD.customer_ref
     AND NOT (OLD.customer_ref IS NULL AND OLD.status = 'pending' AND NEW.status = 'processing') THEN
    RAISE EXCEPTION 'AGENT_TX_IMMUTABLE_FIELDS: customer of operation % cannot be changed', OLD.reference;
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

-- A QR never comes back to life, and its economic content never changes.
CREATE FUNCTION agent.guard_agent_qr() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.agent_id <> OLD.agent_id OR NEW.kind <> OLD.kind OR NEW.nonce <> OLD.nonce
     OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.currency <> OLD.currency
     OR NEW.single_use <> OLD.single_use OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at <> OLD.created_at
     OR (OLD.transaction_id IS NOT NULL AND NEW.transaction_id IS DISTINCT FROM OLD.transaction_id) THEN
    RAISE EXCEPTION 'AGENT_QR_IMMUTABLE_FIELDS: QR % cannot be edited', OLD.id;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status, NEW.status) IN (
       ('active', 'used'), ('active', 'expired'), ('active', 'revoked'), ('used', 'revoked')) THEN
    RAISE EXCEPTION 'AGENT_QR_INVALID_TRANSITION: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_agent_qr_guard
  BEFORE UPDATE ON agent.agent_qr
  FOR EACH ROW EXECUTE FUNCTION agent.guard_agent_qr();

CREATE TRIGGER trg_agent_qr_no_delete
  BEFORE DELETE ON agent.agent_qr
  FOR EACH ROW EXECUTE FUNCTION agent.forbid_delete();
