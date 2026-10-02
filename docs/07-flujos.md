# 07 · Flujos de usuario

Convenciones: **A** = agente (app Velynt Services) · **S** = Agent Backend · **C** = Velynt Core · **L** = Ledger · **Cl** = cliente (app Velynt) · **BO** = back-office (Admin Panel).

## 1. Registro de agente

```
Solicitud ─▶ Registro ─▶ KYC ─▶ Revisión ─▶ Aprobación ─▶ Agent ID ─▶ Activación ─▶ Acceso
 pending     pending    pending  under_review  approved     AG-xxxxxx     active
```

1. A abre la app → "¿Quieres ser agente?".
2. Pantalla de información: qué implica ser agente, requisitos generales **(según país, por confirmar)**, consentimiento de tratamiento de datos (versión guardada).
3. Formulario corto: teléfono, nombre, apellidos, ciudad, nombre y tipo de negocio.
4. OTP al teléfono para verificarlo → S crea `agents` en `pending` + audit log.
5. S crea el PIN inicial: A elige PIN (dos veces). Se guarda argon2id + *pepper*.
6. La app pasa al stack **Onboarding**: línea de tiempo con el paso actual y "Completa tu KYC".
7. Una solicitud rechazada puede volver a presentarse tras el periodo configurado.

Reglas: una solicitud por teléfono; nadie puede aprobarse a sí mismo; el agente no ve ni usa operaciones hasta `active`.

## 2. KYC

1. S carga el conjunto de requisitos activo para (país, nivel) → `GET /kyc`.
2. A completa por pasos, guardando progreso:
   1. **Datos personales** (nombre, apellidos, fecha de nacimiento, nacionalidad, email, dirección, ciudad, país).
   2. **Documento de identidad**: elige tipo aceptado (DNI, pasaporte, permiso de residencia cuando corresponda) → captura guiada anverso/reverso → comprobación de calidad en el dispositivo → subida.
   3. **Selfie** (si el conjunto lo exige): captura con indicaciones; prueba de vida según proveedor **(por confirmar)**.
   4. **Comprobante de domicilio** (si se exige).
   5. **Negocio**: nombre comercial, tipo, dirección, ciudad, horario, teléfono, datos fiscales si se exigen.
   6. **Liquidación**: método, titular, cuenta (se muestra enmascarada).
3. "Revisa y envía" → `POST /kyc/submit` → `agent_kyc.status = submitted`; `agents.status: pending → under_review`.
4. Si hay proveedor KYC: S envía el expediente, guarda `provider_ref` y espera su webhook firmado.
5. Notificación: "Hemos recibido tu documentación. Te avisaremos del resultado."

Estados por requisito: missing → uploaded → verified | rejected (con motivo y botón "Volver a enviar").

## 3. Aprobación (back-office)

1. COMPLIANCE ve la cola de KYC (`under_review`), ordenada por antigüedad.
2. Revisa datos, documentos (URL de 2 min, audit log por vista), resultado del proveedor, duplicados (mismo documento por HMAC, mismo teléfono/dispositivo) y screening **(por confirmar)**.
3. Decide:
   - **Rechazar** → `rejected` con motivo codificado → notificación al solicitante.
   - **Pedir más información** → `under_review → pending` con los requisitos marcados.
   - **Aprobar** → `approved`, se asigna `agent_code` (AG-000001), se asigna nivel inicial.
4. ADMIN (persona distinta) **activa**: comprueba formación/contrato **(requisitos por confirmar)**, crea las cuentas del agente en el ledger (float y comisiones) y el QR estático → `active`.
5. Notificación: "¡Tu cuenta de agente está activa! Tu Agent ID es AG-000001."
6. En el siguiente arranque, `GET /me` devuelve `active` y la app muestra el dashboard.

## 4. Login

```
Teléfono ─▶ ¿dispositivo de confianza?
              ├─ sí ─▶ biometría (o PIN) ─▶ riesgo bajo ─▶ Dashboard
              │                           └─ riesgo alto ─▶ OTP ─▶ Dashboard
              └─ no ─▶ PIN ─▶ OTP ─▶ registrar claves ─▶ aviso "nuevo dispositivo" ─▶ Dashboard (límites reducidos 24 h)
```

1. A introduce teléfono (recordado en el dispositivo, enmascarado).
2. PIN o biometría.
3. S verifica credenciales, estado del agente, integridad de la app, riesgo.
4. Si todo es correcto → tokens; `agent_access_events.login_success`; audit log.
5. Errores: PIN incorrecto (intentos restantes), bloqueo temporal, cuenta suspendida (pantalla "Cuenta restringida").

## 5. Cash-in (depósito)

```
A: DEPOSITAR ─▶ cliente (QR o teléfono) ─▶ importe ─▶ confirmar (PIN/biometría)
S: valida agente, límites, cliente (C), duplicados, riesgo ─▶ hold en float (L) ─▶ solicitud a C
Cl: notificación "¿Confirmas un depósito de 100.000 XAF del agente AG-000001?" ─▶ PIN ─▶ confirma
C ─▶ S: confirmado ─▶ S ─▶ L: asiento (float −, cliente +, comisión) capturando el hold
S: completed ─▶ push a A y Cl ─▶ A ve "DEPÓSITO COMPLETADO" ─▶ guarda el efectivo
```

Paso a paso:
1. El cliente entrega el efectivo **o lo muestra** (recomendación de UX: contar el efectivo antes de confirmar).
2. A pulsa DEPOSITAR y escanea el QR personal del cliente (o introduce su teléfono) → ve `****4821`.
3. A introduce 100.000 → la app muestra límite disponible y comisión.
4. A confirma con PIN/biometría → `POST /cash-in` con `Idempotency-Key`.
5. S valida (ver [05-api.md §7](05-api.md#7-cash-in)) → hold → estado `pending` → pide confirmación a C.
6. Cl confirma en su app. Si el cliente no tiene la app o smartphone: método alternativo **(por confirmar)**.
7. S contabiliza en L (una transacción) → `processing → completed` → notificaciones.
8. A ve el resultado y el recibo.

Casos alternativos:
- Cliente rechaza → `failed` (`customer_rejected`), hold liberado.
- Caduca (3 min) → `cancelled` (`expired`), hold liberado.
- A cancela antes de la confirmación → `cancelled`.
- Riesgo alto → `processing` con "La operación está en revisión"; el hold se mantiene hasta la decisión (plazo máximo configurable, después se libera y la operación falla).
- Corte de red → "Estamos verificando la operación"; al volver, `GET /transactions/by-key/{key}`.

## 6. Cash-out (retiro)

```
Cl: en Velynt "Retirar en agente" ─▶ importe ─▶ PIN ─▶ C: hold en cartera del cliente ─▶ QR + código (10 min)
A: RETIRAR ─▶ escanear QR / código ─▶ S ─▶ C: resolve ─▶ A ve importe y ****4821 ─▶ confirmar (PIN/biometría)
S: valida agente, límites, riesgo ─▶ C: claim (un solo uso) ─▶ L: asiento (cliente −, float +, comisión) capturando hold
S: completed ─▶ A: "RETIRO COMPLETADO · Entrega 50.000 XAF" ─▶ entrega efectivo
```

Paso a paso:
1. El cliente genera la solicitud de retiro en su app (autoriza con su PIN). Validez y formato del código **(configurables)**.
2. A pulsa RETIRAR y escanea (o teclea el código).
3. `POST /cash-out/resolve` → importe, `****4821`, caducidad. **El importe no es editable.**
4. A confirma → `POST /cash-out`.
5. S: comprueba límites y riesgo; C reclama la solicitud de forma atómica; L contabiliza capturando el hold del cliente.
6. Resultado "RETIRO COMPLETADO · 50.000 XAF · BTX-00092831 · 26/09/2026 10:42" y "Entrega el efectivo".
7. **Regla de oro en la UI**: mientras el estado no sea `completed`, la app muestra "No entregues el efectivo todavía".

Casos alternativos: código caducado/usado/inválido (mensajes del catálogo); saldo del cliente insuficiente (lo detecta C al crear la solicitud); `processing` por timeout → reconciliación automática, la app espera; riesgo alto → revisión.

## 7. QR

**Escanear** (botón central): la app lee el QR → comprueba formato y firma localmente → `POST /qr/scan` → S decide la acción:
- `W` (retiro) → pantalla de revisión de cash-out.
- `C` (cliente) → cash-in con ese cliente preseleccionado.
- Otro/ inválido → "No reconocemos este código".

**Cobrar**: A introduce importe → `POST /qr/create` (`collect`, un uso, 5 min) → muestra QR grande + cuenta atrás → Cl escanea con Velynt y paga con su PIN → C/L contabilizan → S marca el QR `used` y la operación `completed` → la pantalla de A cambia a "Pagado ✔ 25.000 XAF".

**Mi QR**: QR estático del agente (identifica al agente; útil para que un cliente inicie una operación hacia el agente). Nunca lleva importe.

## 8. Historial

1. Tab "Operaciones" → por defecto **Hoy**.
2. Chips de periodo y filtros de tipo/estado; totales del periodo arriba.
3. Scroll infinito (cursor). Sin conexión: lo cacheado con marca de hora.
4. Toque → detalle con línea temporal de estados → recibo / compartir / reportar problema.

## 9. Comisiones

1. Tab "Comisiones" → tarjetas Hoy / Semana / Mes / Total histórico (desde `GET /commissions/summary`).
2. Desglose por tipo de operación.
3. "Ver detalle" → lista de comisiones por operación con estado (`accrued`, `settled`, `reversed`).
4. Nota visible: cómo y cuándo se pagan (según configuración).

## 10. Liquidación

Sistema:
1. Al cierre del periodo configurado **(semanal/mensual, por confirmar)**, un job agrupa las comisiones `accrued` del agente → crea `agent_settlements` en `pending` y marca las comisiones `in_settlement`.
2. FINANCE revisa y aprueba (*maker-checker*) → `scheduled`.
3. En la fecha: `processing` → pago (al float: asiento inmediato; a banco: orden al proveedor **por confirmar**).
4. Confirmación → `completed`, comisiones `settled`, notificación "Liquidación completada: 185.400 XAF".
5. Fallo → `failed` con motivo, comisiones vuelven a `accrued`, notificación y caso para FINANCE.

Agente: Perfil → Liquidaciones → lista y detalle (periodo, volumen, comisiones, importe, fecha, método, referencia).

## 11. Incidencia

1. Desde el detalle de una operación ("Reportar problema") o desde Ayuda.
2. Elige categoría → la operación se vincula automáticamente si viene del detalle.
3. Describe el problema (plantillas de ayuda por categoría) y adjunta captura opcional.
4. `POST /support/tickets` → "Incidencia TCK-000481 creada. Te responderemos aquí."
5. SUPPORT responde en el Admin Panel → notificación "Nueva respuesta en TCK-000481".
6. Estados: open → in_progress → waiting_agent → resolved → closed.
7. Si la incidencia exige un reverso, SUPPORT lo solicita a FINANCE (el agente no puede).

## 12. Bloqueo de cuenta

Automático (seguridad):
1. 5 PIN fallidos → `ACCOUNT_LOCKED` 15 min; pantalla con cuenta atrás y "¿Olvidaste tu PIN?".
2. Bloqueos repetidos → `blocked` → solo recuperación.

Administrativo (riesgo/compliance):
1. BO suspende o bloquea con motivo → S revoca sesiones y bloquea operaciones al instante → operaciones `pending` se cancelan y liberan holds.
2. Notificación "Tu cuenta ha sido suspendida. Contacta con soporte."
3. La app muestra "Cuenta restringida": puede ver historial, comisiones y liquidaciones, y abrir incidencias; no puede operar.
4. Reactivación solo desde BO (`suspended → active`), con audit log.

## 13. Cambio de dispositivo

1. A instala la app en el teléfono nuevo → teléfono + PIN.
2. S detecta dispositivo nuevo → OTP por SMS.
3. OTP correcto → registro de claves → si supera el máximo de dispositivos, el anterior se revoca (o A elige).
4. Aviso inmediato al dispositivo anterior (push) y SMS: "Se ha conectado un nuevo dispositivo. Si no fuiste tú, llama a soporte."
5. Periodo de enfriamiento: límites reducidos durante 24 h (configurable).
6. Si A perdió el teléfono anterior y no recuerda el PIN → flujo 14.

## 14. Recuperación de cuenta

Casos: PIN olvidado, cuenta `blocked`, teléfono perdido.

1. "¿Problemas para entrar?" → teléfono → `POST /auth/recovery/start` (respuesta neutra siempre).
2. OTP al teléfono registrado. Si el agente ya no controla ese número (SIM perdida) → proceso presencial o con soporte **(por confirmar)**.
3. Verificación de identidad adicional: selfie comparada con el KYC por el proveedor **(por confirmar)** y/o preguntas sobre datos no públicos (último importe liquidado, nombre del negocio).
4. Si el riesgo es alto o la cuenta estaba `blocked` → revisión humana en BO (COMPLIANCE/SUPPORT).
5. Aprobado → A crea un PIN nuevo → se revocan **todos** los dispositivos y sesiones anteriores → registro del dispositivo actual → enfriamiento.
6. Notificaciones y audit log en cada paso (`recovery_started`, `recovery_completed`).
