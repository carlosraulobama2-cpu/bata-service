-- =====================================================================
-- VELYNT SERVICES — basic risk engine (Phase 1)
--
-- Default rules, version 1. Parameters and weights are STARTING VALUES
-- to tune with real data (docs/06-seguridad.md §8). Following the design,
-- scoring rules start in 'shadow' mode: they are evaluated and recorded
-- but do not decide until someone switches them to 'active' (audited).
-- 'duplicate' is active from the start: it doesn't block, it only asks
-- the agent to confirm a repeated operation.
-- =====================================================================

INSERT INTO agent.fraud_rules (code, version, description, enabled, mode, weight, params) VALUES
  ('duplicate', 1, 'Deposit with the same agent, customer and amount within a short window: ask the agent to confirm', TRUE, 'active', 0,
     '{"window_minutes": 10}'),
  ('velocity_agent', 1, 'Too many operations by the agent in a short window', TRUE, 'shadow', 30,
     '{"window_minutes": 5, "max_operations": 5}'),
  ('amount_unusual', 1, 'Amount far above the agent''s usual amount for this operation type', TRUE, 'shadow', 25,
     '{"multiplier": 5, "min_history": 10, "lookback_days": 30}'),
  ('circular', 1, 'Cash-in followed by cash-out (or the reverse) for the same customer at the same agent', TRUE, 'shadow', 45,
     '{"window_minutes": 30}'),
  ('structuring', 1, 'Several operations just below the per-operation limit in a short window', TRUE, 'shadow', 40,
     '{"window_minutes": 60, "min_operations": 3, "threshold_pct": 90}'),
  ('customer_velocity', 1, 'The same customer operating many times or at many agents in a short window', TRUE, 'shadow', 30,
     '{"window_minutes": 60, "max_operations": 6, "max_agents": 3}'),
  ('new_device', 1, 'Operation from a device trusted less than the cooldown period ago', TRUE, 'shadow', 15, '{}');

-- Rules are versioned, never edited in place.
CREATE FUNCTION agent.guard_fraud_rule() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code <> OLD.code OR NEW.version <> OLD.version OR NEW.params <> OLD.params OR NEW.weight <> OLD.weight THEN
    RAISE EXCEPTION 'FRAUD_RULE_IMMUTABLE: create a new version of rule %', OLD.code;
  END IF;
  RETURN NEW;  -- only enabled / mode may change (switching shadow <-> active)
END;
$$;

CREATE TRIGGER trg_fraud_rule_guard BEFORE UPDATE ON agent.fraud_rules
  FOR EACH ROW EXECUTE FUNCTION agent.guard_fraud_rule();

-- Customer-side rules look across agents.
CREATE INDEX idx_agent_tx_customer_created ON agent.agent_transactions (customer_ref, created_at DESC) WHERE customer_ref IS NOT NULL;

CREATE SEQUENCE agent.fraud_case_ref_seq START 1;
ALTER TABLE agent.fraud_cases ALTER COLUMN reference SET DEFAULT ('FRC-' || lpad(nextval('agent.fraud_case_ref_seq')::text, 6, '0'));
GRANT USAGE, SELECT ON SEQUENCE agent.fraud_case_ref_seq TO agent_app;
