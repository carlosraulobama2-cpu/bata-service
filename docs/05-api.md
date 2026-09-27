# 05 · API del agente (Agent API)

Base: `https://api.<dominio-por-confirmar>/agent/v1`. Las rutas del enunciado (`/agent/cash-in`…) corresponden a `/agent/v1/cash-in`: el prefijo de versión permite evolucionar sin romper apps antiguas.

Existen tres superficies separadas, con tokens de audiencias distintas:

| Superficie | Prefijo | Quién | Token |
|---|---|---|---|
| Agent API | `/agent/v1` | App Bata Services | JWT `aud = bata-services-agent`, rol `AGENT` |
| Admin API | `/admin/v1` | Admin Panel | JWT del IdP corporativo, roles de staff |
| Internal API | `/internal/v1` | Servicios (Core, Ledger, workers) | mTLS + token de servicio con *scopes* |

Un token de usuario de BataPay **no es válido** en ninguna de ellas, ni un token de agente en la API de usuarios.

## 1. Convenciones

### Cabeceras

| Cabecera | Obligatoria | Uso |
|---|---|---|
| `Authorization: Bearer <access_token>` | Todas salvo login/solicitud | Access token (JWT ES256, 10 min) |
| `X-Device-Id` | Todas | Id del dispositivo registrado |
| `X-App-Version` | Todas | Permite forzar actualización (`APP_UPDATE_REQUIRED`) |
| `X-Request-Id` | Recomendada | Trazabilidad (el servidor genera uno si falta) |
| `Idempotency-Key` | **Todas las peticiones POST que crean algo** | UUID v4, uno por intento lógico; se reutiliza en los reintentos |
| `X-Timestamp` | Operaciones financieras | Epoch en ms; tolerancia ±60 s |
| `X-Device-Signature` | Operaciones financieras y de seguridad | Firma ES256 con la clave del dispositivo (ver §2) |

### Formato

- JSON UTF-8, `snake_case`, fechas ISO-8601 en UTC (`2026-09-26T09:42:00Z`); la app las muestra en `Africa/Malabo`.
- **Importes como enteros** en unidades mínimas + `currency`: `{"amount": 50000, "currency": "XAF"}`.
- Paginación por cursor: `?limit=20&cursor=<opaco>` → `{"data": [...], "next_cursor": "..." | null}`.

### Errores

```json
HTTP/1.1 422
{
  "error": {
    "code": "LIMIT_DAILY_EXCEEDED",
    "message": "Esta operación supera tu límite diario.",
    "details": { "remaining_today": 150000, "currency": "XAF" },
    "request_id": "req_01J8Z9…"
  }
}
```

| HTTP | Cuándo |
|---|---|
| 400 | JSON o parámetros mal formados (`VALIDATION_ERROR`) |
| 401 | Token ausente/caducado/inválido (`SESSION_EXPIRED`, `UNAUTHENTICATED`) |
| 403 | Sin permiso, dispositivo no confiable, agente no activo (`FORBIDDEN`, `DEVICE_NOT_TRUSTED`, `ACCOUNT_SUSPENDED`) |
| 404 | Recurso inexistente **o de otro agente** (nunca se revela que existe) |
| 409 | Conflicto de estado o idempotencia (`ALREADY_PROCESSED`, `IDEMPOTENCY_KEY_REUSED`, `QR_ALREADY_USED`) |
| 410 | Caducado (`QR_EXPIRED`, `OTP_EXPIRED`) |
| 422 | Regla de negocio (`INSUFFICIENT_FLOAT`, `LIMIT_*`, `CUSTOMER_UNAVAILABLE`) |
| 423 | Cuenta bloqueada (`ACCOUNT_LOCKED`) |
| 426 | Versión de app obsoleta (`APP_UPDATE_REQUIRED`) |
| 429 | Rate limit (`RATE_LIMITED`, con `Retry-After`) |
| 500/502/503 | Error interno o dependencia caída (`INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`); **nunca** con detalles técnicos |

El catálogo completo de códigos y textos está en [02-ux-ui.md §5](02-ux-ui.md#5-catálogo-de-mensajes-de-error).

### Idempotencia

1. La app genera `Idempotency-Key` al pulsar "Confirmar" y la guarda hasta tener un resultado definitivo.
2. El servidor guarda `(agent_id, key, hash del cuerpo)` como `in_progress`.
3. Misma clave + mismo cuerpo, ya completada → devuelve **la misma respuesta** (mismo status y cuerpo) con cabecera `Idempotent-Replayed: true`.
4. Misma clave + mismo cuerpo, todavía en curso → `409 OPERATION_IN_PROGRESS` con la referencia; la app consulta el estado.
5. Misma clave + cuerpo distinto → `409 IDEMPOTENCY_KEY_REUSED`.
6. Las claves caducan a las 48 h.

### Rate limiting (valores iniciales, configurables)

| Grupo | Límite | Clave |
|---|---|---|
| `POST /auth/login` | 5/min por teléfono y 20/min por IP | teléfono (HMAC) + IP |
| `POST /auth/verify-otp` | 3 intentos por desafío, 10/h por agente | desafío, agente |
| `POST /auth/refresh` | 30/h por sesión | sesión |
| Operaciones financieras (`cash-in`, `cash-out`, `qr/create`) | 20/min por agente | agente |
| `POST /cash-out/resolve`, `POST /qr/scan` | 30/min por agente; 5 códigos inválidos en 10 min → bloqueo temporal de la función | agente |
| Lecturas | 120/min por agente | agente |
| `POST /onboarding/applications` | 3/día por teléfono, 10/h por IP | teléfono + IP |
| `POST /support/tickets` | 10/día por agente | agente |

Respuestas incluyen `X-RateLimit-Limit`, `X-RateLimit-Remaining` y, al superarlo, `Retry-After`.

## 2. Autenticación y firma de dispositivo

- **Access token**: JWT firmado con ES256 (clave en KMS, rotación con `kid`), 10 min, *claims*: `sub` (agent id), `aid` (AG-000001), `sid` (sesión), `did` (dispositivo), `role: AGENT`, `aal` (nivel de autenticación), `aud`, `iss`.
- **Refresh token**: opaco (256 bits), 30 días de vida absoluta y 7 días de inactividad (configurables), **rotado en cada uso**; se guarda solo su hash. Si se reutiliza uno ya rotado → se revoca toda la familia (posible robo).
- **Claves del dispositivo** (generadas en el alta del dispositivo, nunca salen del hardware):
  - *Device key*: firma cada operación financiera (prueba de que la petición sale del dispositivo registrado).
  - *Biometric key*: requiere biometría del sistema para firmar; se usa como alternativa al PIN en la confirmación.
- **Firma** (`X-Device-Signature`): ES256 sobre la cadena canónica

```
<METHOD>\n<PATH>\n<SHA256(body) en hex>\n<X-Timestamp>\n<Idempotency-Key>
```

El servidor verifica con la clave pública registrada, la tolerancia de tiempo y que la combinación no se haya usado (nonce en Redis 5 min).

- **Confirmación del agente** (step-up) en cada operación financiera: el cuerpo lleva
  `"agent_auth": {"method": "pin", "pin": "••••••"}` (verificado en el servidor, cuenta intentos) o
  `"agent_auth": {"method": "biometric", "signature": "<firma con la biometric key>"}`.
  El PIN viaja solo sobre TLS, nunca se registra en logs y se descarta tras verificarlo.

## 3. Endpoints de autenticación

### POST /auth/login

Público. Rate limit estricto.

```json
// Request
{
  "phone": "+240222000001",
  "pin": "482913",
  "device": {
    "installation_id": "inst_7c9e…",
    "platform": "android",
    "model": "Samsung Galaxy A14",
    "os_version": "13",
    "app_version": "1.0.0",
    "integrity_token": "<Play Integrity / App Attest>"
  }
}
```

```json
// 200 · dispositivo de confianza y riesgo bajo
{
  "status": "authenticated",
  "access_token": "eyJ…",
  "access_token_expires_in": 600,
  "refresh_token": "rt_…",
  "agent": { "agent_code": "AG-000001", "first_name": "Carlos", "status": "active" }
}
```

```json
// 200 · requiere OTP (dispositivo nuevo, riesgo o política)
{
  "status": "otp_required",
  "challenge_id": "otp_01J8…",
  "channel": "sms",
  "destination_masked": "****0001",
  "expires_in": 300,
  "reason": "new_device"
}
```

Errores: `401 INVALID_CREDENTIALS` (mensaje neutro, incluye `attempts_left` solo si el teléfono existe y el dispositivo es de confianza), `423 ACCOUNT_LOCKED` (`locked_until`), `403 ACCOUNT_SUSPENDED`, `426 APP_UPDATE_REQUIRED`, `429`.

Reglas: 5 PIN fallidos → bloqueo 15 min; cada bloqueo sucesivo duplica la duración; al 3.er bloqueo en 24 h → estado `blocked` (requiere recuperación). Umbrales configurables.

### POST /auth/verify-otp

```json
// Request
{
  "challenge_id": "otp_01J8…",
  "code": "551204",
  "device_keys": {                       // solo si es un dispositivo nuevo
    "device_public_key": "<JWK ES256>",
    "biometric_public_key": "<JWK ES256>" // opcional
  }
}
```

```json
// 200
{
  "status": "authenticated",
  "access_token": "eyJ…",
  "access_token_expires_in": 600,
  "refresh_token": "rt_…",
  "device": { "id": "dev_…", "status": "trusted", "cooldown_until": "2026-09-27T10:32:00Z" },
  "agent": { "agent_code": "AG-000001", "first_name": "Carlos", "status": "active" }
}
```

Errores: `400 OTP_INVALID` (`attempts_left`), `410 OTP_EXPIRED`, `429`. Tras 3 fallos el desafío se invalida.

Efectos: dispositivo nuevo → notificación "Nuevo dispositivo detectado" a los demás dispositivos y SMS, periodo de enfriamiento con límites reducidos, `agent_access_events.new_device_detected`, audit log.

### POST /auth/biometric/challenge → POST /auth/biometric/login

Login rápido en dispositivo de confianza: el servidor devuelve un `nonce`; la app lo firma con la *biometric key* tras la huella/cara y lo envía. Sin PIN ni OTP. Si el riesgo es alto, el servidor responde `otp_required`.

### POST /auth/refresh

```json
// Request
{ "refresh_token": "rt_…" }
// 200
{ "access_token": "eyJ…", "access_token_expires_in": 600, "refresh_token": "rt_nuevo…" }
```

Errores: `401 SESSION_EXPIRED`, `401 SESSION_REVOKED` (incluye revocación remota o reutilización detectada).

### POST /auth/logout

Revoca la sesión actual. `204`.

### POST /auth/recovery/start · /auth/recovery/verify · /auth/recovery/complete

Ver flujo 14 en [07-flujos.md](07-flujos.md#14-recuperación-de-cuenta). Siempre responde `202` con mensaje neutro en `start` (no revela si el número existe).

## 4. Agente y perfil

| Método y ruta | Descripción |
|---|---|
| `GET /me` | Estado del agente, permisos efectivos (lista de *features*), versión mínima de app. La app decide qué stack mostrar con esto |
| `GET /profile` | Perfil: `agent_code`, nombre, estado, nivel, ubicación, negocio (datos mínimos) |
| `POST /profile/change-requests` | Solicitud de cambio de un dato verificado (se revisa en back-office) |
| `GET /limits` | Límites efectivos y uso actual |
| `POST /cash-declarations` | Declarar efectivo físico en caja (opcional) |

```json
// GET /profile · 200
{
  "agent_code": "AG-000001",
  "first_name": "Carlos",
  "last_name": "N.",
  "status": "active",
  "tier": { "code": "tier_1", "name": "Agente" },
  "location": { "city": "Bata", "country": "GQ" },
  "business": { "trade_name": "Bata Services Agent", "city": "Bata", "opening_hours": { "mon": [["08:00", "20:00"]] } },
  "kyc": { "status": "approved", "next_review_at": "2027-09-01" }
}
```

```json
// GET /limits · 200
{
  "tier": "tier_1",
  "cooldown_until": null,
  "limits": [
    {
      "operation_type": "cash_out",
      "currency": "XAF",
      "per_transaction": { "max": 500000 },
      "daily": { "max": 2000000, "used": 420000, "remaining": 1580000, "count_max": 100, "count_used": 12 },
      "monthly": { "max": 20000000, "used": 6400000, "remaining": 13600000 }
    }
  ]
}
```

## 5. KYC

### GET /kyc

```json
{
  "status": "in_progress",
  "requirement_set": { "country": "GQ", "version": 3 },
  "requirements": [
    { "code": "identity_document", "category": "identity_document", "required": true,
      "accepted_document_types": ["national_id", "passport", "residence_permit"],
      "status": "verified", "expires_on": "2029-05-01" },
    { "code": "selfie", "category": "selfie", "required": true, "status": "rejected",
      "rejection_reason": "IMAGE_BLURRY" },
    { "code": "proof_of_address", "category": "address_proof", "required": false, "status": "missing" }
  ]
}
```

### POST /kyc/documents (subida en dos pasos)

1. `POST /kyc/documents/upload-url` → `{ "upload_id", "url" (firmada, PUT, 5 min), "max_bytes", "accepted_mime_types" }`
2. La app sube el fichero directamente al almacenamiento de objetos.
3. `POST /kyc/documents`:

```json
// Request (Idempotency-Key)
{
  "upload_id": "upl_…",
  "requirement_code": "identity_document",
  "document_type": "national_id",
  "sha256": "9f86d0…",
  "document_number": "…",        // se cifra en servidor; opcional según requisito
  "issuing_country": "GQ",
  "expires_on": "2029-05-01"
}
// 201
{ "document_id": "doc_…", "status": "uploaded" }
```

El servidor comprueba tipo MIME real, tamaño, hash, análisis antimalware y que el `upload_id` pertenece al agente. Errores: `422 DOCUMENT_TYPE_NOT_ACCEPTED`, `422 FILE_TOO_LARGE`, `409 KYC_ALREADY_SUBMITTED`.

`POST /kyc/submit` → envía el expediente a revisión (valida que todos los requisitos obligatorios estén presentes).

## 6. Saldos y dashboard

### GET /balance

```json
{
  "float": {
    "currency": "XAF",
    "available": 2450000,
    "held": 100000,
    "ledger_balance": 2550000,
    "as_of": "2026-09-26T09:42:10Z"
  },
  "commissions_pending": { "currency": "XAF", "amount": 185400 },
  "next_settlement": { "scheduled_for": "2026-09-30", "estimated_amount": 185400 },
  "declared_cash": { "currency": "XAF", "amount": 1200000, "declared_at": "2026-09-26T07:00:00Z" }
}
```

### GET /dashboard

Todo lo del inicio en una llamada (saldo, totales de hoy por tipo, comisiones de hoy, 5 últimas operaciones, pendientes, avisos). Cacheado 15–30 s por agente e invalidado al completar una operación.

## 7. Cash-in

### POST /cash-in

Autenticación: token + firma de dispositivo + `agent_auth`. Permiso `self:cash_in.create`. Agente `active`.

```json
// Request
{
  "customer": { "type": "token", "value": "ctk_…" },   // de POST /qr/scan; o { "type": "phone", "value": "+240222111222" }
  "amount": 100000,
  "currency": "XAF",
  "agent_auth": { "method": "pin", "pin": "482913" }
}
```

```json
// 201 · esperando confirmación del cliente
{
  "transaction": {
    "id": "b1f0…",
    "reference": "BTX-00092832",
    "type": "cash_in",
    "status": "pending",
    "amount": 100000,
    "currency": "XAF",
    "commission": 500,
    "customer_masked": "****4821",
    "expires_at": "2026-09-26T09:45:10Z",
    "next_action": "WAIT_CUSTOMER_CONFIRMATION"
  }
}
```

Validaciones del servidor (en este orden, todas en servidor):
1. Sesión, dispositivo de confianza, firma, `agent_auth`, agente `active`, KYC del agente vigente.
2. Importe entero > 0, moneda soportada, dentro de límites (por operación, diario, mensual, recuento, enfriamiento).
3. Cliente resuelto en BataPay Core: activo, puede recibir (límite de cartera, nivel KYC del cliente). El agente solo recibe `customer_masked`.
4. Duplicados: mismo agente + mismo cliente + mismo importe en los últimos N min → requiere confirmación explícita (`409 POSSIBLE_DUPLICATE` con `confirm_duplicate: true` para seguir).
5. Riesgo: `allow` / `step_up` (pide biometría u OTP) / `review` / `block`.
6. Comisión calculada con el plan activo.
7. **Hold** del importe en el float (en el ledger). Si no hay fondos: `422 INSUFFICIENT_FLOAT`.
8. Se pide a Core que envíe la solicitud de confirmación al cliente.

La confirmación del cliente llega por evento interno (Core → Agent Backend). Entonces: contabilización atómica, `completed`, notificaciones a agente y cliente.

La app sigue el estado con `GET /transactions/{id}` (cada 2 s, máximo hasta `expires_at`) o push.

Errores: `422 INSUFFICIENT_FLOAT`, `422 LIMIT_*`, `422 CUSTOMER_UNAVAILABLE`, `409 POSSIBLE_DUPLICATE`, `403 ACCOUNT_SUSPENDED`, `401 PIN_INVALID`, `409 IDEMPOTENCY_KEY_REUSED`.

### POST /transactions/{id}/cancel

Solo si `pending`. Libera el hold. `200` con la operación en `cancelled`.

## 8. Cash-out

### POST /cash-out/resolve

Consulta sin efectos: ¿qué hay detrás de este QR/código?

```json
// Request
{ "code": { "type": "qr", "value": "BSV1.W.9kLm…" } }     // o { "type": "code", "value": "482 913 775" }
// 200
{
  "withdrawal_request_id": "wdr_7F3K2",
  "amount": 50000,
  "currency": "XAF",
  "customer_masked": "****4821",
  "expires_at": "2026-09-26T09:47:00Z",
  "commission": 500
}
```

Errores: `404 WITHDRAWAL_CODE_INVALID` (no se distingue "no existe" de "es de otro"), `410 QR_EXPIRED`, `409 QR_ALREADY_USED`. 5 fallos en 10 min → `429` y bloqueo temporal de la función (evita adivinar códigos).

### POST /cash-out

```json
// Request (Idempotency-Key, X-Device-Signature)
{
  "withdrawal_request_id": "wdr_7F3K2",
  "amount": 50000,                     // debe coincidir con el del servidor; se usa solo como comprobación
  "currency": "XAF",
  "agent_auth": { "method": "biometric", "signature": "MEUCIQ…" }
}
```

```json
// 201 · completado
{
  "transaction": {
    "id": "c7a2…",
    "reference": "BTX-00092831",
    "type": "cash_out",
    "status": "completed",
    "amount": 50000,
    "currency": "XAF",
    "commission": 500,
    "customer_masked": "****4821",
    "agent_code": "AG-000001",
    "completed_at": "2026-09-26T09:42:03Z",
    "next_action": "HAND_OVER_CASH"
  }
}
```

```json
// 202 · en verificación (timeout de una dependencia o revisión)
{
  "transaction": { "reference": "BTX-00092831", "status": "processing", "next_action": "WAIT_DO_NOT_HAND_OVER_CASH" }
}
```

Validaciones: las de cash-in (agente, dispositivo, límites, riesgo) + solicitud de retiro válida, no caducada, no usada, importe igual al del servidor (`422 AMOUNT_MISMATCH` si no), cliente activo. Core **reclama** la solicitud de forma atómica (un solo agente puede usarla) y el ledger contabiliza capturando el hold de la cartera del cliente.

## 9. QR

Formato del contenido (compacto para QR de baja densidad):

```
BSV1.<tipo>.<id aleatorio base64url 128 bits>.<firma Ed25519 base64url>
tipos: A = agente estático · C = cliente (para depósito) · K = cobro · W = retiro (emitido por BataPay Core)
```

La firma va **completa** (64 bytes; unos 115 caracteres en total, QR versión ~7): una firma Ed25519 truncada no se puede verificar. Los QR `A` y `K` los firma el Agent Backend (`QR_SIGNING_PRIVATE_KEY_PEM`); los `C` y `W` los emite y valida BataPay Core.

El QR **no contiene importes ni datos personales**. La firma permite descartar QR falsos antes de ir al servidor, pero **la validez la decide siempre el servidor**.

### POST /qr/create

```json
// Request (Idempotency-Key)
{ "kind": "collect", "amount": 25000, "currency": "XAF" }
// 201
{
  "qr_id": "qr_…",
  "kind": "collect",
  "payload": "BSV1.K.Zx8…",
  "amount": 25000,
  "currency": "XAF",
  "expires_at": "2026-09-26T09:52:00Z",
  "single_use": true
}
```

`kind`: `collect` (cobro con importe, un uso, caduca) · `agent_static` (devuelve el QR estático, lo crea si no existe). Errores: `422 LIMIT_*`, `403 FORBIDDEN`.

Crear un QR de cobro crea también la operación `qr_payment` en `pending` (aparece en el historial como "Pago QR ⏳"), reserva los límites y devuelve `transaction`. Si caduca o el agente la cancela (`POST /transactions/{id}/cancel`), la operación pasa a `cancelled`, se liberan los límites y el QR queda `expired`/`revoked`.

### GET /qr/{id}

Estado del QR (`active`, `used`, `expired`) y operación vinculada. Lo usa la pantalla de cobro para mostrar "Pagado ✔".

### POST /qr/scan

```json
// Request
{ "payload": "BSV1.W.9kLm…" }
// 200
{ "action": "cash_out", "withdrawal": { "withdrawal_request_id": "wdr_7F3K2", "amount": 50000, "currency": "XAF", "customer_masked": "****4821", "expires_at": "…" } }
// o
{ "action": "cash_in", "customer": { "customer_token": "ctk_…", "customer_masked": "****4821" } }
```

`customer_token` es un token de un solo uso y corta vida que representa al cliente sin exponer su id; se envía después en `POST /cash-in`.

## 10. Operaciones

### GET /transactions

Parámetros: `period=today|yesterday|last_7_days|this_month|custom`, `from`, `to` (máx. 92 días), `type` (múltiple), `status` (múltiple), `limit` (≤ 50), `cursor`.

```json
{
  "data": [
    {
      "id": "c7a2…",
      "reference": "BTX-00092831",
      "type": "cash_out",
      "amount": 50000,
      "currency": "XAF",
      "status": "completed",
      "created_at": "2026-09-26T09:42:01Z",
      "customer_masked": "****4821",
      "commission": 500,
      "method": "qr",
      "external_reference": "WDR-7F3K2"
    }
  ],
  "totals": { "cash_in": 850000, "cash_out": 420000, "qr_payment": 180000, "commissions": 12500, "currency": "XAF" },
  "next_cursor": "eyJ0IjoiMjAyNi0wOS0yNlQwOTo0MjowMVoiLCJpIjoiYzdhMiJ9"
}
```

### GET /transactions/{id} · GET /transactions/by-key/{idempotency_key} · GET /transactions/{id}/receipt

Detalle (incluye `events`: línea temporal de estados), consulta por clave de idempotencia (para recuperar el estado tras un corte de red) y recibo (JSON para renderizar + PDF opcional). Solo operaciones del propio agente; otra → `404`.

No existe ningún endpoint de edición o borrado de operaciones.

## 11. Comisiones y liquidaciones

```json
// GET /commissions/summary
{
  "currency": "XAF",
  "today": 8500,
  "this_week": 42300,
  "this_month": 185400,
  "all_time": 1250000,
  "pending_settlement": 185400,
  "by_type_this_month": [
    { "operation_type": "cash_in", "count": 210, "amount": 98000 },
    { "operation_type": "cash_out", "count": 150, "amount": 75400 },
    { "operation_type": "qr_payment", "count": 40, "amount": 12000 }
  ]
}
```

`GET /commissions?from&to&type&cursor` → comisiones por operación (referencia, base, comisión, estado `accrued/settled/reversed`).

```json
// GET /settlements
{
  "data": [
    {
      "id": "stl_…",
      "reference": "STL-2026-09-000123",
      "period": { "start": "2026-09-01", "end": "2026-09-30" },
      "volume": 38450000,
      "commissions": 185400,
      "deductions": 0,
      "net_amount": 185400,
      "currency": "XAF",
      "status": "scheduled",
      "scheduled_for": "2026-10-02",
      "method": "bank_account",
      "destination_masked": "****1234",
      "provider_reference": null
    }
  ],
  "next_cursor": null
}
```

## 12. Seguridad

| Método y ruta | Descripción | Requisitos |
|---|---|---|
| `GET /security/overview` | Último acceso, dispositivo, ubicación aproximada | — |
| `GET /security/devices` | Dispositivos (modelo, estado, último uso, ubicación aprox.) | — |
| `DELETE /security/devices/{id}` | Desconecta un dispositivo y revoca sus sesiones | PIN + firma |
| `GET /security/sessions` · `POST /security/sessions/revoke-others` | Sesiones activas / cerrar las demás | PIN |
| `GET /security/access-history` | Historial de accesos (cursor) | — |
| `POST /security/pin/change` | `{ "current_pin", "new_pin" }`; reglas: 6 dígitos, no secuencias/repeticiones triviales, distinto a los 3 últimos | Firma; revoca otras sesiones |
| `POST /security/biometrics` | Activa/desactiva; al activar registra la *biometric key* | PIN + firma |

## 13. Notificaciones

`GET /notifications?cursor` · `POST /notifications/{id}/read` · `POST /notifications/read-all` · `PUT /notifications/preferences` (no permite desactivar seguridad/cuenta) · `POST /push-tokens` (registrar token FCM/APNs del dispositivo).

## 14. Soporte

### POST /support/tickets

```json
// Request (Idempotency-Key)
{
  "category": "customer_not_credited",
  "transaction_reference": "BTX-00092832",
  "description": "El cliente dice que no recibió el depósito de las 10:15.",
  "attachments": ["upl_…"]
}
// 201
{
  "ticket": {
    "id": "tck_…",
    "reference": "TCK-000481",
    "status": "open",
    "category": "customer_not_credited",
    "created_at": "2026-09-26T09:50:00Z",
    "transaction_reference": "BTX-00092832"
  }
}
```

`GET /support/tickets` · `GET /support/tickets/{id}` (incluye mensajes, sin notas internas) · `POST /support/tickets/{id}/messages`. Validación: la operación relacionada debe ser del agente; descripción 10–2000 caracteres.

## 15. Solicitud de alta (pública)

`POST /onboarding/applications` → `{ phone, first_name, last_name, city, business_name, business_type, consent_version }` → `202` y OTP al teléfono para verificarlo. Crea el agente en `pending`. Protegido con rate limit y *captcha*/integridad de app.

## 16. Admin API (`/admin/v1`, resumen)

Todas requieren SSO + MFA, permiso específico (ver [06-seguridad.md §6](06-seguridad.md#6-rbac)) y generan audit log. Las acciones marcadas con ✳ son *maker-checker*: una persona propone y otra distinta aprueba.

| Ruta | Permiso |
|---|---|
| `GET /dashboard` | cualquiera de staff (datos según alcance) |
| `GET /agents`, `GET /agents/{id}` | `agents.read` |
| `POST /agents/{id}/review` · `/approve` ✳ · `/reject` | `agents.approve` |
| `POST /agents/{id}/activate` ✳ | `agents.activate` (distinto de quien aprobó) |
| `POST /agents/{id}/suspend` · `/block` · `/reactivate` · `/terminate` | `agents.suspend` / `agents.terminate` |
| `GET /kyc/queue`, `GET /kyc/{id}`, `GET /documents/{id}/view-url` (URL firmada 2 min) | `kyc.review` |
| `POST /kyc/{id}/decision` | `kyc.review` |
| `PUT /kyc/requirement-sets/{id}` | `kyc.config` |
| `POST /agents/{id}/limits` ✳ / `POST /limit-requests/{id}/approve` | `limits.request` / `limits.approve` |
| `GET /transactions`, `GET /transactions/{id}` | `transactions.read_all` |
| `POST /transactions/{id}/reversal-requests` ✳ | `transactions.reverse` |
| `GET /risk/cases`, `POST /risk/cases/{id}/decision` | `risk.cases.manage` |
| `PUT /risk/rules/{code}` (nueva versión, primero en `shadow`) | `risk.rules.manage` |
| `POST /commission-plans` ✳ / `POST /commission-plans/{id}/approve` | `commissions.config` / `commissions.approve` |
| `GET /settlements`, `POST /settlements/{id}/approve` ✳ | `settlements.manage` / `settlements.approve` |
| `GET /reconciliation/runs` | `reconciliation.read` |
| `GET /support/tickets`, `POST /support/tickets/{id}/messages` | `support.tickets.manage` |
| `POST /agents/{id}/devices/{deviceId}/revoke`, `POST /agents/{id}/sessions/revoke-all` | `devices.revoke` |
| `GET /audit-logs` | `audit.read` |

## 17. Internal API (contratos con BataPay Core y Ledger)

Solo red privada + mTLS + token de servicio. Versionadas y con clave de idempotencia obligatoria.

| Servicio | Endpoint | Uso |
|---|---|---|
| Core | `POST /internal/v1/customers/resolve` `{phone | customer_token}` → `{customer_ref, masked, can_receive, can_send}` | Cash-in |
| Core | `POST /internal/v1/deposit-requests` `{agent_ref, customer_ref, amount, expires_at}` → `{deposit_request_id}` | Pedir confirmación al cliente |
| Core → Agent | Evento `core.deposit_request.confirmed` / `.rejected` | Resultado de la confirmación |
| Core | `POST /internal/v1/withdrawal-requests/resolve` `{code}` | Cash-out, consulta |
| Core | `POST /internal/v1/withdrawal-requests/{id}/claim` `{agent_ref, agent_transaction_id}` | Reclamo atómico (un solo uso) |
| Core → Agent | `POST /internal/v1/qr/resolve` `{payload}` → `{qr_id, kind, agent_code, merchant_name, amount, currency, expires_at}` | El cliente escaneó un QR del agente en BataPay |
| Core → Agent | Evento `qr_payment.authorized` `{payment_request_id, qr_id, customer_ref, customer_masked, amount, currency}` → `{result: completed \| processing \| rejected, reason?}` | El cliente aprobó el pago con su PIN y Core retuvo el importe; el Agent Backend lo contabiliza capturando esa retención. Con `rejected` Core libera la retención |
| Agent → Core | `POST /internal/v1/qr-payments/{id}/settle` `{outcome: completed \| failed}` | Resultado final del pago (también tras reconciliar) |
| Ledger | `POST /internal/v1/holds` · `POST /internal/v1/holds/{id}/release` | Reservas |
| Ledger | `POST /internal/v1/transactions` `{reference, idempotency_key, kind, entries[], capture_holds[], external_ref}` | Contabilizar |
| Ledger | `GET /internal/v1/transactions/by-key/{source}/{key}` | Reconciliación tras timeout |
| Ledger | `GET /internal/v1/accounts/{id}/balance` | Saldo autoritativo |
| Ledger → Agent | Evento `ledger.account.balance_changed` `{account_id, balance, held, version}` | Proyección `agent_balances` |

Los contratos concretos con el core existente de BataPay **(por confirmar)** cuando se revise su API actual.

## 18. OpenAPI

La especificación OpenAPI 3.1 se genera desde los esquemas zod del backend (`/agent/v1/openapi.json`, solo en entornos no productivos) y se valida en CI contra ejemplos de este documento.
