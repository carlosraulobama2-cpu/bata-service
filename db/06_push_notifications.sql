-- =====================================================================
-- VELYNT SERVICES — push notification delivery queue
--
-- Every in-app notification gets one push delivery row in the SAME
-- transaction (trigger), so a notification can never be "forgotten" by
-- the sender. A worker picks queued rows, sends them and records the
-- outcome, retrying transient errors with backoff.
-- =====================================================================

ALTER TABLE agent.agent_notification_deliveries
  ADD COLUMN next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN sent_to         INT NOT NULL DEFAULT 0;   -- devices reached

-- 'skipped': nothing to send (no device with push, or the agent turned this type off).
ALTER TABLE agent.agent_notification_deliveries DROP CONSTRAINT agent_notification_deliveries_status_check;
ALTER TABLE agent.agent_notification_deliveries ADD CONSTRAINT agent_notification_deliveries_status_check
  CHECK (status IN ('queued', 'sent', 'failed', 'skipped'));

CREATE UNIQUE INDEX uq_notification_delivery_channel ON agent.agent_notification_deliveries (notification_id, channel);
CREATE INDEX idx_deliveries_queued ON agent.agent_notification_deliveries (next_attempt_at) WHERE status = 'queued';

CREATE FUNCTION agent.enqueue_push_delivery() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO agent.agent_notification_deliveries (notification_id, channel) VALUES (NEW.id, 'push');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notification_enqueue_push
  AFTER INSERT ON agent.agent_notifications
  FOR EACH ROW EXECUTE FUNCTION agent.enqueue_push_delivery();

-- Push tokens are per device; one token belongs to one device only.
CREATE UNIQUE INDEX uq_agent_devices_push_token ON agent.agent_devices (push_token) WHERE push_token IS NOT NULL;
