# Agent API (BATA SERVICES)

Backend de la app de agentes. El diseño completo está en [`docs/`](../../docs); este paquete implementa la **Fase 1** del [roadmap](../../docs/11-roadmap.md).

Stack: Node.js 22 · TypeScript · NestJS 11 (Fastify) · Kysely · PostgreSQL. NestJS 11 y Kysely 0.28 se usan en su versión CommonJS: las versiones más recientes son solo ESM y rompen Jest y los metadatos de decoradores.

## Qué incluye

| Área | Estado |
|---|---|
| Login teléfono + PIN, OTP por SMS en dispositivo nuevo, registro de claves del dispositivo | ✅ |
| Access token ES256 (10 min), refresh token opaco rotado con detección de reutilización | ✅ |
| Bloqueo tras 5 PIN fallidos (duración creciente; al 3.er bloqueo la cuenta pasa a `blocked`) | ✅ |
| Máximo de dispositivos de confianza, periodo de enfriamiento con límites reducidos | ✅ |
| Cierre de sesión con efecto inmediato (el estado se comprueba en cada petición) | ✅ |
| Firma de dispositivo (ECDSA P-256) en operaciones + confirmación con PIN o biometría | ✅ |
| Idempotencia en la API (`Idempotency-Key`), por operación y en el ledger | ✅ |
| Cash-out (código/QR del cliente, uso único, asiento que captura el hold del cliente) | ✅ |
| Cash-in (hold del float, confirmación del cliente vía evento firmado de Core, expiración, cancelación) | ✅ |
| Límites por nivel + excepciones + enfriamiento, con contadores bloqueados por fila | ✅ |
| Comisiones desde plan configurable, contabilizadas en la misma transacción del ledger | ✅ |
| Reconciliador de operaciones en `processing` (reintento idempotente) | ✅ |
| Historial con filtros, totales y paginación por cursor; detalle; consulta por clave | ✅ |
| `GET /me`, `/balance` (desde el ledger), `/limits` | ✅ |
| Cobro QR (QR firmado Ed25519, un uso, caduca; pago del cliente vía Core capturando su retención), QR estático del agente, escaneo unificado (retiro → cash-out, QR de cliente → cash-in) | ✅ |
| Audit log encadenado, eventos de outbox, notificaciones en bandeja | ✅ |
| Comisiones: resumen (hoy, 7 días, mes, histórico, pendiente según el ledger, desglose por tipo) y detalle por operación | ✅ |
| Bandeja de avisos: lista paginada, sin leer, marcar como leído (uno / todos) | ✅ |
| Seguridad: resumen, dispositivos, sesiones, historial de accesos (IP enmascarada), cerrar las demás sesiones (PIN/biometría), cambio de PIN (reglas, distinto de los 3 últimos, cierra otras sesiones, aviso) | ✅ |
| Bloqueo tras 5 códigos de retiro/QR inexistentes en 10 min (15 min, `RATE_LIMITED` con `retry_after_seconds`) | ✅ |
| Límite de peticiones por grupo (login por teléfono e IP, OTP, refresh, operaciones, consultas de códigos, lecturas, escrituras) en Redis compartido por todas las réplicas; cabeceras `X-RateLimit-*` y `Retry-After` | ✅ |
| Desconectar otro dispositivo del agente | ✅ |
| Notificaciones push: registro del token del dispositivo, preferencias por tipo (las de seguridad no se pueden desactivar), cola de envío con reintentos y sin datos del cliente; proveedor Expo push (FCM/APNs) | ✅ |
| Motor de riesgo, KYC en la app, liquidaciones, soporte, Admin API | ⏳ fases siguientes |

## Integraciones

- **Ledger**: `LedgerClient`. `LocalLedgerClient` llama a las funciones SQL de [`db/01_ledger.sql`](../../db/01_ledger.sql). Cuando el ledger sea un servicio propio se añade un cliente HTTP con la misma interfaz.
- **BataPay Core**: `CoreClient`. `FakeCoreClient` simula Core **moviendo dinero real en el ledger** (carteras y holds de clientes) para desarrollo y pruebas. El contrato real con Core está **por confirmar**; la configuración impide usar el simulador en producción.
- **Push**: `PushSender`. `ExpoPushSender` (servicio de push de Expo, que entrega por FCM/APNs con las credenciales configuradas en EAS; `PUSH_MODE=expo`, `EXPO_ACCESS_TOKEN` opcional). `InMemoryPushSender` en desarrollo. Cambiar a FCM/APNs directos solo requiere otra implementación.
- **SMS**: `SmsSender`. `InMemorySmsSender` no envía nada (proveedor **por confirmar**).

## Desarrollo local

Requisitos: Node 22, pnpm, PostgreSQL 15+.

```bash
pnpm install
cp apps/agent-api/.env.example apps/agent-api/.env
pnpm --filter @bata/agent-api keys:dev      # copia la salida en .env
# en .env: DATABASE_URL / LEDGER_DATABASE_URL de tu PostgreSQL y ENABLE_DEV_ENDPOINTS=true
cd apps/agent-api
set -a && . ./.env && set +a
pnpm db:migrate && pnpm db:seed && pnpm dev
```

El seed crea el agente **AG-000001** (`SEED_AGENT_PHONE` / `SEED_AGENT_PIN`) con 2.450.000 XAF de float, un nivel, límites y un plan de comisiones **de ejemplo** (valores reales por confirmar).

Endpoints de desarrollo (solo con `ENABLE_DEV_ENDPOINTS=true`; la configuración lo rechaza en producción): crear clientes (`POST /dev/customers`), crear solicitudes de retiro (`POST /dev/withdrawals`), confirmar un depósito como si fuera el cliente (`POST /dev/deposits/confirm`), pagar un QR de cobro como si fuera el cliente (`POST /dev/qr/pay`) y leer el último OTP enviado (`GET /dev/otp?phone=`).

## Pruebas

```bash
# PostgreSQL con un usuario que pueda crear bases de datos
export TEST_DATABASE_ADMIN_URL=postgresql://postgres:postgres@localhost:5432/postgres
export TEST_REDIS_URL=redis://localhost:6379/15   # opcional: repite las pruebas de límites contra Redis real (se vacía esa BD)
pnpm --filter @bata/agent-api test
```

Cada archivo de pruebas usa su propia base de datos, clonada de una plantilla ya migrada. Cubren, entre otros casos:

- OTP y registro de dispositivo, bloqueo por PIN, rotación y reutilización de refresh tokens.
- Firma de dispositivo manipulada o caducada; PIN o biometría en cada operación.
- Idempotencia: reintento, clave reutilizada con otros datos, peticiones simultáneas.
- Código de retiro de un solo uso incluso entre agentes; importe no modificable desde la app.
- Límites y enfriamiento; agente suspendido.
- Respuesta del ledger perdida: la operación queda en `processing` y el reconciliador la completa sin mover el dinero dos veces.
- Cash-in confirmado, rechazado, cancelado y expirado; eventos de Core falsificados o antiguos.
- Aislamiento entre agentes (404) y saldos leídos del ledger.
- Comisiones (periodos, desglose, paginación), avisos (lectura, aislamiento entre agentes), seguridad (cerrar otras sesiones, cambio de PIN y sus reglas) y bloqueo por códigos inválidos.
- QR de cobro: pago completo (cliente −, float +), un solo uso, importe distinto, caducidad y cancelación (límites devueltos), cliente sin fondos, QR falsificado o manipulado, QR estático, escaneo unificado.
