# 09 · Estructura de código y variables de entorno

## 1. Repositorio

Monorepo (pnpm workspaces + Turborepo) para compartir tipos, esquemas de validación y códigos de error entre app, backend y panel:

```
bata-service/
├── apps/
│   ├── agent-mobile/          # App Bata Services (Expo + React Native + TS)
│   ├── agent-api/             # Agent Backend (NestJS + TS)
│   └── admin-web/             # Admin Panel (Next.js + TS)
├── packages/
│   ├── contracts/             # Esquemas zod de la API, tipos, códigos de error, OpenAPI
│   ├── money/                 # Tipo Money (enteros), formateo por moneda, cálculo de comisiones
│   ├── i18n/                  # Claves y textos compartidos (errores, notificaciones)
│   ├── eslint-config/
│   └── tsconfig/
├── db/                        # Esquemas SQL, migraciones, tests de invariantes (este repo)
├── infra/                     # IaC (Terraform/Pulumi), Helm charts, políticas
├── docs/                      # Este diseño
├── .github/workflows/         # CI/CD
└── README.md
```

## 2. App móvil (`apps/agent-mobile`)

```
agent-mobile/
├── app/                                # expo-router (rutas = archivos)
│   ├── _layout.tsx                     # Providers: Query, i18n, tema, seguridad, errores
│   ├── (auth)/
│   │   ├── welcome.tsx
│   │   ├── login.tsx
│   │   ├── pin.tsx
│   │   ├── otp.tsx
│   │   ├── new-device.tsx
│   │   ├── recovery/…
│   │   └── apply/…                     # Solicitud de alta
│   ├── (onboarding)/
│   │   ├── status.tsx
│   │   └── kyc/[step].tsx
│   ├── (restricted)/account-restricted.tsx
│   ├── (app)/
│   │   ├── _layout.tsx                 # Tabs + guard de estado del agente
│   │   ├── (tabs)/
│   │   │   ├── index.tsx               # Dashboard
│   │   │   ├── operations/index.tsx
│   │   │   ├── operations/[id].tsx
│   │   │   ├── qr.tsx
│   │   │   ├── commissions/index.tsx
│   │   │   └── profile/index.tsx
│   │   ├── cash-in/…                   # Modales de operación
│   │   ├── cash-out/…
│   │   ├── collect/…
│   │   ├── settlements/…
│   │   ├── security/…
│   │   ├── kyc/…
│   │   ├── limits.tsx
│   │   ├── notifications.tsx
│   │   └── support/…
│   └── +not-found.tsx
├── src/
│   ├── api/
│   │   ├── client.ts                   # fetch + auth + firma + idempotencia + reintentos
│   │   ├── endpoints/                  # funciones tipadas por recurso (usa packages/contracts)
│   │   └── errors.ts                   # código de API → mensaje i18n
│   ├── features/
│   │   ├── auth/            { screens, components, hooks, api, store }
│   │   ├── dashboard/
│   │   ├── cashin/
│   │   ├── cashout/
│   │   ├── qr/
│   │   ├── transactions/
│   │   ├── commissions/
│   │   ├── settlements/
│   │   ├── kyc/
│   │   ├── profile/
│   │   ├── security/
│   │   ├── notifications/
│   │   └── support/
│   ├── components/                     # UI base: AmountDisplay, PinPad, BigActionButton, StatusBadge…
│   ├── navigation/                     # guards, deep links, rutas tipadas
│   ├── hooks/                          # useOnline, useAppState, useCountdown…
│   ├── store/                          # Zustand: sesión en memoria, preferencias de UI
│   ├── services/
│   │   ├── push.ts
│   │   ├── offline-cache.ts            # MMKV cifrado
│   │   └── telemetry.ts                # errores sin PII
│   ├── security/
│   │   ├── device-keys.ts              # generar/firmar con Keystore/Secure Enclave
│   │   ├── biometrics.ts
│   │   ├── secure-storage.ts           # expo-secure-store
│   │   ├── request-signing.ts          # cadena canónica + firma
│   │   ├── idempotency.ts              # generación y persistencia de claves
│   │   ├── integrity.ts                # Play Integrity / App Attest
│   │   └── screen-protection.ts
│   ├── i18n/  (locales/es/*.json)
│   ├── theme/ (tokens claro/oscuro)
│   ├── types/
│   └── utils/ (formatters, mask, dates)
├── modules/                            # Módulos nativos propios (Expo Modules API) si hacen falta
├── assets/
├── tests/ (unit, component, e2e con Maestro)
├── app.config.ts                       # variables públicas por entorno
├── eas.json
└── package.json
```

Reglas de código de la app:
- Ninguna pantalla llama a `fetch` directamente: todo pasa por `src/api/client.ts` (auth, firma, idempotencia, errores).
- Los importes son `number` enteros envueltos en `Money` (`packages/money`); prohibido `parseFloat` en importes (regla de lint).
- Nada de lógica de negocio que decida: la app **muestra** lo que el servidor calcula (comisión, límites, estado).

## 3. Agent Backend (`apps/agent-api`)

```
agent-api/
├── src/
│   ├── main.ts                         # arranque HTTP
│   ├── worker.ts                       # arranque de workers (mismo código, otro proceso)
│   ├── app.module.ts
│   ├── config/                         # carga y validación de env (zod), feature flags
│   ├── common/
│   │   ├── auth/                       # guards JWT, device-signature guard, step-up guard
│   │   ├── rbac/                       # @RequirePermission(), guard, carga de permisos
│   │   ├── idempotency/                # interceptor + repositorio idempotency_keys
│   │   ├── rate-limit/                 # Redis
│   │   ├── errors/                     # AppError, mapeo a HTTP, sin filtrar detalles
│   │   ├── audit/                      # AuditService (misma transacción)
│   │   ├── outbox/                     # escritura + relay
│   │   ├── db/                         # Kysely, transacciones, tipos generados
│   │   ├── crypto/                     # KMS, envelope encryption, HMAC, argon2id
│   │   ├── logging/                    # pino + enmascarado
│   │   └── telemetry/                  # OpenTelemetry
│   ├── modules/
│   │   ├── auth/                       # login, otp, refresh, recovery, sessions, devices
│   │   ├── onboarding/                 # solicitudes, estados del agente
│   │   ├── kyc/                        # requisitos, documentos, proveedor (adapter)
│   │   ├── profile/
│   │   ├── limits/                     # políticas, excepciones, contadores
│   │   ├── operations/
│   │   │   ├── cash-in/
│   │   │   ├── cash-out/
│   │   │   ├── qr-payments/
│   │   │   ├── transaction-state.ts    # máquina de estados
│   │   │   └── reconciler/             # resuelve operaciones en processing
│   │   ├── qr/                         # emisión, firma, resolución
│   │   ├── balances/                   # proyección desde eventos del ledger
│   │   ├── commissions/                # motor de reglas + rollups
│   │   ├── settlements/
│   │   ├── risk/                       # motor de reglas, señales, casos, ComplianceHook
│   │   ├── notifications/              # plantillas, envío, preferencias
│   │   ├── support/
│   │   └── admin/                      # controladores /admin/v1 (reusa servicios de dominio)
│   ├── integrations/                   # adapters con interfaz propia (fáciles de sustituir/mockear)
│   │   ├── core/                       # BataPay Core internal API
│   │   ├── ledger/                     # Ledger internal API
│   │   ├── sms/                        # proveedor por confirmar
│   │   ├── push/
│   │   ├── kyc-provider/               # proveedor por confirmar
│   │   ├── object-storage/
│   │   └── kms/
│   └── jobs/                           # expiraciones, holds, rollups, liquidaciones, conciliación, purga
├── test/
│   ├── unit/
│   ├── integration/                    # con PostgreSQL y Redis reales (Testcontainers)
│   ├── contract/                       # contratos con Core y Ledger (Pact)
│   └── fixtures/
├── Dockerfile
└── package.json
```

Cada módulo sigue la misma forma: `controller` (HTTP, validación) → `service` (reglas) → `repository` (SQL) + `events`. Los módulos no leen tablas de otros módulos: usan su servicio.

## 4. Admin Panel (`apps/admin-web`)

```
admin-web/
├── app/ (dashboard, agents, kyc, operations, risk, config, settlements, reconciliation, support, audit)
├── components/  (tablas con filtros, visor de documentos, diálogos de maker-checker)
├── lib/ (cliente API tipado, auth SSO, permisos para ocultar acciones)
└── tests/
```

## 5. Variables de entorno

Nunca se suben valores reales al repositorio. En producción vienen del gestor de secretos.

### Agent Backend

| Variable | Ejemplo | Secreto |
|---|---|:-:|
| `NODE_ENV` | `production` | |
| `PORT` | `3000` | |
| `PUBLIC_BASE_URL` | `https://api.example/agent/v1` | |
| `DATABASE_URL` | `postgresql://agent_app:…@pgbouncer:6432/agent` | ✅ |
| `DATABASE_READ_URL` | réplica de lectura | ✅ |
| `DATABASE_POOL_MAX` | `20` | |
| `REDIS_URL` | `rediss://…` | ✅ |
| `QUEUE_PREFIX` | `bata-services` | |
| `JWT_ISSUER` | `https://auth.example/agent` | |
| `JWT_AUDIENCE` | `bata-services-agent` | |
| `JWT_SIGNING_KEY_ID` | alias de la clave en KMS | |
| `ACCESS_TOKEN_TTL_SECONDS` | `600` | |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | |
| `REFRESH_TOKEN_IDLE_DAYS` | `7` | |
| `KMS_KEY_PIN_PEPPER` | alias de clave KMS/HSM | ✅ (referencia) |
| `KMS_KEY_DATA_ENCRYPTION` | alias de clave KMS para PII | ✅ (referencia) |
| `HMAC_KEY_LOOKUP` | referencia en gestor de secretos | ✅ |
| `QR_SIGNING_KEY_ID` | alias de clave Ed25519 | |
| `ARGON2_MEMORY_KIB` / `ARGON2_ITERATIONS` / `ARGON2_PARALLELISM` | `65536` / `3` / `1` | |
| `PIN_MAX_ATTEMPTS` | `5` | |
| `OTP_TTL_SECONDS` / `OTP_MAX_ATTEMPTS` | `300` / `3` | |
| `NEW_DEVICE_COOLDOWN_HOURS` | `24` | |
| `MAX_TRUSTED_DEVICES` | `1` | |
| `CORE_API_BASE_URL` | `https://core.internal/internal/v1` | |
| `LEDGER_API_BASE_URL` | `https://ledger.internal/internal/v1` | |
| `MTLS_CERT_PATH` / `MTLS_KEY_PATH` / `MTLS_CA_PATH` | rutas montadas | ✅ |
| `SERVICE_CLIENT_ID` / `SERVICE_CLIENT_SECRET` | credenciales de servicio | ✅ |
| `SMS_PROVIDER` / `SMS_API_KEY` | **por confirmar** | ✅ |
| `PUSH_FCM_CREDENTIALS` / `PUSH_APNS_KEY` | | ✅ |
| `KYC_PROVIDER` / `KYC_API_KEY` / `KYC_WEBHOOK_SECRET` | **por confirmar** | ✅ |
| `OBJECT_STORAGE_BUCKET_KYC` / `OBJECT_STORAGE_REGION` | | |
| `PLAY_INTEGRITY_*` / `APP_ATTEST_*` | | ✅ |
| `MIN_APP_VERSION_ANDROID` / `MIN_APP_VERSION_IOS` | `1.0.0` | |
| `DEFAULT_CURRENCY` | `XAF` | |
| `OPERATING_TIMEZONE` | `Africa/Malabo` | |
| `CASH_IN_CONFIRMATION_TTL_SECONDS` | `180` | |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | | |
| `LOG_LEVEL` | `info` | |
| `SENTRY_DSN` | | ✅ |

Límites, comisiones, umbrales de riesgo y requisitos KYC **no** son variables de entorno: son datos versionados en la base de datos, editables desde el Admin Panel con aprobación.

### App móvil (solo valores públicos)

| Variable | Ejemplo |
|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | `https://api.example/agent/v1` |
| `EXPO_PUBLIC_ENV` | `production` |
| `EXPO_PUBLIC_QR_VERIFY_PUBLIC_KEY` | clave pública Ed25519 |
| `EXPO_PUBLIC_CERT_PINS` | hashes de los certificados |
| `EXPO_PUBLIC_SENTRY_DSN` | DSN público |

Todo lo que empieza por `EXPO_PUBLIC_` acaba dentro de la app: **nunca** un secreto.

### Admin Panel

`ADMIN_API_BASE_URL`, `SSO_ISSUER`, `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET` (secreto), `SESSION_SECRET` (secreto).
