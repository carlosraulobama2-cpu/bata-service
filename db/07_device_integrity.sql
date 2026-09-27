-- =====================================================================
-- BATA SERVICES — device integrity signals
--
-- The app reports whether the phone is rooted / jailbroken or an
-- emulator. A compromised device may still sign in and read, but can't
-- operate (policy decided by the business, docs/06-seguridad.md §4).
-- These are CLIENT-REPORTED signals: they stop honest mistakes and
-- casual tampering; Play Integrity / App Attest attestation, verified on
-- the server, is the stronger check to add on top.
-- =====================================================================

ALTER TABLE agent.agent_devices
  ADD COLUMN integrity_flags      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {"rooted": false, "emulator": false}
  ADD COLUMN integrity_checked_at TIMESTAMPTZ,
  ADD COLUMN compromised          BOOLEAN GENERATED ALWAYS AS (
    COALESCE((integrity_flags ->> 'rooted')::boolean, FALSE) OR COALESCE((integrity_flags ->> 'emulator')::boolean, FALSE)
  ) STORED;
