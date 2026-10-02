# 03 · Base de datos (PostgreSQL)

El DDL completo y ejecutable está en [`db/`](../db):

| Archivo | Contenido |
|---|---|
| [`db/01_ledger.sql`](../db/01_ledger.sql) | Ledger de doble partida: cuentas, transacciones, asientos, holds, conciliación, funciones de contabilización |
| [`db/02_agent.sql`](../db/02_agent.sql) | Base de datos del Agent Backend: agentes, KYC, dispositivos, sesiones, límites, operaciones, comisiones, liquidaciones, QR, notificaciones, soporte, riesgo, auditoría |
| [`db/03_roles_and_reference_data.sql`](../db/03_roles_and_reference_data.sql) | Roles de base de datos con mínimo privilegio y datos de RBAC |
| [`db/tests/invariants_test.sql`](../db/tests/invariants_test.sql) | 31 comprobaciones automáticas de las reglas (idempotencia, doble partida, inmutabilidad, transiciones de estado…) |

Probado en PostgreSQL 16 (`./db/tests/run.sh`). Requiere PostgreSQL 15+ (`UNIQUE NULLS NOT DISTINCT`).

## 1. Dos bases de datos, dos dueños

- **`ledger`**: pertenece al servicio Ledger (core de Velynt). El Agent Backend **no tiene permisos** sobre ella (ver `REVOKE` en `03_roles…`): solo la usa a través de la API interna del Ledger.
- **`agent`**: pertenece al Agent Backend.

En desarrollo pueden vivir en el mismo servidor como dos *schemas*. En producción, en bases de datos separadas. Por eso **no hay claves foráneas entre ellas**: se referencian con IDs opacos (`ledger_transaction_id`, `ledger_account_id`, `customer_ref`).

## 2. Mapa de tablas (schema `agent`)

```
                 agent_tiers ─────────────┐
                                          │
 staff_users ── staff_role_assignments ── roles ── role_permissions ── permissions
      │
      │ (approved_by, activated_by, reviewed_by, assigned_to …)
      ▼
   agents ─┬─ agent_status_history
           ├─ agent_user_links ··········▶ (usuario Velynt en core)
           ├─ agent_profiles
           ├─ agent_businesses
           ├─ agent_settlement_accounts
           ├─ agent_kyc ── agent_documents          kyc_requirement_sets ── kyc_requirements
           ├─ agent_credentials
           ├─ agent_otp_challenges
           ├─ agent_devices ── agent_sessions
           ├─ agent_access_events
           ├─ agent_limits (overrides)      limit_policies (por nivel)
           ├─ agent_limit_usage
           ├─ agent_balances ···············▶ (cuentas del ledger)
           ├─ agent_cash_declarations
           ├─ agent_qr
           ├─ agent_transactions ─┬─ agent_transaction_events
           │                      ├─ risk_assessments ── fraud_cases
           │                      └─ agent_commissions ── agent_settlements
           ├─ agent_commission_daily        commission_plans ── commission_rules
           ├─ agent_notifications ── agent_notification_deliveries
           ├─ agent_notification_preferences
           ├─ agent_support_tickets ── agent_support_messages
           └─ agent_audit_logs
 idempotency_keys · outbox_events · fraud_rules
```

## 3. Tablas y decisiones clave

### Agentes y relación con usuarios Velynt

| Tabla | Propósito | Notas |
|---|---|---|
| `agents` | Identidad y **estado** del agente | 8 estados; `agent_code` (AG-000001) se asigna al aprobar; transiciones validadas por trigger (`valid_agent_transition`); *four-eyes*: quien aprueba ≠ quien activa |
| `agent_status_history` | Historial de cambios de estado | Se rellena automáticamente |
| `agent_user_links` | Vincula al agente con su usuario Velynt (propietario) y la cartera de liquidación | Solo referencias opacas; un usuario Velynt no puede estar vinculado a dos agentes con el mismo rol |
| `agent_profiles` | Datos personales | Solo datos necesarios; editables únicamente mediante proceso de revisión |
| `agent_businesses` | Establecimiento | Horario en JSON; ubicación del local (no del agente en tiempo real) |
| `agent_settlement_accounts` | Cuenta o método de liquidación | Número cifrado + versión enmascarada |

Los **clientes** no tienen tabla en `agent`: cada operación guarda `customer_ref` (ID opaco del core) y `customer_masked` (`****4821`).

### KYC configurable

`kyc_requirement_sets` (por país, nivel y proveedor, versionado) + `kyc_requirements` (cada campo o documento exigido, con reglas en JSON). Así, requisitos distintos para Guinea Ecuatorial u otro país, o un cambio de proveedor, son **datos**, no código. Los requisitos concretos **(por confirmar)** con el proveedor regulado.

`agent_documents` guarda solo **metadatos**: clave en el almacenamiento de objetos, hash SHA-256, tipo, fechas, número de documento **cifrado** y un **HMAC** del número para detectar el mismo documento en dos agentes sin descifrarlo.

### Autenticación

| Tabla | Clave |
|---|---|
| `agent_credentials` | `pin_hash` obligatoriamente argon2id (CHECK), contador de fallos, bloqueo temporal y escalado |
| `agent_otp_challenges` | Solo el HMAC del código, intentos máximos, caducidad, un solo uso |
| `agent_devices` | Clave pública del dispositivo (la privada nunca sale del teléfono), estado `pending_verification → trusted → revoked`, periodo de enfriamiento |
| `agent_sessions` | Refresh token **hasheado**, familia de rotación (detección de reutilización), caducidad por inactividad y absoluta |
| `agent_access_events` | Historial de accesos que ve el agente en "Seguridad" |

### Límites

`limit_policies` (por nivel y tipo de operación, versionadas) + `agent_limits` (excepciones por agente con *maker-checker*: quien solicita ≠ quien aprueba) + `agent_limit_usage` (contadores diarios y mensuales actualizados en la **misma transacción** que acepta la operación, con bloqueo de fila, para que dos operaciones simultáneas no superen el límite).

Límite efectivo = el más restrictivo entre política del nivel, excepción activa, periodo de enfriamiento por dispositivo nuevo y restricciones de riesgo.

### Operaciones

`agent_transactions` es el registro de cada operación desde el punto de vista del agente:

- `reference` BTX-xxxxxxxx, legible y única, compartida con el ledger.
- `UNIQUE (agent_id, idempotency_key)`: una misma petición no puede crear dos operaciones.
- `uq_agent_tx_core_request`: una misma solicitud de retiro del cliente solo puede usarse una vez.
- Trigger `guard_agent_transaction`: importe, cliente, tipo, agente y clave **no se pueden modificar nunca**; comisión y enlace al ledger quedan congelados tras completarse; los estados solo avanzan según la máquina de estados; cada cambio genera un `agent_transaction_events`.
- `completed` exige `ledger_transaction_id` (CHECK): **no existe una operación completada sin asiento contable**.
- No se puede borrar (trigger).

Máquina de estados:

```
pending ──▶ processing ──▶ completed ──▶ reversed
   │            │              │
   │            └──▶ failed    └──▶ disputed ──▶ completed | reversed
   ├──▶ cancelled   (incluye caducadas: status_reason = 'expired')
   └──▶ failed
```

### Comisiones y liquidaciones

`commission_plans` (versionados, *maker-checker*) + `commission_rules` (fijo + porcentaje en puntos básicos, tramos, mínimo, máximo, por nivel) → `agent_commissions` (una por operación, con la regla aplicada guardada para auditar el cálculo) → `agent_settlements` (periodo, volumen, comisiones, deducciones, neto; CHECK `net = comisiones - deducciones`). `agent_commission_daily` es un *rollup* para pantallas rápidas.

### Saldos

`agent_balances` es una **proyección** (modelo de lectura) de las cuentas del ledger, actualizada por eventos, con `ledger_version` para ignorar eventos fuera de orden. Sirve para pintar pantallas. Las decisiones (¿hay fondos?) se toman **siempre** en el ledger.

`agent_cash_declarations`: efectivo físico **declarado** por el agente. El sistema no pretende conocerlo.

### QR

`agent_qr`: QR estático del agente (uno activo por agente) y QR dinámicos de cobro y depósito (CHECK: siempre de un solo uso, con importe y caducidad). El contenido del QR es solo un identificador aleatorio firmado; todo lo demás se lee de esta tabla. Los QR de **retiro** los genera la app del cliente y los valida Velynt Core.

### Riesgo

`fraud_rules` (reglas versionadas con modo `shadow`/`active`), `risk_assessments` (puntuación 0–100, nivel, decisión, señales que dispararon), `fraud_cases` (revisión por COMPLIANCE).

### Soporte, notificaciones

`agent_support_tickets` (TCK-000001, categorías del enunciado, operación relacionada) + `agent_support_messages` (las notas internas del staff nunca se muestran al agente). `agent_notifications` usa **claves i18n + parámetros**, no textos fijos; `agent_notification_preferences` impide desactivar avisos de seguridad.

### Idempotencia, outbox, auditoría

- `idempotency_keys`: respuesta guardada por `(agent_id, key)` durante 48 h; si llega la misma clave con otro contenido → error `IDEMPOTENCY_KEY_REUSED`.
- `outbox_events`: eventos escritos en la misma transacción que el cambio de negocio; un *relay* los publica en la cola.
- `agent_audit_logs`: solo inserción (triggers bloquean UPDATE/DELETE/TRUNCATE, y el rol `agent_app` no tiene esos permisos), **cadena de hashes por stream** para detectar manipulación, copia diaria a almacenamiento WORM.

## 4. Índices y rendimiento

- Listados del agente: `(agent_id, created_at DESC, id DESC)` → paginación por cursor `(created_at, id)`.
- Colas de trabajo: índices parciales (`WHERE status = 'pending'`, `WHERE published_at IS NULL`, `WHERE status IN ('open','investigating')`) que se mantienen pequeños.
- Ledger: `ledger_entries (account_id, created_at DESC)` para extractos; partición mensual.
- Conexiones: PgBouncer en modo *transaction* desde la etapa de 1.000 agentes.

## 5. Particionado y retención

| Tabla | Estrategia |
|---|---|
| `ledger.ledger_entries` | Particionada por mes desde el día 1 (partición `DEFAULT` + creación anticipada con `pg_partman`) |
| `agent_transactions`, `agent_transaction_events`, `agent_audit_logs`, `agent_access_events` | Candidatas a particionado mensual a partir de ~10.000 agentes (el diseño con UUID y sin FKs entrantes lo permite) |
| `idempotency_keys`, `agent_otp_challenges` | Purga periódica por `expires_at` (única excepción al "no borrar", no son registros financieros) |
| Históricos | Archivado a almacenamiento frío pasado el periodo legal **(por confirmar)** |

## 6. Cifrado y datos sensibles

- Cifrado en reposo del disco (proveedor) + **cifrado a nivel de aplicación** (envelope encryption con KMS) para número de documento, identificador fiscal y cuenta de liquidación.
- HMAC con clave dedicada para búsquedas exactas (teléfono en `agent_access_events`, número de documento).
- PIN: argon2id + *pepper* en KMS/HSM (ver [06-seguridad.md](06-seguridad.md)).
- Nunca en la base de datos: PIN en claro, OTP en claro, refresh tokens en claro, imágenes de documentos, claves privadas.

## 7. Roles de base de datos

| Rol | Puede | No puede |
|---|---|---|
| `ledger_app` | Leer e insertar en `ledger`; actualizar saldos/holds mediante funciones | UPDATE/DELETE/TRUNCATE de asientos y transacciones |
| `agent_app` | Leer/insertar/actualizar en `agent` | Tocar `ledger`; modificar o borrar audit logs, eventos o historiales; borrar filas (salvo purga de OTP/idempotencia) |
| `readonly_analyst` | Leer columnas no personales de operaciones en una réplica | PII |
| Migraciones | Rol separado, solo usado por el pipeline de despliegue | — |

Nadie (ni agentes, ni staff) accede directamente a la base de datos de producción; el acceso de emergencia (*break-glass*) queda registrado y requiere aprobación.
