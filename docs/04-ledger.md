# 04 · Modelo de ledger

## 1. Principios

1. **Doble partida**: cada transacción tiene al menos dos asientos y la suma de débitos = suma de créditos por moneda. Se comprueba en la base de datos al hacer COMMIT (trigger diferido). Una transacción desequilibrada no puede existir.
2. **Inmutable**: asientos y transacciones no se actualizan ni se borran (triggers + permisos). Los errores se corrigen con una **transacción de reverso**.
3. **Idempotente**: `(source_system, idempotency_key)` es único. Repetir la misma petición devuelve la transacción original; reutilizar la clave con otro contenido falla.
4. **Atómico**: una operación de agente (importe + comisión + tarifa) se contabiliza en **una sola** transacción contable. O entra todo, o nada.
5. **Sin descubiertos** salvo cuentas autorizadas (`allow_negative`), comprobado en cada asiento y en cada *hold*.
6. **Importes enteros** en unidades mínimas de la moneda (`BIGINT`). XAF no tiene decimales: 100.000 XAF = `100000`. Sin `float` en ningún punto de la cadena (tampoco en la app ni en JSON: los importes viajan como enteros).

## 2. Plan de cuentas

Desde el punto de vista de Velynt como emisor de dinero electrónico **(modelo regulatorio exacto por confirmar con el proveedor/licencia)**:

| Cuenta | Tipo | Lado normal | Significado |
|---|---|---|---|
| `customer_wallet` (una por cliente y moneda) | Pasivo | Crédito | Dinero electrónico que Velynt debe al cliente |
| `agent_float` (una por agente) | Pasivo | Crédito | Dinero electrónico del agente para operar |
| `agent_commission_payable` (una por agente) | Pasivo | Crédito | Comisiones ganadas y no pagadas |
| `settlement_bank` | Activo | Débito | Dinero real en la cuenta bancaria/fiduciaria que respalda el dinero electrónico (banco por confirmar) |
| `settlement_clearing` | Activo | Débito | Pagos a bancos enviados y pendientes de confirmar |
| `fee_revenue` | Ingreso | Crédito | Tarifas cobradas a clientes (si existen, por confirmar) |
| `commission_expense` | Gasto | Débito | Coste de las comisiones pagadas a agentes |
| `suspense` | Pasivo | Crédito | Importes pendientes de aclarar (uso excepcional, con alerta) |

Invariante global: **Σ pasivos de dinero electrónico (clientes + float + comisiones pendientes) = dinero en `settlement_bank` ± partidas en tránsito**. Se comprueba en la conciliación diaria.

Nota sobre signos: el enunciado dice "Cliente +100.000 / Agente −100.000". En contabilidad eso son **un crédito** a la cuenta del cliente (su pasivo sube) y **un débito** a la cuenta de float del agente (su pasivo baja). La app muestra "+" y "−" al usuario; el ledger guarda dirección D/C y un importe siempre positivo.

## 3. Ejemplos de asientos

Todos los ejemplos están ejecutados en [`db/tests/invariants_test.sql`](../db/tests/invariants_test.sql).

### 3.1 Recarga de float (el agente deposita 1.000.000 XAF en el banco de Velynt)

| Cuenta | D | C |
|---|---:|---:|
| `settlement_bank` | 1.000.000 | |
| `agent_float` AG-000001 | | 1.000.000 |

Proceso de recarga (depósito bancario, super-agente, efectivo en oficina): **(por confirmar)**. La confirmación la hace FINANCE o una integración bancaria, nunca el agente.

### 3.2 Cash-in 100.000 XAF con comisión de 500 XAF

**Paso 1 · hold** mientras el cliente confirma: se reservan 100.000 del float (`available = balance − held`). No es un asiento; no mueve dinero.

**Paso 2 · contabilización** cuando el cliente confirma (una transacción, captura el hold):

| Cuenta | D | C |
|---|---:|---:|
| `agent_float` AG-000001 | 100.000 | |
| `customer_wallet` ****4821 | | 100.000 |
| `commission_expense` | 500 | |
| `agent_commission_payable` AG-000001 | | 500 |

Resultado: cliente +100.000, float del agente −100.000, comisión pendiente +500. El agente guarda físicamente 100.000 en efectivo (el sistema no lo sabe salvo declaración).

Si el cliente no confirma a tiempo: el hold se libera (`close_hold(..., 'expired')`) y la operación pasa a `cancelled` con motivo `expired`. No hay asientos.

### 3.3 Cash-out 50.000 XAF

El cliente creó la solicitud en su app (con su PIN); Velynt Core puso un **hold en la cartera del cliente**. Al confirmar el agente:

| Cuenta | D | C |
|---|---:|---:|
| `customer_wallet` ****4821 | 50.000 | |
| `agent_float` AG-000001 | | 50.000 |
| `commission_expense` | 500 | |
| `agent_commission_payable` AG-000001 | | 500 |

El agente entrega 50.000 en efectivo y su float sube 50.000.

Si existe tarifa al cliente (por confirmar), se añade: D `customer_wallet` / C `fee_revenue`.

### 3.4 Pago QR a un agente-comercio (cobro de 25.000 XAF)

| Cuenta | D | C |
|---|---:|---:|
| `customer_wallet` | 25.000 | |
| `agent_float` (o cuenta de cobros del agente, por confirmar) | | 25.000 |

Si el cobro genera comisión o tarifa comercial: reglas configurables, mismo patrón.

### 3.5 Liquidación de comisiones

a) **Al float** (instantánea):

| Cuenta | D | C |
|---|---:|---:|
| `agent_commission_payable` | 185.400 | |
| `agent_float` | | 185.400 |

b) **A cuenta bancaria** (dos pasos):

| Momento | Cuenta | D | C |
|---|---|---:|---:|
| Orden enviada | `agent_commission_payable` | 185.400 | |
| | `settlement_clearing` | | 185.400 |
| Banco confirma | `settlement_clearing` | 185.400 | |
| | `settlement_bank` | | 185.400 |

Si el banco rechaza: reverso de la orden (la comisión vuelve a estar pendiente) y la liquidación pasa a `failed`.

### 3.6 Reverso (p. ej. operación duplicada confirmada por soporte)

`reverse_transaction()` crea una transacción `kind = 'reversal'` con los mismos asientos en dirección contraria y `reversal_of` apuntando a la original. `reversal_of` es único: **no se puede revertir dos veces**. Un reverso no se puede revertir; si hiciera falta, se hace un ajuste autorizado nuevo.

Quién puede pedir un reverso: FINANCE, con aprobación de un segundo usuario (*maker-checker*) y audit log. **Nunca el agente.**

## 4. Holds (reservas)

| Evento | Efecto |
|---|---|
| `create_hold` | `held += importe` si `balance − held ≥ importe`; idempotente por `(source_system, external_ref, account_id)` |
| Captura en `post_transaction(p_capture_holds)` | Se libera el hold y se contabiliza, en la misma transacción |
| `close_hold(…, 'released' / 'expired')` | `held −= importe` |
| Job de expiración | Cada minuto cierra holds con `expires_at < now()` (índice parcial) y cancela la operación asociada |

## 5. Idempotencia en tres capas

| Capa | Mecanismo | Protege de |
|---|---|---|
| App → Agent API | Cabecera `Idempotency-Key` (UUID v4 generado **una vez** por intento de operación) + tabla `idempotency_keys` con la respuesta guardada | Doble toque, reintentos por mala red |
| Agent Backend | `UNIQUE (agent_id, idempotency_key)` en `agent_transactions` y `UNIQUE` sobre la solicitud de retiro del cliente | Dos peticiones concurrentes con la misma clave; reutilizar un código de retiro |
| Agent Backend → Ledger | `idempotency_key = agent_transactions.id` + `UNIQUE (source_system, idempotency_key)` + `pg_advisory_xact_lock` + hash del contenido | Reintentos internos tras un timeout; nunca doble asiento |

Resultado: aunque la red falle en cualquier punto y todo se reintente, **el dinero se mueve una sola vez**.

## 6. Concurrencia

- `post_transaction` bloquea las filas de saldo implicadas **en orden de id** (sin *deadlocks*).
- Cuentas de sistema con mucho tráfico (`fee_revenue`, `commission_expense`) tienen `track_balance = false`: no se bloquean en cada operación; su saldo se calcula agregando asientos (o por *rollup* periódico).
- A 100.000 agentes, las cuentas de float están repartidas (una por agente), por lo que la contención real es baja.

## 7. Estados

Las transacciones del ledger **no tienen estados**: existen (contabilizadas) o no. Todo lo que está "en curso" vive en `agent_transactions` (pending/processing) y en `ledger_holds`. "Revertida" = existe una transacción con `reversal_of` apuntando a ella.

## 8. Trazabilidad

Cada transacción guarda: referencia BTX compartida con la operación, sistema de origen, clave de idempotencia, hash de la petición, `external_ref` (id de la operación del agente), principal de servicio que la creó y `posted_at`. Desde un asiento se llega a la operación, desde la operación al agente, al dispositivo, a la sesión, a la evaluación de riesgo y al audit log.

## 9. Conciliación

| Proceso | Frecuencia | Comprueba | Si falla |
|---|---|---|---|
| Balance de comprobación | Horaria | `v_unbalanced_transactions` vacío | Alerta crítica (no debería ocurrir nunca) |
| Saldos vs asientos | Diaria | `v_balance_drift` vacío | Alerta crítica, congelar cuentas afectadas |
| Operaciones vs ledger | Cada 15 min | Cada `agent_transactions` `completed` tiene exactamente una transacción en el ledger con su `external_ref`, y viceversa; nada lleva > N min en `processing` | Un *reconciler* consulta el ledger por clave de idempotencia y completa o falla la operación |
| Holds huérfanos | Cada 5 min | Holds activos sin operación `pending` | Liberar y registrar |
| Banco vs `settlement_bank` | Diaria (según extracto disponible) | Movimientos bancarios vs asientos | Caso para FINANCE. Formato de extracto e integración **(por confirmar)** |
| Emisión total | Diaria | Σ pasivos de dinero electrónico vs saldo bancario de respaldo | Escalado a FINANCE y dirección |

Cada ejecución se guarda en `ledger.reconciliation_runs` con sus diferencias.
