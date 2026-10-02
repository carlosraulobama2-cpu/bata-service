# VELYNT SERVICES

App para **agentes autorizados de Velynt**: depósitos y retiros de efectivo, comisiones, avisos y PIN de pagos.

**Un solo backend: el de Velynt.** La app ([`apps/agent-mobile`](apps/agent-mobile)) habla con el API de agentes de Velynt ([`velynt/api-agente`](https://github.com/carlosraulobama2-cpu/velynt/tree/main/api-agente)), que comparte la base de datos y el libro contable con la app de clientes Velynt. Este repositorio ya no tiene backend ni base de datos propios.

```
App Velynt (clientes) ──────────► API principal (velynt/backend, :8000) ──┐
Panel de control ───────────────► API principal (velynt/backend, :8000) ──┼──► PostgreSQL (un libro contable) + Redis
App de agentes (este repo) ─────► API de agentes (velynt/api-agente, :8001) ┘
```

Cómo pasa la información entre las dos apps (todo por el servidor de Velynt, nunca de app a app):

| Qué | App de clientes | App de agentes |
|---|---|---|
| Depósito directo | — | Busca al cliente por teléfono o nº `BP-…` (`/customers/lookup`), confirma el nombre, PIN → `/cash-in/direct`. El cliente ve el saldo y un aviso «Recarga recibida» |
| Recarga con QR | «Recargar»: importe → QR (`/api/topups`), espera y ve «Recarga completada» | Escanea el QR (`/cash-in/resolve`), cobra el efectivo, PIN → `/cash-in/topups/{id}` |
| Retiro de efectivo | «Retirar»: importe y comisión (`/api/cashouts/quote`), PIN → QR + código de 6 dígitos (`/api/cashouts`), espera y ve «Retiro completado» | Escanea el QR o escribe teléfono + código (`/cash-out/resolve`), PIN → `/cash-out/{id}/complete`, entrega el efectivo |
| Dónde hay agentes | Lista de agentes activos en Recargar y Retirar (`/api/agents`) | El agente se da de alta en la app (`/apply`) y Velynt lo aprueba en el panel |

## Código

```
apps/agent-mobile/  # App de agentes (Expo + React Native + TypeScript); ver su README
packages/money/     # Importes enteros, formato "2.450.000 XAF", cálculo de comisiones
packages/tsconfig/  # Configuración TypeScript compartida
docs/               # Diseño original del producto (ver la nota abajo)
```

```bash
pnpm install
pnpm -r typecheck && pnpm -r build && pnpm -r test
```

El backend se arranca desde el repo `velynt` (`docker compose up -d agent-api`); ver [`apps/agent-mobile/README.md`](apps/agent-mobile/README.md).

## Documentación (diseño original)

> Estos documentos describen el diseño con el que empezó el proyecto, que incluía un backend propio (NestJS) y un ledger separado. **Ese backend se eliminó**: el dinero, las cuentas y las reglas viven ahora en Velynt. Siguen siendo útiles para la experiencia de usuario, la seguridad y las decisiones de negocio pendientes; lo que dicen del backend, la base de datos y la API ya no aplica.

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
