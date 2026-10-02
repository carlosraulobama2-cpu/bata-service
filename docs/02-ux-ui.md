# 02 · UX/UI, pantallas y navegación

## 1. Principios

1. **Tres acciones siempre a mano**: DEPOSITAR, RETIRAR y QR están en el inicio y en la barra inferior. Nunca a más de un toque.
2. **Pocos pasos**: una operación normal son 3 pantallas: datos → confirmar → resultado.
3. **Números grandes y claros**: el importe es lo más visible de cada pantalla. Separador de miles con punto (`2.450.000 XAF`), sin decimales para XAF.
4. **Estados inequívocos**: cada operación muestra su estado con color **y** texto **y** icono (no solo color).
5. **Nada de gráficos decorativos**: cifras y listas. Un único minigráfico opcional en comisiones.
6. **Gama baja primero**: pantallas de 5", 2 GB de RAM, Android 8+, conexión 3G inestable.
7. **El agente nunca duda de si puede entregar el efectivo**: la pantalla de resultado lo dice explícitamente.

## 2. Sistema de diseño

### Colores (tokens)

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `bg` | `#F6F7F9` | `#0F1216` | Fondo |
| `surface` | `#FFFFFF` | `#181C22` | Tarjetas |
| `text` | `#111418` | `#F2F4F7` | Texto principal |
| `text-muted` | `#5B6470` | `#A3ACB9` | Texto secundario |
| `primary` | `#0B5FFF` | `#5B8CFF` | Acciones principales |
| `on-primary` | `#FFFFFF` | `#0F1216` | Texto sobre primario |
| `success` | `#12805C` | `#3CCB8F` | Completada |
| `warning` | `#A15C00` | `#F5B544` | Pendiente / en verificación |
| `danger` | `#C4271B` | `#FF6B5E` | Fallida / bloqueada |
| `info` | `#1F6FEB` | `#79A8FF` | Información |
| `border` | `#E3E6EA` | `#2A3038` | Separadores |

Contraste mínimo 4,5:1 en texto (WCAG AA). La identidad de marca definitiva de VELYNT SERVICES **(por confirmar)**; los tokens permiten cambiarla sin tocar componentes.

### Tipografía y tamaños

- Fuente del sistema (Roboto / SF): carga instantánea y buena legibilidad en gama baja.
- Escala: 32 (importe principal) · 24 (títulos) · 18 (importes en listas) · 16 (texto) · 14 (secundario). Respeta el tamaño de fuente del sistema.
- Cifras con **dígitos tabulares** para que las columnas de importes se alineen.
- **Botones principales**: alto 56 dp, ancho completo. Área táctil mínima 48 dp.
- Espaciado en múltiplos de 4 dp.

### Componentes base

`AmountDisplay`, `AmountInput` (teclado numérico propio, sin decimales en XAF), `BigActionButton`, `StatusBadge`, `OperationRow`, `MaskedCustomer`, `PinPad`, `OtpInput`, `QrScanner`, `QrDisplay`, `ReceiptCard`, `Banner` (offline / aviso), `EmptyState`, `ErrorState`, `ConfirmSheet`, `SectionList`, `Skeleton`.

### Rendimiento en gama baja

- Listas virtualizadas (`FlashList` o `FlatList` bien configurada), páginas de 20 elementos.
- Sin animaciones pesadas; transiciones ≤ 200 ms; respeta "reducir movimiento".
- Imágenes: solo iconos vectoriales; KYC se comprime en el dispositivo antes de subir (≤ 1,5 MB por foto, calidad por confirmar con el proveedor KYC).
- Arranque en frío objetivo < 3 s en un Android de gama baja de referencia.
- Tamaño del APK vigilado en CI.

### Idiomas

- Español por defecto; todas las cadenas en archivos `locales/es/*.json` con claves (`cashout.success.title`).
- Formatos de fecha/número por `Intl` según el idioma (`26/09/2026 10:42`, `2.450.000 XAF`).
- Idiomas adicionales (francés, inglés, lenguas locales): **(por confirmar)**. La UI no debe tener textos pegados en el código.

## 3. Navegación

```
(sin sesión)                      (con sesión, agente ACTIVE)
Stack "Auth"                      Tabs inferiores
├─ Bienvenida                     ├─ Inicio ─────────── Dashboard
├─ Login (teléfono + PIN)         ├─ Operaciones ────── Historial → Detalle → Recibo
├─ OTP                            ├─ [ QR ] (botón central) → Escanear / Mi QR / Cobrar
├─ Nuevo dispositivo              ├─ Comisiones ─────── Resumen → Liquidaciones → Detalle
├─ Recuperar cuenta               └─ Perfil ─────────── Mi perfil y ajustes
└─ Solicitar ser agente
                                  Modales de operación (pantalla completa, por encima de las tabs)
(agente no activo)                ├─ Depositar (cash-in)
Stack "Onboarding"                ├─ Retirar (cash-out)
├─ Estado de la solicitud         └─ Cobrar (QR de cobro)
├─ KYC (pasos)
└─ Soporte                        Stack desde Perfil
                                  ├─ Información personal / negocio
(agente suspendido/bloqueado)     ├─ KYC y documentos
Pantalla "Cuenta restringida"     ├─ Límites
+ Soporte                         ├─ Seguridad → Dispositivos / Sesiones / Accesos / PIN
                                  ├─ Notificaciones
                                  ├─ Liquidaciones
                                  └─ Ayuda → Nueva incidencia / Mis incidencias
```

El servidor decide qué stack se muestra según el `status` del agente en `GET /agent/v1/me`. La app no guarda el estado como fuente de verdad.

## 4. Pantallas

### 4.1 Bienvenida / Login

```
┌──────────────────────────────┐
│         VELYNT SERVICES         │
│  Accede a tu cuenta de agente │
│                               │
│  Número de teléfono           │
│  [ +240 | 222 000 001      ]  │
│                               │
│  [      CONTINUAR       ]     │
│                               │
│  ¿Quieres ser agente?         │
│  ¿Problemas para entrar?      │
└──────────────────────────────┘
```
- Siguiente paso: **PIN** (teclado propio, 6 dígitos, sin mostrar dígitos). En un dispositivo de confianza con biometría activada, aparece primero la biometría con opción "Usar PIN".
- El email es opcional y solo sirve como canal de recuperación.
- Mensajes neutros: "Teléfono o PIN incorrectos" (no revela si el número existe).

### 4.2 OTP

"Hemos enviado un código a ****0001". 6 casillas, autocompletado desde SMS en Android, reenvío tras 60 s, "Quedan 2 intentos".

### 4.3 Nuevo dispositivo

"Este dispositivo es nuevo. Para protegerte, confirmaremos que eres tú." → OTP → aviso: "Durante 24 h tus límites serán reducidos" (duración y límites configurables) → "Hemos avisado a tus otros dispositivos".

### 4.4 Dashboard (Inicio)

```
┌──────────────────────────────┐
│ VELYNT SERVICES          🔔 (2) │
│ Buenos días, Carlos           │
│                               │
│ Saldo operativo           ⓘ   │
│ 2.450.000 XAF                 │
│ Disponible para operaciones   │
│                               │
│ ┌────────────┐┌────────────┐  │
│ │ DEPOSITAR  ││  RETIRAR   │  │
│ └────────────┘└────────────┘  │
│ ┌────────────┐┌────────────┐  │
│ │ESCANEAR QR ││   COBRAR   │  │
│ └────────────┘└────────────┘  │
│                               │
│ Operaciones de hoy            │
│ Cash-in        850.000 XAF    │
│ Cash-out       420.000 XAF    │
│ Pagos QR       180.000 XAF    │
│ Comisiones      12.500 XAF    │
│                               │
│ Últimas operaciones   Ver todo│
│ ↑ Retiro       50.000  ✔      │
│ ↓ Depósito    100.000  ✔      │
│ ▢ Pago QR      25.000  ⏳     │
└──────────────────────────────┘
 Inicio · Operaciones · [QR] · Comisiones · Perfil
```
- `ⓘ` abre la explicación de saldos (ver 4.13).
- Si hay operaciones pendientes: banner amarillo "Tienes 1 operación pendiente" arriba.
- Si el float está bajo (umbral configurable): banner "Tu saldo operativo es bajo. Recarga para seguir haciendo depósitos".
- Pull-to-refresh. Sin conexión: banner gris "Sin conexión · datos de las 10:32" y botones de operación desactivados con explicación.

### 4.5 Depositar (cash-in)

1. **Cliente**: "Escanea el QR del cliente" (su código personal en la app Velynt) o "Introduce su teléfono". Muestra `****4821` y, si se confirma su uso, nombre abreviado.
2. **Importe**: teclado numérico grande; debajo "Límite por operación: 500.000 XAF · Disponible hoy: 1.150.000 XAF". Botones rápidos opcionales (10.000 / 25.000 / 50.000 / 100.000).
3. **Confirmar**: resumen (cliente, importe, comisión que ganas, saldo operativo tras la operación) → PIN o biometría.
4. **Esperando al cliente**: "Pide al cliente que confirme en su app Velynt" + cuenta atrás (3 min). Botón "Cancelar". Método alternativo si el cliente no tiene la app: **(por confirmar)**.
5. **Resultado**: "DEPÓSITO COMPLETADO · 100.000 XAF · BTX-00092832" + "Ya puedes guardar el efectivo".

### 4.6 Retirar (cash-out)

1. **Escanear** el QR de retiro del cliente o **introducir el código** de retiro.
2. **Revisar**: importe (bloqueado; el agente no lo puede cambiar), cliente `****4821`, caduca en 04:12, comisión.
3. **Confirmar** con PIN/biometría.
4. **Procesando** (≤ 2–3 s normalmente): "Estamos verificando la operación. **No entregues el efectivo todavía.**"
5. **Resultado**:
```
✔ RETIRO COMPLETADO
50.000 XAF
Transaction ID: BTX-00092831
Fecha: 26/09/2026  Hora: 10:42
Cliente: ****4821   Comisión: 500 XAF
➜ Entrega 50.000 XAF en efectivo al cliente
[ VER RECIBO ]  [ NUEVA OPERACIÓN ]
```

### 4.7 QR (botón central)

Tres opciones grandes: **Escanear** (detecta automáticamente si es un retiro, un QR de cliente para depósito u otro tipo), **Mi QR de agente** (estático, identifica al agente), **Cobrar** (crea QR dinámico con importe, válido X min, un solo uso). El QR de cobro muestra cuenta atrás y cambia a "Pagado ✔" en tiempo real (polling cada 2 s o push).

### 4.8 Operaciones (historial)

- Chips de periodo: **Hoy · Ayer · 7 días · Este mes · Personalizado**.
- Filtro de tipo: Cash-in, Cash-out, QR, Comisiones, Liquidaciones, Reembolsos, Ajustes autorizados.
- Filtro de estado.
- Cada fila: icono de tipo, importe, `****4821`, hora, estado (badge). Toque → detalle.
- Totales del periodo arriba (entradas, salidas, comisiones).
- Scroll infinito con cursor; disponible sin conexión para lo ya cacheado.

### 4.9 Detalle de operación

```
Transaction   BTX-00928381
Tipo          Cash-out
Cantidad      50.000 XAF
Comisión      500 XAF
Cliente       ****4821
Agente        AG-000124
Fecha         26/09/2026 10:42
Método        QR
Referencia    WDR-7F3K2
Estado        ✔ COMPLETED
Historial     10:42:01 Creada · 10:42:03 Completada
[ VER RECIBO ]  [ COMPARTIR ]  [ REPORTAR PROBLEMA ]
```
Sin ningún botón de edición. "Reportar problema" crea una incidencia vinculada.

### 4.10 Recibo

Tarjeta imprimible/compartible (imagen o PDF) con: VELYNT SERVICES, tipo, importe, referencia, fecha/hora, agente (código y nombre comercial), cliente enmascarado, estado, código de verificación corto. Impresión Bluetooth para impresoras térmicas **(por confirmar)**.

### 4.11 Comisiones

Tarjetas: **Hoy 8.500 · Esta semana 42.300 · Este mes 185.400 · Total histórico 1.250.000 XAF**. Debajo, desglose por tipo (cash-in / cash-out / QR / otras) y lista de comisiones por operación. Nota: "Las comisiones pendientes se pagan en la próxima liquidación".

### 4.12 Liquidaciones

Lista: periodo, importe liquidado, estado (pending, scheduled, processing, completed, failed). Detalle: periodo, volumen, comisiones, deducciones (si aplican), importe liquidado, fecha, método, referencia, cuenta destino enmascarada.

### 4.13 Mis saldos (explicación)

| Saldo | Qué es | Origen |
|---|---|---|
| **Saldo operativo (float)** | Dinero electrónico que puedes usar para depósitos a clientes. Baja con cada depósito y sube con cada retiro | Ledger |
| **Comisiones pendientes** | Lo que has ganado y todavía no se te ha pagado | Ledger |
| **Liquidaciones** | Pagos de comisiones ya realizados o programados | Liquidaciones |
| **Efectivo en caja (declarado)** | Solo lo que **tú** declares. Velynt no conoce el efectivo físico que tienes | Declaración del agente, con fecha |

El efectivo declarado se muestra como "Declarado por ti el 26/09 a las 08:00", nunca como un dato del sistema.

### 4.14 Mis límites

Por tipo de operación: por operación, diario (usado / total con barra), mensual, número de operaciones diarias. Nivel de agente actual y "¿Cómo subir de nivel?" (criterios configurables). Si hay un periodo de enfriamiento por dispositivo nuevo, se muestra aquí.

### 4.15 Mi perfil

Cabecera: Agent ID **AG-000001**, nombre, estado **ACTIVE**, categoría, ubicación (Bata), negocio. Secciones: Información personal · Información del negocio · KYC · Documentos · Límites · Comisiones · Liquidaciones · Seguridad · Dispositivos · Soporte. Los datos verificados por KYC no se editan desde la app: "Para cambiar este dato, abre una solicitud".

### 4.16 KYC y documentos

Lista de requisitos (según configuración del país) con estado por elemento: pendiente, enviado, verificado, rechazado (con motivo), caduca pronto. Captura guiada del documento (marco, detección de brillo/desenfoque) y selfie si se requiere. El agente ve el estado y el tipo de documento, **no** vuelve a descargar las imágenes.

### 4.17 Seguridad

Cambiar PIN · Biometría (interruptor) · Dispositivos conectados · Cerrar otras sesiones · Notificaciones · Historial de accesos. Cabecera: "Último acceso: 26/09/2026 10:32 · Samsung Galaxy A14 · Bata (aprox.)".

### 4.18 Dispositivos

Lista con modelo, "Este dispositivo", último uso, ubicación aproximada y botón "Desconectar". Desconectar pide PIN y revoca todas sus sesiones.

### 4.19 Notificaciones

Bandeja con no leídas destacadas; toque → operación, liquidación o incidencia relacionada.

### 4.20 Ayuda / Soporte

Opciones: Problema con operación · Cliente no recibió dinero · Error en cash-in · Error en cash-out · Problema con QR · Problema con liquidación · Cuenta bloqueada · Problema de KYC · Contactar soporte. Formulario: categoría, operación relacionada (selector del historial), descripción, adjunto opcional (captura). "Mis incidencias" con Ticket ID, estado, fecha, descripción y respuesta de soporte.

### 4.21 Onboarding y estado de solicitud

Línea de tiempo: Solicitud → Registro → KYC → Revisión → Aprobación → Activación, con el paso actual resaltado y qué falta.

### 4.22 Cuenta restringida

"Esta cuenta está temporalmente bloqueada" / "suspendida", con motivo genérico (nunca detalles de reglas antifraude) y botón "Contactar soporte". Solo consulta de historial y soporte.

## 5. Catálogo de mensajes de error

La API devuelve **códigos**; la app los traduce. Nunca se muestran mensajes técnicos.

| Código | Mensaje al agente | Acción sugerida |
|---|---|---|
| `INSUFFICIENT_FLOAT` | Saldo operativo insuficiente. | Recargar saldo |
| `LIMIT_PER_TX_EXCEEDED` | Esta operación supera tu límite por operación. | Ver límites |
| `LIMIT_DAILY_EXCEEDED` | Esta operación supera tu límite diario. | Ver límites |
| `LIMIT_MONTHLY_EXCEEDED` | Esta operación supera tu límite mensual. | Ver límites |
| `QR_EXPIRED` | El código QR ha caducado. | Pide al cliente uno nuevo |
| `QR_ALREADY_USED` | Este código ya se ha utilizado. | — |
| `QR_INVALID` | No reconocemos este código. | Escanear de nuevo |
| `WITHDRAWAL_CODE_INVALID` | El código de retiro no es válido. | Revisar el código |
| `ALREADY_PROCESSED` | La operación ya ha sido procesada. | Ver operación |
| `IDENTITY_NOT_VERIFIED` | No hemos podido verificar la identidad. | Intentar de nuevo / soporte |
| `ACCOUNT_LOCKED` | Esta cuenta está temporalmente bloqueada. | Esperar / soporte |
| `ACCOUNT_SUSPENDED` | Tu cuenta está suspendida. Contacta con soporte. | Soporte |
| `CUSTOMER_UNAVAILABLE` | No es posible operar con este cliente ahora mismo. | — (sin detalles del motivo) |
| `CUSTOMER_TIMEOUT` | El cliente no confirmó a tiempo. La operación se ha cancelado. | Repetir |
| `CUSTOMER_REJECTED` | El cliente rechazó la operación. | — |
| `PROCESSING` | Estamos verificando la operación. | Esperar; no entregar efectivo |
| `UNDER_REVIEW` | La operación está en revisión. Te avisaremos. | — |
| `PIN_INVALID` | PIN incorrecto. Te quedan {n} intentos. | — |
| `OTP_INVALID` | Código incorrecto. Te quedan {n} intentos. | — |
| `OTP_EXPIRED` | El código ha caducado. Te enviamos uno nuevo. | Reenviar |
| `DEVICE_NOT_TRUSTED` | Este dispositivo no está autorizado. | Verificar dispositivo |
| `SESSION_EXPIRED` | Tu sesión ha caducado. Vuelve a entrar. | Login |
| `NETWORK_OFFLINE` | Necesitas conexión para operar. | — |
| `RATE_LIMITED` | Demasiados intentos. Espera un momento. | — |
| `APP_UPDATE_REQUIRED` | Actualiza la app para seguir operando. | Tienda |
| `INTERNAL_ERROR` | No hemos podido completar la acción. Inténtalo de nuevo. Si el problema continúa, contacta con soporte. | Soporte (con `request_id` oculto para soporte) |

## 6. Accesibilidad

Lectores de pantalla (etiquetas en todos los botones, importes leídos como número completo), escalado de fuente, contraste AA, no depender solo del color, retroalimentación háptica en éxito/error, y temporizadores con aviso previo.
