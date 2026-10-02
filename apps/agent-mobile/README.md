# App de agentes (VELYNT SERVICES)

App móvil para agentes autorizados de Velynt. Expo SDK 57 · React Native · TypeScript · expo-router.

**Se conecta al API de agentes de Velynt** ([`velynt/api-agente`](https://github.com/carlosraulobama2-cpu/velynt/tree/main/api-agente), puerto 8001), que comparte la base de datos y el libro contable con la app de clientes Velynt: el dinero que mueve el agente es el mismo que ve el cliente en su app. Es el único backend: este repositorio no tiene backend propio.

## Qué incluye

| Flujo | Detalle |
|---|---|
| Acceso | Correo y contraseña de la cuenta Velynt. Sesión propia de la app de agentes (un token de la app de clientes no sirve) y **una por agente**: entrar en otro teléfono cierra la anterior |
| Alta | Si la cuenta no es de agente, «Solicitar»: nombre del negocio, ciudad y dirección. Velynt la aprueba en el panel (hace falta la identidad verificada en la app Velynt). Avisos de «en revisión» y «no aprobada» |
| PIN de pagos | 4 dígitos, el mismo que en la app Velynt. Se crea o cambia con la contraseña. Confirma cada operación (`X-Transaction-PIN`); 5 errores bloquean los pagos 30 min |
| Huella o rostro | Tras confirmar una vez con el PIN, el PIN se guarda en el almacén seguro protegido por biometría; la huella lo desbloquea y la app lo envía como si se tecleara. El servidor siempre comprueba el mismo PIN |
| Inicio | Saldo operativo, acciones grandes (Depositar, Retirar, Escanear QR), resumen de hoy (depósitos, retiros, efectivo neto en caja, comisiones), últimas operaciones, avisos de estado |
| Depósito | Por teléfono o nº de cliente (`BP-000182`) → el agente confirma en voz alta el nombre enmascarado («Pedro O. E.») → importe con avisos de límite y saldo → PIN → completado al momento |
| Depósito por QR | El cliente crea una recarga en su app; el agente escanea el QR, ve importe y cliente, cobra el efectivo y confirma con el PIN |
| Retiro | El cliente lo pide en su app. El agente escanea el QR o escribe el teléfono y el código de 6 dígitos → revisión (importe fijo, comisión del cliente, cuenta atrás) → PIN → «Entrega X en efectivo» |
| Operaciones | Hoy / ayer / 7 días / mes (días de Malabo), depósitos o retiros, totales del periodo, scroll infinito, recibo para compartir (cliente enmascarado) |
| Comisiones | Este mes, hoy, 7 días, por tipo de operación y últimas comisiones. Velynt las abona al momento en el saldo operativo |
| Avisos | Campana con contador; saldo bajo, cambios de la cuenta; tocar marca como leído y abre la operación. Push con Expo (FCM/APNs) |
| Soporte | También sin iniciar sesión: llamar o WhatsApp (números en `EXPO_PUBLIC_SUPPORT_*`), aviso contra estafas, «Reportar un problema» con la referencia ya escrita |
| Perfil y límites | Código de agente, negocio, dirección, estado; límites diarios de depósito y retiro con lo usado hoy |

**Push en un teléfono real**: requiere un *development build* o un build de EAS y el `projectId` de EAS (`eas init` lo añade a `app.json` en `extra.eas.projectId`, o `EXPO_PUBLIC_EAS_PROJECT_ID`), además de las credenciales FCM/APNs cargadas en EAS. Sin `projectId`, la app muestra «no disponible» y todo lo demás funciona.

## Decisiones de UX

- **Nunca se muestra éxito sin el servidor.** Si se corta la red al confirmar, la app pasa a «Estamos verificando la operación · No entregues el efectivo todavía» y reenvía la misma petición (misma `Idempotency-Key`) hasta tener respuesta: el API devuelve la operación que ya ocurrió en lugar de mover el dinero dos veces.
- **Tres acciones siempre a mano**: en el inicio y en el botón QR central de la barra inferior.
- **Teclado numérico propio** para PIN e importes; el PIN nunca pasa por el teclado del sistema.
- **Estados con icono, texto y color**, nunca solo con color. Contraste AA en claro y oscuro.
- **Mensajes de error humanos** para cada `code` del API (lista en `src/api/error-codes.ts`; una prueba comprueba que todos tienen texto), con intentos restantes y tiempo de espera cuando el API los da.
- **Privacidad**: del cliente solo el nombre enmascarado y el teléfono parcial que da el servidor; el recibo compartido también va enmascarado.

## Seguridad en la app

- Refresh token y PIN protegido por biometría en el almacén seguro del sistema (`expo-secure-store`: Android Keystore / iOS Keychain, «solo este dispositivo»). El access token solo está en memoria.
- La app se bloquea tras 3 min en segundo plano y al abrirse; se desbloquea con el PIN (o la huella) comprobado por el servidor (`POST /agent/v1/unlock`, con el mismo contador de errores que los pagos).
- Bloqueo de capturas en el acceso y al teclear el PIN; desenfoque en el selector de apps (iOS).
- **Pendiente**: *certificate pinning*, Play Integrity / App Attest y detección de root/jailbreak contra el servidor (ver [docs/06-seguridad.md](../../docs/06-seguridad.md)).

## Ejecutar

Requiere el stack de Velynt en marcha (en el repo `velynt`: `docker compose up -d agent-api`, que levanta también el API principal, PostgreSQL y Redis). En desarrollo hay un agente de prueba: `agente@equatoriana.app` / `demo1234`, PIN `1357`.

```bash
cp .env.example .env          # EXPO_PUBLIC_API_BASE_URL=http://localhost:8001 (Android emulador: http://10.0.2.2:8001)
pnpm install
npx expo run:android          # development build (hace falta por los módulos nativos: cámara, biometría, almacén seguro)
# o: npx expo start --web     # solo para diseño; la web no es un canal de operación
```

## Pruebas y calidad

```bash
pnpm typecheck   # app + pruebas
pnpm test        # jest-expo
# Contra el stack real (crea clientes de prueba con el API principal y opera como el agente de prueba):
VELYNT_API_URL=http://localhost:8000 EXPO_PUBLIC_API_BASE_URL=http://localhost:8001 pnpm test agents-api
```

- Mensajes para todos los códigos de error del API, reglas del PIN iguales a las del servidor, periodos en días de Malabo, QR de recarga y de retiro por su `schema`.
- La prueba de integración recorre acceso, depósito por teléfono (y su reintento con la misma clave), depósito por QR de recarga, retiro por QR y por teléfono + código, PIN erróneo, comisiones, avisos, desbloqueo y renovación de la sesión.

Identificadores `com.velynt.services`, nombre en tiendas e iconos definitivos: **por confirmar**.
