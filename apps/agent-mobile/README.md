# App de agentes (VELYNT SERVICES)

App móvil para agentes autorizados de BataPay. Expo SDK 57 · React Native · TypeScript · expo-router.
Diseño de referencia: [docs/02-ux-ui.md](../../docs/02-ux-ui.md).

![Pantallas principales](../../docs/screenshots/overview.png)

## Qué incluye

| Flujo | Detalle |
|---|---|
| Acceso | Teléfono (+240) → PIN en teclado propio → OTP por SMS en dispositivo nuevo → registro de claves del dispositivo |
| Inicio | Saldo operativo del ledger, explicación de cada saldo, acciones grandes (Depositar, Retirar, Escanear QR), resumen de hoy, últimas operaciones, avisos (pendientes, saldo bajo, cuenta suspendida, dispositivo nuevo, sin conexión) |
| Retiro | Escáner QR o código de 9 dígitos → revisión (importe bloqueado, cuenta atrás de caducidad, comisión, saldo tras la operación) → PIN o biometría → «Retiro completado · Entrega X en efectivo» |
| Depósito | Teléfono del cliente → importe con teclado propio y avisos de límites en vivo → revisión → PIN o biometría → espera de confirmación del cliente con cuenta atrás y cancelación → resultado |
| Operaciones | Filtros por periodo y tipo, totales, scroll infinito, detalle con historial de estados y recibo para compartir (cliente enmascarado) |
| Comisiones | Pendiente de liquidar (ledger), hoy / 7 días / mes / histórico, barras por tipo de operación, últimas comisiones (abren la operación) |
| Avisos | Campana con contador en el inicio; lista con icono por tipo, hora relativa, sin leer resaltado; tocar marca como leído y abre la operación; «Marcar todo como leído» |
| Push | La app nunca pide el permiso al abrirse: un aviso en el inicio explica para qué sirve («saber al momento cuándo te pagan»). Canales Android «Operaciones», «Seguridad» y «Avisos». Tocar un push abre la operación. Ajustes de avisos por tipo (los de seguridad, bloqueados) |
| Soporte | «Ayuda y soporte» también sin iniciar sesión (desde «¿Problemas para entrar?» y «¿Olvidaste tu PIN?»): llamar o WhatsApp, horario y aviso contra estafas. «Reportar un problema» en cada operación abre WhatsApp con el Agent ID y la referencia ya escritos. Los botones se ocultan si el servidor no tiene números configurados |
| Seguridad | Este dispositivo, acceso anterior, intentos fallidos recientes, sesiones abiertas y «Cerrar las demás sesiones» (PIN/biometría), dispositivos, historial de accesos; cambio de PIN en 3 pasos con las mismas reglas que el servidor |
| QR (botón central) | **Escanear** (el servidor decide: QR de retiro → revisión del retiro; QR personal del cliente → depósito a ese cliente) · **Cobrar** (importe → QR grande de un solo uso con cuenta atrás; pasa a «Pagado» solo cuando el servidor confirma el pago; anular cobro) · **Mi QR de agente** (estático, sin importe) |
| Perfil | Agent ID, estado, categoría, negocio, límites con barras de uso, dispositivo, cerrar sesión |

**Push en un teléfono real**: requiere un *development build* o un build de EAS y el `projectId` de EAS (`eas init` lo añade a `app.json` en `extra.eas.projectId`, o `EXPO_PUBLIC_EAS_PROJECT_ID`), además de las credenciales FCM/APNs cargadas en EAS. Sin `projectId`, la app muestra «no disponible» y todo lo demás funciona.

Con `EXPO_PUBLIC_DEV_TOOLS=true` la pantalla de cobro muestra «Simular pago del cliente» (usa `POST /dev/qr/pay`).

## Decisiones de UX

- **Nunca se muestra éxito sin el servidor.** Si se corta la red al confirmar, la app pasa a «Estamos verificando la operación · No entregues el efectivo todavía» y consulta el estado real por la clave de idempotencia; los reintentos reutilizan la misma clave.
- **Tres acciones siempre a mano**: en el inicio y en el botón QR central de la barra inferior.
- **Teclado numérico propio** para PIN e importes: teclas de 52–64 dp, sin saltos del teclado del sistema, y el PIN nunca pasa por el teclado del sistema.
- **Estados con icono, texto y color**, nunca solo con color. Contraste AA en claro y oscuro.
- **Mensajes de error humanos** para cada código de la API (hay una prueba que lo comprueba), con intentos restantes y hora de desbloqueo cuando aplica. El límite superado se explica con la cifra concreta.
- **Pantallas pequeñas**: modo compacto por debajo de 700 dp de alto (probado en 360×640).
- **Privacidad**: del cliente solo `****4821`; el recibo compartido también va enmascarado.

## Seguridad en la app

- Refresh token y clave privada del dispositivo en el almacén seguro del sistema (`expo-secure-store`: Android Keystore / iOS Keychain, «solo este dispositivo»). El access token solo está en memoria.
- Cada operación va firmada (ECDSA P-256) sobre la petición canónica que verifica el backend; la biometría desbloquea una segunda clave guardada con `requireAuthentication`.
- Bloqueo de capturas al teclear PIN o códigos; desenfoque en el selector de apps (iOS); la app se bloquea tras 3 min en segundo plano y al abrirse.
- Teléfono rooteado, con jailbreak o emulador: puede consultar, no operar (aviso en el inicio).
- **Pendiente de endurecer**: hoy la clave privada se genera en JS y se guarda en el almacén seguro; el objetivo es un módulo nativo que la genere y use dentro del hardware (Keystore / Secure Enclave) sin cambiar el contrato con el servidor. También pendientes: *certificate pinning*, Play Integrity / App Attest y bloqueo de capturas en PIN/OTP (ver [docs/06-seguridad.md](../../docs/06-seguridad.md)).

## Ejecutar

Requiere el Agent API en marcha ([apps/agent-api](../agent-api)).

```bash
cp .env.example .env          # EXPO_PUBLIC_API_BASE_URL=... (Android emulador: http://10.0.2.2:3000)
pnpm install
npx expo run:android          # development build (hace falta por los módulos nativos: cámara, biometría, almacén seguro)
# o: npx expo start --web     # solo para diseño; la web no es un canal de operación
```

Con `EXPO_PUBLIC_DEV_TOOLS=true` (y el API con `ENABLE_DEV_ENDPOINTS=true`) aparece «Simular confirmación del cliente» en la espera del depósito.

## Pruebas y calidad

```bash
pnpm typecheck   # app + pruebas
pnpm test        # jest-expo
```

- Las firmas creadas por la app se verifican con el mismo código que usa el servidor (`node:crypto`).
- Formato de importes y fechas en hora de Malabo, catálogo completo de mensajes de error.
- Bundles de Android (Hermes) y web compilados sin errores; recorrido completo (login, OTP, retiro, depósito, historial, detalle, comisiones, perfil, límites) automatizado con Playwright contra el API real en claro, oscuro y 360×640.

Identificadores `com.batapay.services`, nombre en tiendas e iconos definitivos: **por confirmar**.
