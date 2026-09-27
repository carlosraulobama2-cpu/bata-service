-- =====================================================================
-- BATA SERVICES — PIN history and invalid-code throttling
-- =====================================================================

-- Previous PIN hashes: a new PIN must differ from the last 3
-- (docs/05-api.md §12). Append-only.
CREATE TABLE agent.agent_pin_history (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_id    UUID NOT NULL REFERENCES agent.agents (id),
  pin_hash    TEXT NOT NULL CHECK (pin_hash LIKE '$argon2id$%'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pin_history_agent ON agent.agent_pin_history (agent_id, id DESC);

CREATE TRIGGER trg_pin_history_append_only
  BEFORE UPDATE OR DELETE ON agent.agent_pin_history
  FOR EACH ROW EXECUTE FUNCTION agent.forbid_delete();

-- Invalid withdrawal codes / QR codes typed or scanned by an agent.
-- 5 in 10 minutes blocks the function for a while (anti code-guessing,
-- docs/06-seguridad.md). Old rows can be purged by a maintenance job.
CREATE TABLE agent.agent_code_failures (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_id    UUID NOT NULL REFERENCES agent.agents (id),
  kind        TEXT NOT NULL CHECK (kind IN ('withdrawal_code', 'qr')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_code_failures_agent_time ON agent.agent_code_failures (agent_id, created_at DESC);

GRANT SELECT, INSERT ON agent.agent_pin_history, agent.agent_code_failures TO agent_app;
GRANT DELETE ON agent.agent_code_failures TO agent_app;
