# 06 · Seguridad, RBAC, auditoría y prevención de fraude

## 1. Modelo de amenazas (resumen)

| Amenaza | Ejemplo | Controles |
|---|---|---|
| Robo del teléfono del agente | Alguien intenta operar con el móvil | PIN/biometría en cada operación, bloqueo por intentos, cierre remoto de sesión, claves en hardware |
| Robo de credenciales / SIM swap | Atacante con PIN y SIM duplicada | Nuevo dispositivo ⇒ OTP + enfriamiento con límites reducidos + aviso a otros dispositivos; consulta de SIM swap con el operador **(por confirmar)** |
| App modificada / emulador | Saltar validaciones del cliente | Todo se valida en servidor; Play Integrity / App Attest; firma de dispositivo |
| Repetición de peticiones | Reenviar un cash-in capturado | TLS, firma con timestamp y nonce, idempotencia |
| QR falso o reutilizado | QR impreso por un estafador | QR solo con id opaco firmado; estado y caducidad en servidor; un solo uso |
| Agente deshonesto | Operaciones ficticias, fraccionamiento, cash-in/cash-out circulares | Reglas de riesgo, límites, confirmación del cliente, revisión, auditoría inmutable |
| Staff interno malicioso | Aprobarse límites o reversos | *Maker-checker*, RBAC mínimo, audit log encadenado, sin acceso directo a BD |
| Enumeración | Adivinar teléfonos o códigos de retiro | Mensajes neutros, rate limits, bloqueo de función tras fallos |
| Fuga de base de datos | Robo de un backup | Cifrado en reposo, PII cifrada en aplicación, PIN con argon2id + *pepper* en HSM, refresh tokens hasheados |
| Fuga en logs | PIN o teléfono en logs | Lista de campos prohibidos y enmascarado en el logger; revisión en CI |

## 2. Autenticación del agente

### Factores

| Factor | Tipo | Almacenamiento |
|---|---|---|
| Número de teléfono | Identificador | `agents.phone_e164` |
| PIN de 6 dígitos | Algo que sabe | `argon2id(HMAC_pepper(pin))` — el *pepper* es una clave en KMS/HSM, nunca en la BD |
| OTP por SMS (o email como respaldo) | Algo que tiene | Solo HMAC del código; 5 min; 3 intentos; un uso |
| Dispositivo registrado | Algo que tiene | Clave pública ES256 en `agent_devices`; privada en Keystore/Secure Enclave |
| Biometría | Algo que es | **Nunca sale del teléfono**: solo desbloquea la *biometric key*; el servidor verifica la firma |

Por qué *pepper* en HSM: un PIN de 6 dígitos tiene solo 1.000.000 combinaciones. Si alguien roba la base de datos, argon2id por sí solo no impide probarlas todas. Con el *pepper* fuera de la base de datos, el robo de la BD no basta.

### Cuándo se pide qué

| Situación | Factores |
|---|---|
| Login en dispositivo de confianza | PIN **o** biometría |
| Login en dispositivo nuevo | PIN + OTP → registro de claves del dispositivo |
| Login con riesgo alto (IP/país inusual, muchos fallos recientes) | PIN + OTP |
| Cada operación financiera | Firma del dispositivo + (PIN **o** biometría) |
| Cambiar PIN, desconectar dispositivos, activar biometría | PIN + firma |
| Recuperación de cuenta | OTP + verificación de identidad + revisión humana (ver flujo 14) |

### Sesiones y tokens

| Elemento | Valor inicial (configurable) |
|---|---|
| Access token | JWT ES256, 10 min, `aud=bata-services-agent` |
| Refresh token | Opaco 256 bits, rotación en cada uso, hash SHA-256 en BD |
| Inactividad | 7 días (el refresh deja de valer) |
| Vida absoluta de la sesión | 30 días |
| Bloqueo de la app | Tras 2 min en segundo plano pide PIN/biometría para volver |
| Dispositivos de confianza simultáneos | 1 por defecto (configurable por nivel) |
| Reutilización de un refresh ya rotado | Revoca toda la familia y avisa al agente |

**Cierre remoto**: desde "Dispositivos" (agente) o desde el Admin Panel (`devices.revoke`). Revoca las sesiones en BD y añade el `sid` a una lista de revocación en Redis hasta que caduque su access token (máx. 10 min), de modo que el efecto es inmediato.

**Suspensión del agente**: revoca todas las sesiones y bloquea operaciones al instante (el estado se comprueba en cada petición financiera, no solo en el token).

### Bloqueos

| Evento | Consecuencia |
|---|---|
| 5 PIN fallidos | Bloqueo 15 min (`ACCOUNT_LOCKED`) |
| Bloqueos siguientes en 24 h | 30 min, 60 min… |
| 3.er bloqueo en 24 h | Estado `blocked`; solo recuperación |
| 3 OTP fallidos | Desafío invalidado; 10/h por agente |
| 5 códigos de retiro/QR inválidos en 10 min | Función de escaneo bloqueada 15 min + señal de riesgo |

Todos los contadores se guardan en servidor (no se pueden reiniciar reinstalando la app).

## 3. Registro de dispositivo (device binding)

1. Tras PIN + OTP correctos, la app genera dos pares de claves en hardware: *device key* (sin interacción) y, si el agente activa la biometría, *biometric key* (requiere huella/cara para firmar).
2. Envía las claves públicas y el token de integridad de la app.
3. El servidor registra el dispositivo como `trusted`, aplica `cooldown_until` (p. ej. 24 h de límites reducidos) y avisa por push y SMS al agente.
4. Si el número de dispositivos de confianza supera el máximo, el más antiguo se revoca (o se exige elegir cuál, configurable).
5. Desde ese momento cada operación financiera va firmada.

Detección de dispositivo nuevo: `installation_id` + clave pública distintos a los registrados. Una reinstalación de la app cuenta como dispositivo nuevo (las claves se pierden), lo cual es intencionado.

## 4. Seguridad de la app móvil

- Sin secretos de API en la app. La app solo conoce la URL pública y la clave pública para verificar firmas de QR.
- Refresh token en `expo-secure-store`; nada sensible en AsyncStorage.
- Caché offline cifrada con una clave guardada en Keystore/Keychain; se borra al cerrar sesión o al revocar el dispositivo.
- Captura de pantalla bloqueada en pantallas de PIN, OTP y KYC (Android `FLAG_SECURE`; iOS: ocultar al pasar a segundo plano). ✅ Implementado con `expo-screen-capture`.
- Bloqueo de la app tras 3 minutos en segundo plano y en cada arranque que reanuda una sesión: PIN o biometría verificados por el servidor (`POST /security/unlock`); los PIN fallidos cuentan para el bloqueo de la cuenta. ✅
- *Certificate pinning* (con pin de respaldo y rotación planificada) para la API.
- Detección de root/jailbreak y emulador (`expo-device`), enviada al iniciar sesión y al volver a primer plano. **Política decidida**: el teléfono puede consultar saldo e historial, pero no operar (`403 DEVICE_COMPROMISED`). Es una señal que la app declara de sí misma; Play Integrity / App Attest, verificados en el servidor, son la comprobación fuerte pendiente.
- Builds de producción sin logs de depuración ni menús de desarrollo; ofuscación de JS (Hermes bytecode) y de código nativo.
- Versión mínima de app controlada desde el servidor (`426 APP_UPDATE_REQUIRED`).
- Actualizaciones OTA firmadas y solo para cambios de UI; los cambios de seguridad van por tienda.

## 5. Seguridad del backend

- API Gateway con WAF, TLS 1.2+ (preferente 1.3), HSTS, límites de tamaño de petición.
- Validación de todos los datos de entrada con esquemas (zod); rechazo de campos desconocidos.
- Consultas SQL parametrizadas (Kysely); sin SQL construido con texto del usuario.
- **Autorización a nivel de objeto**: toda consulta del Agent API lleva `WHERE agent_id = :agente_del_token`; los ids de otros agentes devuelven 404.
- Secretos en un gestor de secretos; claves de firma en KMS/HSM con rotación.
- Dependencias con escaneo continuo (SCA), análisis estático (SAST), escaneo de imágenes de contenedor, y pentest externo antes de producción y anualmente.
- Separación de entornos (dev / staging / prod) con cuentas cloud distintas; **nunca** datos reales en dev.
- Acceso de ingenieros a producción solo mediante *break-glass* aprobado, con grabación y audit log.

## 6. RBAC

Roles: `AGENT`, `SUPERVISOR`, `ADMIN`, `COMPLIANCE`, `SUPPORT`, `FINANCE`. Los permisos están en `agent.permissions` / `agent.role_permissions` ([03_roles…](../db/03_roles_and_reference_data.sql)).

- La app Bata Services solo acepta tokens con rol `AGENT` y solo expone rutas `self:*`.
- Los roles de staff viven en el Admin Panel, autenticados por el IdP corporativo. Un mismo humano **no** puede ser a la vez agente y staff con acceso sobre sí mismo (comprobación en servicio: `staff.idp_subject` ≠ identidad del agente afectado; y *maker-checker*).
- `SUPERVISOR` tiene alcance limitado (`scope.regions`) a los agentes de su zona.

| Permiso | AGENT | SUPERVISOR | ADMIN | COMPLIANCE | SUPPORT | FINANCE |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Operar (cash-in/out, QR) — solo sobre sí mismo | ✅ | | | | | |
| Ver sus operaciones, comisiones, liquidaciones | ✅ | | | | | |
| Ver agentes | | ✅ (su zona) | ✅ | ✅ | ✅ | ✅ |
| Aprobar agente | | | | ✅ | | |
| Activar agente (≠ quien aprobó) | | | ✅ | | | |
| Suspender / bloquear | | | ✅ | ✅ | | |
| Dar de baja | | | ✅ | | | |
| Revisar KYC y ver documentos | | | | ✅ | | |
| Configurar requisitos KYC | | | | ✅ | | |
| Solicitar cambio de límites | | ✅ | ✅ | | | |
| Aprobar cambio de límites (≠ solicitante) | | | ✅ | | | |
| Ver todas las operaciones | | ✅ (su zona) | ✅ | ✅ | ✅ | ✅ |
| Solicitar/aprobar reversos (dos personas) | | | | | | ✅ |
| Casos y reglas de riesgo | | | | ✅ | | |
| Planes de comisión (dos personas) | | | | | | ✅ |
| Liquidaciones (preparar / aprobar, dos personas) | | | | | | ✅ |
| Conciliación | | | | | | ✅ |
| Incidencias | | ✅ | ✅ | | ✅ | |
| Revocar dispositivos/sesiones de un agente | | | ✅ | ✅ | | |
| Leer audit logs | | | ✅ | ✅ | | |

Nadie tiene: acceso directo a la BD de producción, escritura en el ledger fuera de los flujos definidos, edición de operaciones completadas, borrado de audit logs, capacidad de aprobarse a sí mismo.

## 7. Audit logs

Tabla `agent.agent_audit_logs` (ver [02_agent.sql](../db/02_agent.sql)).

Ejemplo:

```json
{
  "occurred_at": "2026-09-26T09:42:03.118Z",
  "stream": "agent:6f1c…",
  "actor_type": "agent",
  "actor_id": "AG-000124",
  "action": "CASH_OUT",
  "resource_type": "transaction",
  "resource_id": "BTX-00928381",
  "result": "success",
  "device_id": "dev_…",
  "ip": "41.202.x.x",
  "request_id": "req_01J8…",
  "metadata": { "amount": 50000, "currency": "XAF", "risk_level": "low" },
  "prev_hash": "a41f…",
  "hash": "9c07…"
}
```

Acciones auditadas (mínimo): LOGIN (éxito/fallo), LOGOUT, OTP_SENT/FAILED, DEVICE_TRUSTED/REVOKED, SESSION_REVOKED, PIN_CHANGED, BIOMETRICS_TOGGLED, CASH_IN, CASH_OUT, QR_CREATED, QR_SCANNED, OPERATION_CANCELLED, KYC_DOCUMENT_UPLOADED, KYC_SUBMITTED, TICKET_CREATED, CASH_DECLARED; y en staff: AGENT_APPROVE/REJECT/ACTIVATE/SUSPEND/BLOCK/TERMINATE, KYC_DECISION, DOCUMENT_VIEWED, LIMIT_REQUESTED/APPROVED, REVERSAL_REQUESTED/APPROVED, COMMISSION_PLAN_*, SETTLEMENT_*, RISK_RULE_CHANGED, RISK_CASE_DECISION, AUDIT_LOG_VIEWED.

Garantías:
- Solo inserción (trigger + permisos de BD).
- Cadena de hashes por *stream*: modificar o borrar una fila rompe la cadena (verificación diaria).
- Copia diaria a almacenamiento WORM con *object lock*.
- Se escribe en la **misma transacción** que la acción (si la acción se confirma, su log existe).
- Nunca contiene PIN, OTP, tokens, imágenes ni documentos completos.

## 8. Prevención de fraude

### Arquitectura

```
Petición ─▶ Motor de riesgo síncrono (≤ 100 ms)  ─▶ decisión: allow | step_up | review | block
              │  reglas configurables (fraud_rules)
              │  contadores en Redis (velocidad)
              │  perfil del agente (medias, horario, zona)
              │  hooks de compliance (screening, AML) ← proveedor/reglas POR CONFIRMAR
              ▼
          risk_assessments (señales, puntuación, versión de reglas)
              │
              ▼
Evento ─▶ Análisis asíncrono (patrones en ventanas largas) ─▶ fraud_cases ─▶ revisión COMPLIANCE
```

- Puntuación 0–100 → **LOW** (< 40), **MEDIUM** (40–69), **HIGH** (≥ 70). Umbrales configurables.
- LOW → `allow`. MEDIUM → `step_up` (biometría/OTP) o `allow` con monitorización. HIGH → `review` (la operación queda en `processing` con el hold activo hasta que COMPLIANCE decida, con un plazo máximo) o `block`.
- Cada regla nueva entra primero en modo **shadow** (se evalúa y registra, no decide) para medir falsos positivos.
- El agente nunca ve qué regla se disparó; solo "La operación está en revisión".

### Señales iniciales (parámetros por confirmar con datos reales)

| Señal | Ejemplo de regla |
|---|---|
| Velocidad del agente | > N operaciones en 5 min o > X XAF en 1 h |
| Velocidad por cliente | El mismo cliente con > N operaciones en varios agentes en 1 h |
| Pares agente-cliente | Muchas operaciones entre el mismo agente y cliente |
| Importe inusual | Importe > p99 del histórico del agente, o importes redondos repetidos |
| Fraccionamiento | Varias operaciones justo por debajo de un límite en poco tiempo |
| Circularidad | Cash-in seguido de cash-out del mismo cliente en minutos |
| Dispositivo | Dispositivo nuevo (< 24 h), root/emulador, cambio de dispositivo frecuente |
| Red/ubicación | IP o país inusual respecto a la zona del establecimiento |
| Horario | Operaciones fuera del horario declarado del negocio |
| Intentos repetidos | PIN/OTP fallidos, códigos QR/retiro inválidos |
| Duplicados | Mismo agente, cliente e importe en < N min |
| Comportamiento | Desviación fuerte del patrón habitual del agente |

### Integración de compliance

El motor expone un punto de extensión (`ComplianceHook`) llamado en alta de agente, en operaciones y periódicamente, para integrar screening de listas, reglas AML o reportes regulatorios **cuando se definan con el proveedor regulado y la normativa aplicable (por confirmar)**. El resultado se guarda en `risk_assessments.compliance_hook`. No se inventan umbrales legales.

## 9. KYC: seguridad de los documentos

- Subida directa al almacenamiento de objetos con URL firmada de 5 min, limitada a tipo y tamaño.
- Antimalware y validación del tipo real del fichero antes de aceptarlo.
- Cifrado con KMS; bucket privado, sin listado, acceso solo por el servicio.
- Visualización solo por COMPLIANCE con URL de 2 min y marca de agua con el usuario; cada vista → audit log `DOCUMENT_VIEWED`.
- El agente ve estados, no vuelve a descargar las imágenes.
- Retención y borrado según política **(por confirmar)**.

## 10. Privacidad (minimización)

- El agente ve del cliente solo `****4821` (y nombre abreviado si se confirma que es necesario para evitar errores).
- Las respuestas del Agent API nunca incluyen: teléfono completo del cliente, saldo del cliente, historial del cliente, documentos, ids internos del cliente (se usan tokens de un solo uso).
- Logs y trazas con enmascarado automático de teléfonos, documentos y cualquier campo marcado como sensible.
- Datos del agente: solo los exigidos por la configuración KYC vigente.
