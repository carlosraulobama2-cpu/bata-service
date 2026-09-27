# 08 · Módulos de negocio

Límites, comisiones, liquidaciones, saldos, notificaciones, soporte y Admin Panel.

## 1. Estados del agente

| Estado | Significado | Puede operar | Quién lo pone |
|---|---|:-:|---|
| `pending` | Solicitud creada, KYC incompleto | ❌ | Sistema |
| `under_review` | KYC enviado, en revisión | ❌ | Sistema al enviar KYC |
| `approved` | Aprobado; tiene Agent ID; falta activación | ❌ | COMPLIANCE |
| `active` | Operativo | ✅ | ADMIN (≠ quien aprobó) |
| `suspended` | Temporalmente sin operar (investigación, KYC caducado…) | ❌ (solo consulta y soporte) | ADMIN/COMPLIANCE o sistema |
| `rejected` | Solicitud denegada | ❌ | COMPLIANCE |
| `blocked` | Bloqueo por seguridad o fraude | ❌ (solo soporte) | Sistema/COMPLIANCE |
| `terminated` | Baja definitiva | ❌ | ADMIN |

Las transiciones permitidas están codificadas en `agent.valid_agent_transition` y probadas.

KYC caducado: 30 días antes → notificación "Documento KYC próximo a caducar"; al caducar → `suspended` automáticamente (política **por confirmar**).

## 2. Niveles y límites

- `agent_tiers`: niveles (nombres y criterios **por confirmar**; p. ej. antigüedad, volumen, KYC ampliado).
- `limit_policies`: por nivel × tipo de operación: mínimo y máximo por operación, diario (importe y número), mensual. Versionadas con `effective_from`.
- `agent_limits`: excepciones por agente, con *maker-checker* y caducidad.
- Enfriamiento por dispositivo nuevo: multiplicador configurable (p. ej. 25 % durante 24 h).
- Restricción de riesgo: el motor puede reducir temporalmente el límite de un agente.

Ejemplo de configuración inicial (valores del enunciado, **a validar con el regulador y el proveedor**):

| Nivel | Por operación | Diario | Mensual |
|---|---:|---:|---:|
| tier_1 | 500.000 XAF | 2.000.000 XAF | 20.000.000 XAF |

Cálculo en el servidor (dentro de la transacción que acepta la operación):

```
efectivo = min(política_del_nivel, excepción_activa, política × enfriamiento, restricción_de_riesgo)
bloquear fila agent_limit_usage (día y mes) FOR UPDATE
si usado + importe > efectivo → LIMIT_*_EXCEEDED
si no → usado += importe; count += 1
si luego la operación falla o se cancela → se descuenta
```

## 3. Comisiones

- Planes versionados (`commission_plans`) y reglas (`commission_rules`), creados por FINANCE y aprobados por otra persona.
- Regla: por tipo de operación, nivel (opcional) y tramo de importe:

```
comisión = clamp( fijo + floor(importe × rate_bps / 10.000), mínimo, máximo )
```

- Se calcula **en el servidor** en el momento de la operación, con el plan vigente, y se guarda la regla aplicada (`rule_id`) en `agent_commissions`. Cambiar el plan no altera comisiones ya generadas.
- Se contabiliza en la misma transacción del ledger que la operación (D `commission_expense` / C `agent_commission_payable`).
- Reverso de la operación ⇒ reverso de la comisión (estado `reversed`).
- Quién financia la comisión (BataPay, tarifa al cliente, mixto) y si hay retenciones fiscales: **(por confirmar)**.
- La app muestra la comisión estimada antes de confirmar (misma función de cálculo en el servidor, endpoint de cotización interno a `POST /cash-in` y `/cash-out/resolve`).

Pantalla "Mis comisiones": hoy / semana / mes / total desde `agent_commission_daily` (rollup actualizado por evento) y el pendiente desde el ledger.

## 4. Liquidaciones

| Estado | Significado |
|---|---|
| `pending` | Generada al cierre del periodo, en revisión |
| `scheduled` | Aprobada por FINANCE, con fecha |
| `processing` | Orden de pago enviada |
| `completed` | Pago confirmado; comisiones `settled` |
| `failed` | Rechazada/fallida; comisiones vuelven a `accrued` |

Periodicidad, método (al float, a cuenta bancaria, a cartera BataPay), importe mínimo, deducciones: **(por confirmar)**. El modelo contable está en [04-ledger.md §3.5](04-ledger.md#35-liquidación-de-comisiones).

Controles: una liquidación por agente y periodo (`UNIQUE`), `net = comisiones − deducciones` (CHECK), aprobación por dos personas, conciliación con el extracto bancario.

## 5. Saldos del agente

| Concepto | Fuente de verdad | Cómo se muestra |
|---|---|---|
| Saldo operativo (float) | Ledger (`agent_float`) | "Disponible para operaciones" = saldo − reservas |
| Comisiones pendientes | Ledger (`agent_commission_payable`) | "Se pagarán en tu próxima liquidación" |
| Liquidaciones | `agent_settlements` + ledger | Historial y estado |
| Efectivo físico | **Declaración del agente** | "Declarado por ti el …" (el sistema no lo conoce) |

Recarga de float y retirada de exceso de float (cuando el agente acumula mucho dinero electrónico tras muchos retiros): procesos con FINANCE/banco/super-agentes **(por confirmar)**; siempre como transacciones del ledger confirmadas por back-office o integración bancaria.

Alerta de float bajo: umbral configurable por agente → notificación y banner.

## 6. Notificaciones

| Evento | Tipo | Canal | Desactivable |
|---|---|---|:-:|
| Cash-in completado | `cash_in_completed` | Push + bandeja | ✅ |
| Cash-out completado | `cash_out_completed` | Push + bandeja | ✅ |
| Operación pendiente (esperando cliente / en revisión) | `operation_pending` | Push + bandeja | ✅ |
| Nuevo dispositivo detectado | `new_device_detected` | Push a otros dispositivos + SMS | ❌ |
| Cuenta suspendida | `account_suspended` | Push + SMS | ❌ |
| Liquidación completada | `settlement_completed` | Push + bandeja | ✅ |
| Documento KYC próximo a caducar | `kyc_document_expiring` | Push + bandeja (30, 7 y 1 día antes) | ✅ |
| Alerta de seguridad (bloqueo, cambio de PIN) | `security_alert` | Push + SMS | ❌ |
| Cambio de límites | `limit_changed` | Bandeja | ✅ |
| Respuesta de soporte | `support_reply` | Push + bandeja | ✅ |

Arquitectura: evento en `outbox_events` → worker de notificaciones → plantilla i18n (`title_key`, `body_key`, `params`) en el idioma del agente → envío (FCM/APNs; SMS con proveedor **por confirmar**) → `agent_notification_deliveries` con reintentos. El contenido del push **no** incluye datos sensibles ("Retiro completado: 50.000 XAF", nunca el teléfono del cliente).

## 7. Soporte

- Categorías: problema con operación, cliente no recibió dinero, error en cash-in, error en cash-out, problema con QR, problema con liquidación, cuenta bloqueada, problema de KYC, otro.
- Ticket: `TCK-000481`, estado, fecha, descripción, operación relacionada, conversación (sin notas internas).
- Prioridad automática: "cliente no recibió dinero" y "error en cash-out" → alta.
- SLA objetivo por prioridad **(por confirmar)**; alertas en el Admin Panel cuando se superan.
- Canal de teléfono/WhatsApp de soporte **(por confirmar)**, visible en "Contactar soporte".

## 8. Admin Panel

Web separada, SSO + MFA, red restringida. Todo cambio → audit log. Acciones críticas con *maker-checker*.

### Dashboard

| Bloque | Contenido |
|---|---|
| Red | Agentes activos, suspendidos, bloqueados, solicitudes pendientes |
| Volumen de hoy | Total, cash-in, cash-out, QR (importe y número), comparación con la misma hora de ayer |
| Comisiones | Generadas hoy / mes, pendientes de liquidar |
| Operaciones | Pendientes, en `processing` > 2 min, en revisión, fallidas (tasa) |
| Riesgo | Alertas abiertas por nivel, casos asignados a mí |
| KYC | En revisión, documentos que caducan en 30 días |
| Liquidaciones | Pendientes de aprobar, programadas, fallidas |
| Conciliación | Última ejecución y diferencias |
| Soporte | Tickets abiertos por prioridad y fuera de SLA |

### Pantallas

- **Agentes**: búsqueda (Agent ID, teléfono, nombre, zona), ficha con pestañas (datos, KYC, dispositivos, sesiones, límites, operaciones, comisiones, liquidaciones, tickets, riesgo, audit log) y acciones según permisos: aprobar, activar, suspender, bloquear, reactivar, dar de baja, revocar dispositivos, solicitar cambio de límites.
- **Cola KYC**: expedientes en revisión, visor de documentos con marca de agua, checklist según el conjunto de requisitos, decisión con motivo codificado.
- **Operaciones**: búsqueda por referencia, agente, cliente (por referencia opaca, sin mostrar datos completos salvo permiso), estado, importe, fechas; detalle con asientos del ledger, riesgo y eventos; solicitud de reverso (FINANCE, dos personas).
- **Riesgo**: casos, reglas (versiones, modo shadow/activo, métricas de impacto).
- **Configuración**: niveles, políticas de límites, planes de comisión, conjuntos KYC — todo versionado con aprobación.
- **Liquidaciones**: generar, revisar, aprobar, exportar orden de pago, marcar resultado.
- **Conciliación**: ejecuciones y diferencias.
- **Soporte**: bandeja de tickets, respuesta, notas internas, escalado.
- **Auditoría**: búsqueda de audit logs (solo lectura) y verificación de la cadena de hashes.
