# 01 · Arquitectura

> Documento de diseño de **VELYNT SERVICES**, la aplicación para agentes autorizados de Velynt.
> Todo lo marcado **(por confirmar)** depende de la jurisdicción, del proveedor financiero regulado o de una decisión de negocio que todavía no está tomada.

## 1. Resumen

Velynt Services es un **producto separado** de Velynt, con su propio frontend, su propio backend (Agent Backend), su propia autenticación y sus propios permisos.
**No mueve dinero por sí mismo**: cada operación financiera se valida en el Agent Backend y se registra en el **Ledger central de Velynt**, que es el único componente que puede cambiar un saldo.

Tres reglas de diseño gobiernan todo lo demás:

1. **Una sola fuente de verdad del dinero**: el ledger de doble partida. Ningún otro componente guarda saldos "de verdad". Lo que ve el agente son proyecciones.
2. **El cliente (la app) nunca decide**: importes, comisiones, límites, estado de un QR o de un cliente se calculan y validan siempre en el servidor.
3. **Nada se borra ni se edita**: operaciones, asientos contables y audit logs son de solo inserción. Las correcciones se hacen con reversos.

## 2. Decisión: ¿backend separado (A) o backend compartido (B)?

| Criterio | A · Backend separado para agentes | B · Backend compartido con APIs separadas |
|---|---|---|
| Aislamiento de fallos | Un fallo o pico en agentes no tumba a los usuarios (y al revés) | Un despliegue defectuoso afecta a los dos productos |
| Aislamiento de seguridad | Tokens de agente y de usuario pertenecen a **dominios distintos** (issuer/audience distintos). Un error de permisos en el backend de agentes no puede exponer endpoints de usuarios porque no existen allí | Una ruta mal protegida o un guard olvidado puede abrir funciones de usuario a agentes, o al revés |
| Alcance de auditoría/compliance | El backend de agentes se audita como un sistema acotado | Todo el monolito entra en el alcance de cada auditoría |
| Ritmo de despliegue | Equipos y releases independientes | Releases acoplados |
| Escalado | Se escala cada backend según su carga | Se escala todo junto |
| Complejidad inicial | Algo mayor: contratos internos entre servicios | Menor al principio |
| Consistencia del dinero | Igual en ambos casos **si** el ledger es único | Igual |

### Recomendación: **A, con un ledger central compartido**

- **Agent Backend separado** (su propio despliegue, su propia base de datos `agent`), expuesto solo a la app Velynt Services y al panel de administración de agentes.
- **Ledger central único** para Velynt y Velynt Services, como servicio propio (o módulo aislado dentro del core de Velynt con API interna), con su propia base de datos `ledger`. Es el **único** que escribe asientos.
- **Velynt Core** sigue siendo el dueño de los clientes finales: identidad, estado, límites del cliente y confirmaciones del cliente (PIN en su app).
- Comunicación síncrona **interna** (mTLS + token de servicio) para validar y contabilizar, y asíncrona (eventos) para notificaciones, proyecciones y reportes.

Por qué no B: en fintech el riesgo dominante es un error de permisos o un despliegue defectuoso. A convierte ese riesgo en un fallo **contenido**. El coste extra (contratos internos) es pequeño y además obliga a documentar las fronteras, algo que auditores y reguladores suelen pedir.

Para no caer en una arquitectura de microservicios prematura: **el Agent Backend es un monolito modular** (módulos `auth`, `onboarding`, `kyc`, `operations`, `qr`, `commissions`, `settlements`, `risk`, `support`, `notifications`, `admin`). Los módulos se comunican por interfaces internas y eventos, de modo que cualquiera puede extraerse como servicio cuando el volumen lo justifique (candidatos naturales: `risk` y `notifications`).

## 3. Diagrama

```
                         ┌───────────────────────┐            ┌─────────────────────────┐
  Clientes finales ────▶ │   Velynt App          │            │  Velynt Services App      │ ◀──── Agentes
                         │  (Android / iOS)       │            │  (Android / iOS / web*) │
                         └──────────┬────────────┘            └────────────┬────────────┘
                                    │ HTTPS (tokens de USUARIO)            │ HTTPS + firma de dispositivo
                                    ▼                                      ▼ (tokens de AGENTE)
                         ┌───────────────────────┐            ┌─────────────────────────┐
                         │  API Gateway usuarios  │            │  API Gateway agentes     │ WAF, rate limit,
                         └──────────┬────────────┘            └────────────┬────────────┘ TLS, bot protection
                                    ▼                                      ▼
                         ┌───────────────────────┐  API interna ┌─────────────────────────┐   ┌────────────────┐
                         │   Velynt Core API     │◀────mTLS────▶│   Agent Backend          │◀──│ Admin Panel     │
                         │ clientes, límites de   │              │ (monolito modular)       │   │ (web, SSO+MFA)  │
                         │ cliente, confirmación  │              │ auth·kyc·operations·qr·  │   └────────────────┘
                         │ del cliente, retiros   │              │ commissions·settlements· │
                         └──────────┬────────────┘              │ risk·support·notif·admin │
                                    │                            └──────┬─────────┬────────┘
                                    │  API interna (mTLS)               │         │
                                    ▼                                   ▼         │ eventos (outbox → cola)
                         ┌─────────────────────────────────────────────────┐      ▼
                         │            LEDGER FINANCIERO (único)             │  ┌──────────────────────┐
                         │  doble partida · holds · idempotencia · reversos │  │ Workers: notificaciones,│
                         └──────────────────────┬──────────────────────────┘  │ proyecciones, comisiones│
                                                │                             │ diarias, conciliación,  │
                  ┌─────────────────────────────┼──────────────────┐          │ expiraciones            │
                  ▼                             ▼                  ▼          └──────────────────────┘
          ┌──────────────┐             ┌──────────────┐    ┌──────────────┐
          │  KYC          │             │ Riesgo/Fraude │    │ Pagos /       │
          │ (proveedor    │             │ + hooks de    │    │ Bancos        │
          │ por confirmar)│             │ compliance    │    │ (por confirmar)│
          └──────────────┘             └──────────────┘    └──────────────┘
                                                │
                                                ▼
                                      Proveedores externos (SMS, push, KYC, bancos, screening) — por confirmar
```

`*` La versión web para agentes es de **solo consulta** en la primera etapa (ver §5).

### Qué es dueño de qué

| Dominio | Dueño | Datos |
|---|---|---|
| Identidad y estado del agente, dispositivos, sesiones | Agent Backend | BD `agent` |
| KYC del agente (metadatos) | Agent Backend | BD `agent` + almacenamiento de objetos cifrado |
| Clientes finales, su KYC, sus límites | Velynt Core | BD del core (no se copia a `agent`) |
| Saldos y movimientos de dinero | Ledger | BD `ledger` |
| Reglas de comisiones, límites de agente, reglas de riesgo | Agent Backend (configuración) | BD `agent` |
| Audit logs de acciones de agente y staff | Agent Backend | BD `agent` + copia WORM |

## 4. Cómo viaja una operación (visión general)

1. La app envía la intención (p. ej. "cash-out del código X") con `Idempotency-Key` y **firma del dispositivo**.
2. El gateway valida TLS, token de agente y rate limit.
3. El Agent Backend valida: sesión, dispositivo de confianza, estado del agente, permisos, límites, riesgo y duplicados.
4. Pide a Velynt Core lo que es del cliente (estado del cliente, confirmación del cliente, solicitud de retiro).
5. Llama al Ledger con **una sola transacción contable multi-línea** (operación + comisión), con su propia clave de idempotencia. O se contabiliza todo o nada: no hace falta coordinación distribuida para el dinero.
6. Marca la operación como `completed`, escribe audit log y un evento en el *outbox* dentro de la misma transacción de base de datos.
7. Los workers publican notificaciones, actualizan proyecciones de saldo y acumulan comisiones diarias.

El detalle paso a paso está en [07-flujos.md](07-flujos.md) y el modelo contable en [04-ledger.md](04-ledger.md).

## 5. Stack tecnológico

### App móvil del agente

| Pieza | Elección | Motivo |
|---|---|---|
| Framework | **React Native + Expo (SDK actual) + TypeScript** con *development builds* (no Expo Go) | Android + iOS con un código; los *development builds* permiten módulos nativos de seguridad |
| Navegación | `expo-router` | Rutas por archivos, deep links |
| Datos del servidor | TanStack Query | Caché, reintentos controlados, estados de carga |
| Estado local | Zustand (mínimo) | Solo estado de UI y sesión |
| Formularios | react-hook-form + zod | Validación en cliente (solo UX; el servidor revalida todo) |
| Almacenamiento seguro | `expo-secure-store` (Keystore / Keychain) | Refresh token, id de instalación |
| Caché local | `react-native-mmkv` cifrado | Datos no sensibles para modo sin conexión |
| Biometría y claves | `expo-local-authentication` + módulo nativo de **claves de dispositivo** (Android Keystore / Secure Enclave) que firma con desbloqueo biométrico (p. ej. `react-native-biometrics` o módulo propio con Expo Modules API) | La biometría desbloquea una clave privada que nunca sale del dispositivo |
| Cámara/QR | `expo-camera` (lector de códigos) | Escaneo rápido en gama baja |
| Notificaciones | `expo-notifications` (FCM/APNs) | Push |
| i18n | i18next + `expo-localization` | Español por defecto; preparado para más idiomas |
| Integridad de la app | Google Play Integrity / Apple App Attest | Detectar apps modificadas o emuladores (política por confirmar) |
| Errores | Sentry (o equivalente) con limpieza de datos personales | Diagnóstico sin PII |
| Distribución | EAS Build / EAS Submit; actualizaciones OTA solo para cambios no críticos y firmadas | |

**Versión web para agentes**: tiene sentido para consultar historial, comisiones, liquidaciones, soporte y descargar reportes desde un ordenador del establecimiento. **Recomendación**: hacerla más adelante (fase 4) con Expo web (misma base de código, `react-native-web`) y **sin operaciones financieras**, porque la web no ofrece claves ligadas a hardware ni cámara fiable en todos los equipos. Si más adelante se quiere operar desde web, habría que añadir WebAuthn/passkeys como factor ligado al dispositivo.

### Agent Backend

| Pieza | Elección | Alternativa |
|---|---|---|
| Runtime | Node.js LTS + TypeScript | — |
| Framework | **NestJS** (adaptador Fastify): módulos, inyección de dependencias, guards para RBAC | Fastify puro |
| Acceso a datos | **Kysely** (SQL tipado; control total de las consultas del dinero) | Drizzle |
| Migraciones | Archivos SQL versionados (este repo: `db/`), ejecutados con una herramienta de migraciones (p. ej. `node-pg-migrate` o `dbmate`) | |
| Validación | zod en cada DTO; esquemas compartidos para generar OpenAPI | |
| Base de datos | **PostgreSQL** gestionado (15+), alta disponibilidad con réplica síncrona | |
| Caché, rate limit, OTP counters, nonces | Redis gestionado | |
| Colas | **BullMQ** (Redis) al principio; migrar a un broker gestionado (Kafka, RabbitMQ o SQS) al crecer | |
| Eventos | Patrón *transactional outbox* (tabla `outbox_events`) | |
| Ficheros KYC | Almacenamiento de objetos compatible S3, cifrado con KMS, URLs firmadas de corta vida | |
| Secretos y claves | KMS/HSM gestionado + gestor de secretos; nunca en el repositorio ni en la app | |
| Hash de PIN | argon2id + *pepper* guardado en KMS/HSM | |
| Logs | pino (JSON estructurado) | |
| Observabilidad | OpenTelemetry → plataforma de métricas/trazas/logs (por elegir) | |
| Contenedores | Docker + Kubernetes gestionado (o un PaaS de contenedores al inicio) | |

**Región de despliegue y residencia de datos: (por confirmar)**. Depende de la normativa aplicable en Guinea Ecuatorial y en la zona CEMAC, y de los requisitos del proveedor financiero. La latencia desde Bata/Malabo hacia la región elegida debe medirse antes de decidir.

### Admin Panel

Aplicación web separada (Next.js o React + Vite), accesible solo desde red corporativa o VPN, con **SSO corporativo + MFA**, que usa la API `/admin/v1` del Agent Backend. Ver [08-modulos-negocio.md](08-modulos-negocio.md#admin-panel).

## 6. Comunicación entre servicios

| De → a | Tipo | Seguridad | Ejemplos |
|---|---|---|---|
| App → Agent API | HTTPS REST | Token de agente (10 min) + firma de dispositivo en operaciones | `POST /agent/v1/cash-out` |
| Agent Backend → Core | HTTPS REST interno | mTLS + token de servicio con *scopes* (`core.customers:lookup`, `core.withdrawals:claim`…) | Resolver cliente, reclamar retiro |
| Agent Backend → Ledger | HTTPS REST interno | mTLS + token de servicio (`ledger.post`, `ledger.hold`) | Contabilizar cash-in |
| Core → Agent Backend | Webhook interno firmado o evento | mTLS / firma HMAC | "El cliente confirmó el depósito" |
| Servicios → workers | Cola (outbox) | Red privada | Notificaciones, proyecciones |

Reglas:
- **Timeouts cortos y reintentos solo con la misma clave de idempotencia.**
- *Circuit breaker* hacia proveedores externos (SMS, KYC, bancos).
- Si el Core o el Ledger no responden, la operación queda en `processing` y un *reconciler* la resuelve consultando por clave de idempotencia. **Nunca** se marca como completada sin confirmación del ledger.

## 7. Escalabilidad por etapas (sin reconstruir)

Supuesto de carga para dimensionar (**a validar con datos reales**): 30–60 operaciones por agente y día, picos de 10× la media en horas punta y fines de mes.

| Etapa | Operaciones/día (aprox.) | Media → pico | Infraestructura |
|---|---|---|---|
| **100 agentes** (piloto) | 3.000–6.000 | < 1 op/s → ~5 op/s | 2 réplicas del Agent API, PostgreSQL gestionado con standby síncrono, Redis gestionado, 1 worker |
| **1.000 agentes** | 30.000–60.000 | ~1 → ~10 op/s | Lo anterior + autoescalado 2–4 réplicas, PgBouncer, réplica de lectura para historial/reportes, particiones mensuales activas |
| **10.000 agentes** | 300.000–600.000 | ~7 → ~70 op/s | 4–10 réplicas, workers separados por cola, *rollups* diarios de comisiones, almacén analítico alimentado por CDC (réplica lógica), CDN para contenidos estáticos |
| **100.000 agentes** | 3–6 millones | ~70 → 500–1.000 op/s | Broker gestionado (Kafka o equivalente), servicio de riesgo extraído, ledger con cuentas "calientes" optimizadas y posible particionado por rangos de cuentas, multi-AZ con DR en otra región, equipo de guardia 24/7 |

Lo que ya queda preparado desde el día 1 para que el crecimiento no obligue a reescribir:
- IDs UUID y referencias opacas entre servicios (sin claves foráneas entre bases de datos).
- `ledger_entries` particionada por mes desde el principio.
- Paginación por **cursor** (no `OFFSET`) en todos los listados.
- Idempotencia y outbox desde la primera operación.
- Cuentas de sistema de alto tráfico (`fee_revenue`, `commission_expense`) sin bloqueo de fila por asiento (`track_balance = false`), con saldo calculado por agregación.
- Proyecciones (`agent_balances`, `agent_commission_daily`) para que las pantallas no consulten el ledger en cada apertura.
- Configuración (límites, comisiones, reglas KYC y de riesgo) como **datos versionados**, no como código.

## 8. Caché

| Qué | Dónde | TTL | Nota |
|---|---|---|---|
| Configuración (límites, planes de comisión, textos) | Memoria del proceso + Redis | 1–5 min, invalidación por evento | Cambios auditados |
| Resumen del dashboard | Redis por agente | 15–30 s | Se invalida al completar una operación |
| Saldo operativo | Proyección `agent_balances` | Actualizada por evento | Las **comprobaciones** de fondos siempre van al ledger |
| Historial | Réplica de lectura + paginación por cursor | — | |
| Nonces de firma, contadores de OTP/PIN | Redis | 5–15 min | |

Nunca se cachea: autorización de una operación, estado de un QR sensible, saldo usado para decidir una operación.

## 9. Observabilidad y operación

- **Métricas de negocio**: operaciones por tipo y estado, tasa de éxito, tiempo hasta completar, operaciones en `processing` > 2 min, holds expirados, float bajo por agente, diferencias de conciliación.
- **Métricas técnicas**: latencia p50/p95/p99 por endpoint, errores 5xx, saturación de BD (conexiones, locks, replicación), profundidad de colas, reintentos a proveedores.
- **Trazas distribuidas** con `request_id` propagado App → Gateway → Agent Backend → Core/Ledger.
- **Alertas** (ejemplos): tasa de error > 2 % en 5 min; p95 de `POST /cash-out` > 2 s; cualquier fila en `v_unbalanced_transactions`; conciliación con diferencias; pico anómalo de logins fallidos.
- **Logs** sin PIN, OTP, tokens, documentos ni teléfonos completos (se enmascaran en el logger).

## 10. Copias de seguridad, alta disponibilidad y recuperación ante desastres

| Tema | Diseño |
|---|---|
| Alta disponibilidad | PostgreSQL con standby **síncrono** en otra zona (sin pérdida de datos confirmados); Agent API en ≥ 2 zonas |
| Backups | Snapshots diarios + archivado continuo de WAL (recuperación a un instante dado), cifrados, en otra región/cuenta |
| Objetivos propuestos | RPO ≈ 0 para el ledger (réplica síncrona) y ≤ 5 min para el resto; RTO ≤ 1 h al inicio, ≤ 15 min en la etapa de 10.000 agentes. **Objetivos finales (por confirmar)** con negocio y regulador |
| Pruebas | Restauración completa a un entorno aislado **cada mes**, con conciliación del ledger restaurado |
| DR | Réplica en otra región a partir de la etapa de 10.000 agentes; *runbook* de conmutación ensayado |
| Audit logs | Copia diaria a almacenamiento WORM (object lock) |

## 11. Modo sin conexión

| Función | Sin conexión | Detalle |
|---|---|---|
| Ver saldo, resumen del día, últimas operaciones | ✅ Solo lectura | Datos cacheados con la marca **"Actualizado hace X min · sin conexión"** |
| Ver perfil, límites, comisiones, liquidaciones | ✅ Solo lectura | Caché cifrada |
| Contenidos de ayuda | ✅ | Empaquetados en la app |
| Preparar un borrador (importe, cliente, incidencia) | ✅ | Se envía al recuperar la conexión, **pidiendo confirmación de nuevo** |
| Crear/confirmar cash-in, cash-out, cobros QR | ❌ | Requieren validación del servidor. El botón indica "Necesitas conexión para operar" |
| Generar QR de cobro o depósito | ❌ | Deben quedar registrados en el servidor |
| Login inicial, cambio de PIN, dispositivos | ❌ | |

**Conexión que se corta en mitad de una operación**: la app muestra **"Estamos verificando la operación"**, conserva la clave de idempotencia y, al volver la conexión, consulta el estado real (`GET /agent/v1/transactions/by-key/{key}`). **Nunca** reenvía la operación con una clave nueva ni la da por hecha. El agente no debe entregar efectivo hasta ver "RETIRO COMPLETADO".

Canales alternativos para zonas con mala cobertura (USSD o SMS): **(por confirmar)** con los operadores móviles.

## 12. Privacidad y minimización de datos

- El agente solo ve lo necesario del cliente: `****4821` y, si el negocio lo requiere, el nombre abreviado ("Juan M.") **(por confirmar)**. Nunca el saldo del cliente, su historial ni sus documentos.
- La base de datos `agent` guarda del cliente **solo** una referencia opaca y el enmascarado de la operación.
- Documentos KYC: fuera de la base de datos, cifrados, accesibles solo por COMPLIANCE mediante URLs firmadas de pocos minutos; cada visualización genera audit log.
- Ubicación: solo a nivel ciudad, derivada de la IP o del establecimiento. La geolocalización precisa por operación, si se usa para riesgo, requiere consentimiento y política de retención **(por confirmar)**.
- Retención de datos por tipo **(por confirmar)** según normativa; el diseño permite purgar PII de agentes dados de baja conservando los registros financieros anonimizados.
