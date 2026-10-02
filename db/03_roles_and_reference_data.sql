-- =====================================================================
-- DATABASE ROLES (least privilege) + RBAC reference data
-- =====================================================================

-- Application roles (NOLOGIN groups; real login users are created per
-- environment and granted one of these).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_app') THEN
    CREATE ROLE agent_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_app') THEN
    CREATE ROLE ledger_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_analyst') THEN
    CREATE ROLE readonly_analyst NOLOGIN;
  END IF;
END
$$;

-- Ledger: the ledger service may read and INSERT, never UPDATE/DELETE
-- journal rows (triggers also forbid it, even for owners).
GRANT USAGE ON SCHEMA ledger TO ledger_app;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA ledger TO ledger_app;
GRANT UPDATE ON ledger.ledger_account_balances, ledger.ledger_holds, ledger.reconciliation_runs TO ledger_app;
GRANT UPDATE (status) ON ledger.ledger_accounts TO ledger_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ledger TO ledger_app;
REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA ledger FROM ledger_app;

-- Agent service: no access at all to the ledger schema.
REVOKE ALL ON SCHEMA ledger FROM agent_app;
GRANT USAGE ON SCHEMA agent TO agent_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA agent TO agent_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA agent TO agent_app;
REVOKE UPDATE, DELETE, TRUNCATE ON agent.agent_audit_logs, agent.agent_transaction_events,
  agent.agent_status_history, agent.agent_access_events FROM agent_app;
REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA agent FROM agent_app;
-- Only housekeeping jobs delete expired idempotency keys / OTPs.
GRANT DELETE ON agent.idempotency_keys, agent.agent_otp_challenges TO agent_app;

-- Analysts / BI read a replica, never PII columns.
GRANT USAGE ON SCHEMA agent TO readonly_analyst;
GRANT SELECT (id, reference, agent_id, type, status, amount, currency, fee_amount, commission_amount,
              method, risk_level, created_at, completed_at)
  ON agent.agent_transactions TO readonly_analyst;

-- ---------------------------------------------------------------------
-- RBAC reference data
-- ---------------------------------------------------------------------
INSERT INTO agent.roles (code, description) VALUES
  ('AGENT',      'Agente autorizado: opera desde Velynt Services'),
  ('SUPERVISOR', 'Supervisor de zona: consulta y acompaña a sus agentes'),
  ('ADMIN',      'Administración de la red de agentes'),
  ('COMPLIANCE', 'Revisión KYC, casos de riesgo y cumplimiento'),
  ('SUPPORT',    'Atención de incidencias'),
  ('FINANCE',    'Liquidaciones, conciliación y comisiones');

INSERT INTO agent.permissions (code, description) VALUES
  -- agent (self) permissions
  ('self:profile.read',          'Ver su propio perfil'),
  ('self:kyc.submit',            'Enviar su propio KYC'),
  ('self:balance.read',          'Ver sus saldos'),
  ('self:cash_in.create',        'Crear cash-in'),
  ('self:cash_out.create',       'Crear cash-out'),
  ('self:qr.create',             'Crear QR propios'),
  ('self:qr.scan',               'Escanear QR'),
  ('self:transactions.read',     'Ver sus operaciones'),
  ('self:commissions.read',      'Ver sus comisiones'),
  ('self:settlements.read',      'Ver sus liquidaciones'),
  ('self:support.manage',        'Crear y seguir sus incidencias'),
  ('self:security.manage',       'Gestionar PIN, dispositivos y sesiones propios'),
  -- back-office permissions
  ('agents.read',                'Ver agentes (según alcance)'),
  ('agents.approve',             'Aprobar solicitudes de agente'),
  ('agents.activate',            'Activar agentes aprobados'),
  ('agents.suspend',             'Suspender / bloquear agentes'),
  ('agents.terminate',           'Dar de baja agentes'),
  ('kyc.review',                 'Revisar KYC y ver documentos'),
  ('kyc.config',                 'Configurar requisitos KYC por país'),
  ('limits.request',             'Solicitar cambios de límites'),
  ('limits.approve',             'Aprobar cambios de límites'),
  ('transactions.read_all',      'Ver operaciones de todos los agentes'),
  ('transactions.reverse',       'Solicitar reversos'),
  ('risk.cases.manage',          'Gestionar casos de riesgo'),
  ('risk.rules.manage',          'Configurar reglas de riesgo'),
  ('commissions.config',         'Configurar planes de comisión'),
  ('commissions.approve',        'Aprobar planes de comisión'),
  ('settlements.manage',         'Preparar liquidaciones'),
  ('settlements.approve',        'Aprobar liquidaciones'),
  ('reconciliation.read',        'Ver conciliaciones'),
  ('support.tickets.manage',     'Gestionar incidencias'),
  ('audit.read',                 'Consultar audit logs'),
  ('devices.revoke',             'Revocar dispositivos / sesiones de agentes');

INSERT INTO agent.role_permissions (role_code, permission_code)
SELECT 'AGENT', code FROM agent.permissions WHERE code LIKE 'self:%';

INSERT INTO agent.role_permissions (role_code, permission_code) VALUES
  ('SUPERVISOR', 'agents.read'),
  ('SUPERVISOR', 'transactions.read_all'),
  ('SUPERVISOR', 'support.tickets.manage'),
  ('SUPERVISOR', 'limits.request'),

  ('ADMIN', 'agents.read'),
  ('ADMIN', 'agents.activate'),
  ('ADMIN', 'agents.suspend'),
  ('ADMIN', 'agents.terminate'),
  ('ADMIN', 'limits.request'),
  ('ADMIN', 'limits.approve'),
  ('ADMIN', 'transactions.read_all'),
  ('ADMIN', 'support.tickets.manage'),
  ('ADMIN', 'devices.revoke'),
  ('ADMIN', 'audit.read'),

  ('COMPLIANCE', 'agents.read'),
  ('COMPLIANCE', 'agents.approve'),
  ('COMPLIANCE', 'agents.suspend'),
  ('COMPLIANCE', 'kyc.review'),
  ('COMPLIANCE', 'kyc.config'),
  ('COMPLIANCE', 'transactions.read_all'),
  ('COMPLIANCE', 'risk.cases.manage'),
  ('COMPLIANCE', 'risk.rules.manage'),
  ('COMPLIANCE', 'audit.read'),
  ('COMPLIANCE', 'devices.revoke'),

  ('SUPPORT', 'agents.read'),
  ('SUPPORT', 'transactions.read_all'),
  ('SUPPORT', 'support.tickets.manage'),

  ('FINANCE', 'agents.read'),
  ('FINANCE', 'transactions.read_all'),
  ('FINANCE', 'transactions.reverse'),
  ('FINANCE', 'commissions.config'),
  ('FINANCE', 'commissions.approve'),
  ('FINANCE', 'settlements.manage'),
  ('FINANCE', 'settlements.approve'),
  ('FINANCE', 'reconciliation.read');
