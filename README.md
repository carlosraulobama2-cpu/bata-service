# VELYNT SERVICES

Aplicación profesional para **agentes autorizados de Velynt**: cash-in, cash-out, cobros QR, comisiones, liquidaciones, KYC, seguridad y soporte.

Velynt Services es un producto **independiente** de la app Velynt (propio frontend, backend, autenticación y permisos), conectado a la infraestructura de Velynt mediante APIs internas seguras. **Todo movimiento de dinero se valida en el servidor y se registra en el ledger central de doble partida.** El agente nunca puede modificar un saldo.

> Estado: diseño técnico completo y **Fase 1 en desarrollo**. El backend de agentes ([`apps/agent-api`](apps/agent-api)) implementa login seguro, cash-in, cash-out, cobros QR, límites, comisiones, historial y saldos sobre el ledger, y la app ([`apps/agent-mobile`](apps/agent-mobile)) cubre esos flujos de principio a fin.

![Pantallas de la app](docs/screenshots/overview.png)

## Documentación

| # | Documento | Contenido |
|---|---|---|
| 1 | [Arquitectura](docs/01-arquitectura.md) | Decisión A vs B, diagrama, stack, comunicación entre servicios, escalabilidad 100 → 100.000 agentes, caché, observabilidad, backups/DR, modo offline, privacidad |
| 2 | [UX/UI](docs/02-ux-ui.md) | Principios, sistema de diseño, navegación, todas las pantallas, catálogo de errores, i18n, accesibilidad |
| 3 | [Base de datos](docs/03-base-de-datos.md) | Mapa de tablas, decisiones, índices, particionado, cifrado, roles |
| 4 | [Ledger](docs/04-ledger.md) | Plan de cuentas, asientos de cada operación, holds, idempotencia, reversos, conciliación |
| 5 | [API](docs/05-api.md) | Convenciones, errores, idempotencia, rate limits, endpoints con request/response, Admin e Internal API |
| 6 | [Seguridad](docs/06-seguridad.md) | Amenazas, autenticación, sesiones, device binding, RBAC, audit logs, prevención de fraude, KYC, privacidad |
| 7 | [Flujos](docs/07-flujos.md) | Los 14 flujos paso a paso |
| 8 | [Módulos de negocio](docs/08-modulos-negocio.md) | Estados del agente, límites, comisiones, liquidaciones, saldos, notificaciones, soporte, Admin Panel |
| 9 | [Estructura de código](docs/09-estructura-codigo.md) | Monorepo, app Expo, backend NestJS, admin, variables de entorno |
| 10 | [Pruebas](docs/10-pruebas.md) | Estrategia y casos obligatorios |
| 11 | [Roadmap](docs/11-roadmap.md) | Fases 0–4 |

## Código

```
apps/agent-api/     # Agent Backend (NestJS + Kysely + PostgreSQL); ver su README
apps/agent-mobile/  # App de agentes (Expo + React Native + TypeScript); ver su README
packages/money/     # Importes enteros, formato "2.450.000 XAF", cálculo de comisiones
packages/tsconfig/  # Configuración TypeScript compartida
db/                 # Esquemas SQL (migraciones) y pruebas de invariantes
```

```bash
pnpm install
pnpm -r typecheck && pnpm -r build
TEST_DATABASE_ADMIN_URL=postgresql://postgres:postgres@localhost:5432/postgres pnpm -r test
```

## Base de datos

```
db/
├── 01_ledger.sql                    # Ledger de doble partida (servicio Ledger)
├── 02_agent.sql                     # Base de datos del Agent Backend
├── 03_roles_and_reference_data.sql  # Roles de BD (mínimo privilegio) + RBAC
├── 04_qr_payments.sql               # Cobros QR: un uso, cliente fijado una vez, QR inmutables
├── 05_security_and_code_attempts.sql # Historial de PIN y bloqueo por códigos inválidos
├── 06_push_notifications.sql        # Cola de envío de push
├── 07_device_integrity.sql          # Señales de root/jailbreak/emulador
├── 08_risk_engine.sql               # Reglas de riesgo v1 (shadow), casos de fraude
└── tests/
    ├── invariants_test.sql          # 36 comprobaciones de reglas críticas
    └── run.sh                       # crea una BD temporal, aplica y prueba
```

Ejecutar las pruebas (PostgreSQL 15+):

```bash
DATABASE_ADMIN_URL=postgresql://postgres@localhost:5432/postgres ./db/tests/run.sh
```

Lo que comprueban, entre otras cosas: que una operación repetida con la misma clave no mueve dinero dos veces, que una transacción desequilibrada es rechazada, que no hay descubiertos, que los asientos y audit logs no se pueden modificar ni borrar, que una operación completada no se puede editar, que un agente no puede pasar de `pending` a `active` y que quien aprueba no puede ser quien activa.

## Decisiones pendientes (por confirmar)

Estas decisiones dependen de la jurisdicción (Guinea Ecuatorial / CEMAC), del proveedor financiero regulado o del negocio. El diseño las deja como **configuración o puntos de integración**, no como supuestos:

1. Modelo regulatorio de emisión de dinero electrónico y papel de Velynt y de los agentes.
2. Requisitos KYC concretos para agentes (documentos, periodicidad de revisión, prueba de vida) y proveedor KYC.
3. Residencia de datos y región de despliegue.
4. Proveedor de SMS (OTP) y posibilidad de consulta de SIM swap con operadores.
5. Método de confirmación del cliente en cash-in cuando no tiene smartphone (USSD, OTP por SMS…).
6. Tarifas a clientes, financiación de comisiones y posibles retenciones fiscales.
7. Periodicidad, método y banco de las liquidaciones; formato de extractos para conciliación.
8. Proceso de recarga y retirada de float (banco, super-agentes, oficina).
9. Niveles de agente, límites iniciales por nivel y criterios de subida de nivel.
10. Reglas AML/compliance, listas de screening y reportes regulatorios.
11. Políticas de retención de datos y de documentos.
12. Si el agente ve el nombre abreviado del cliente además de `****4821`.
13. ~~Política ante dispositivos rooteados/jailbreak~~ → decidido: pueden consultar, no operar.
14. Objetivos finales de RPO/RTO.
15. Contratos concretos con la API actual de Velynt Core.
