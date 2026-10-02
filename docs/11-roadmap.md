# 11 · Roadmap por fases

Duraciones orientativas para un equipo de ~6–8 personas (2 backend, 2 móvil, 1 web/admin, 1 QA, 1 DevOps/seguridad a tiempo parcial, producto/diseño). Se ajustarán tras confirmar las decisiones pendientes.

## Fase 0 · Decisiones y cimientos (3–4 semanas)

Objetivo: cerrar lo que bloquea el diseño y dejar la base técnica lista.

- Confirmar con el proveedor financiero y asesoría legal los puntos **por confirmar** (lista en el [README](../README.md#decisiones-pendientes-por-confirmar)): modelo de licencia/emisión, KYC de agentes, residencia de datos, proveedor de SMS y KYC, método de liquidación, tarifas y comisiones, método de confirmación del cliente sin smartphone.
- Revisar la API actual de Velynt Core y acordar los contratos internos (resolver cliente, solicitudes de depósito/retiro, eventos).
- Decidir dónde vive el ledger (servicio nuevo o módulo del core) y quién es su dueño.
- Monorepo, CI (lint, tipos, tests, SAST, SCA, secretos), entornos dev/staging, IaC, observabilidad básica.
- Esquemas `db/` convertidos en migraciones.
- Diseño visual en alta fidelidad de las pantallas clave (login, dashboard, cash-in, cash-out, resultado).

Entregable: contratos firmados entre equipos, pipeline en verde, prototipo navegable.

## Fase 1 · MVP piloto (8–10 semanas) → 10–50 agentes en Bata

- **Ledger**: cuentas, holds, contabilización idempotente, reversos, vistas de conciliación, job de expiración de holds.
- **Auth**: login teléfono + PIN, OTP, device binding, refresh con rotación, bloqueo por intentos, cierre de sesión, cierre remoto desde BO.
- **Alta de agentes asistida**: el staff registra al agente y sube el KYC desde el Admin Panel (el KYC en la app llega en la fase 2); aprobación y activación con *maker-checker*.
- **Operaciones**: cash-in (con confirmación del cliente en Velynt) y cash-out (código/QR de retiro del cliente), estados, reconciliador de `processing`.
- **Límites** por nivel (un nivel) y contadores.
- **Comisiones**: un plan configurable, contabilización en el ledger, pantalla de resumen.
- **Historial y detalle** con recibo.
- **Riesgo básico**: duplicados, velocidad, importe máximo, dispositivo nuevo (reglas síncronas, casos manuales).
- **Audit logs** completos desde el primer día.
- **Admin Panel mínimo**: agentes, operaciones, límites, audit logs, conciliación.
- Notificaciones push de operaciones.
- Pentest externo antes del piloto.

Criterio de salida: 4 semanas de piloto sin diferencias de conciliación, tasa de éxito de operaciones y tiempos dentro de objetivo, cero incidentes de seguridad abiertos.

## Fase 2 · Lanzamiento (6–8 semanas) → hasta ~1.000 agentes

- Solicitud de alta y **KYC en la app** con requisitos configurables por país; integración con proveedor KYC **(por confirmar)**.
- Biometría con *biometric key*; gestión de dispositivos y sesiones por el agente; historial de accesos.
- QR completo: QR estático del agente, QR de cobro (pago QR), escaneo unificado.
- **Liquidaciones** (periodo, aprobación FINANCE, pago al float y/o banco).
- Soporte en la app (tickets) y bandeja de soporte en el Admin Panel.
- Varios niveles de agente y excepciones de límites.
- Modo sin conexión de solo lectura.
- Motor de riesgo con reglas versionadas en modo shadow/activo; cola de casos.
- Notificaciones completas (incluye KYC por caducar, cuenta suspendida, nuevo dispositivo por SMS).
- Réplica de lectura, PgBouncer, autoescalado, alertas de negocio.
- Recuperación de cuenta.

## Fase 3 · Escala regional (8–12 semanas) → hasta ~10.000 agentes

- Supervisores con alcance por zona; jerarquía de agentes/super-agentes **(modelo por confirmar)**.
- Recarga y retirada de float integradas con banco/super-agentes **(por confirmar)**.
- Declaración de efectivo en caja y alertas de float bajo.
- Rollups y almacén analítico (CDC) para reporting; exportaciones para FINANCE y compliance.
- Hooks de compliance conectados a las reglas/proveedores definidos **(por confirmar)**.
- Particionado de tablas de operaciones y auditoría; verificación diaria de la cadena de audit logs; copia WORM.
- DR en segunda región con simulacro.
- Impresión de recibos Bluetooth **(si se confirma)**, idiomas adicionales.
- Versión **web de consulta** para agentes (historial, comisiones, liquidaciones, soporte).

## Fase 4 · Gran escala (continuo) → 100.000 agentes

- Broker de eventos gestionado; extracción del servicio de riesgo (y modelos estadísticos entrenados con datos propios, siempre con reglas explicables).
- Optimización del ledger (cuentas calientes, particionado por rango de cuentas si hace falta).
- Canales para baja conectividad (USSD/SMS) **(por confirmar con operadores)**.
- Operación 24/7 con guardias, SLOs públicos internos, *game days* periódicos.
- Expansión a otros países: nuevos conjuntos KYC, monedas, límites y planes de comisión por configuración, sin cambiar código.

## Dependencias críticas

| Dependencia | Bloquea | Fase |
|---|---|---|
| Contratos con Velynt Core (clientes, confirmaciones, retiros) | Cash-in / cash-out | 0 |
| Modelo contable y cuenta bancaria de respaldo | Ledger, float, liquidaciones | 0 |
| Proveedor de SMS | OTP | 0–1 |
| Requisitos KYC de agentes y proveedor | KYC en la app | 1–2 |
| Método y periodicidad de liquidación | Liquidaciones | 2 |
| Normativa AML/compliance aplicable | Hooks de compliance | 2–3 |
