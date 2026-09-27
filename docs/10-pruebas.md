# 10 · Estrategia de pruebas

## 1. Pirámide

| Nivel | Qué | Herramientas | Cuándo |
|---|---|---|---|
| Invariantes de BD | Doble partida, inmutabilidad, idempotencia, transiciones, CHECKs | SQL (`db/tests/invariants_test.sql`, ya incluido: 31 comprobaciones) | Cada PR que toca `db/` |
| Unitarias | Cálculo de comisiones, límites, máquina de estados, reglas de riesgo, firma canónica, enmascarado, formateo de dinero | Jest/Vitest | Cada PR |
| Basadas en propiedades | Para cualquier secuencia aleatoria de operaciones: Σ débitos = Σ créditos, ningún saldo negativo no permitido, saldo almacenado = saldo recalculado | fast-check + PostgreSQL real | Cada PR (ligera) y nocturna (larga) |
| Integración | Endpoints completos con PostgreSQL y Redis reales, Core y Ledger simulados | Testcontainers + supertest | Cada PR |
| Contrato | Agent Backend ↔ Core ↔ Ledger | Pact | Cada PR de cualquier lado |
| Concurrencia | 50 peticiones simultáneas con la misma `Idempotency-Key` → 1 operación; 50 cash-out simultáneos del mismo código → 1 éxito; límites diarios bajo carga | Scripts k6 / tests dedicados | Cada PR (casos clave) |
| Componentes (app) | Pantallas con estados de carga/error/offline | React Native Testing Library | Cada PR |
| E2E móvil | Flujos completos en emulador contra staging | Maestro | Nocturna + antes de release |
| E2E admin | Aprobación, suspensión, límites (maker-checker) | Playwright | Nocturna |
| Carga | Perfil de la etapa objetivo × 2 (p. ej. 20 op/s sostenidas para 1.000 agentes) | k6 | Antes de cada etapa de crecimiento |
| Caos / resiliencia | Caída de Core o Ledger en mitad de un cash-out, timeouts, reintentos, reinicio del worker | Toxiproxy + tests | Mensual |
| Seguridad | SAST, SCA, secretos en repo, DAST en staging, pentest externo | Semgrep/CodeQL, Dependabot, gitleaks, ZAP | Continua; pentest antes de producción y anual |
| Recuperación | Restaurar backup y conciliar | Runbook | Mensual |

## 2. Casos obligatorios (no se puede ir a producción sin ellos en verde)

**Dinero**
- Cash-in completo: saldos finales exactos (cliente +, float −, comisión +).
- Cash-out completo: ídem en sentido contrario.
- Reintento con la misma clave tras timeout → una sola operación y un solo asiento.
- Misma clave con otro importe → `IDEMPOTENCY_KEY_REUSED`.
- Doble toque en "Confirmar" (dos peticiones en paralelo) → una operación.
- Dos agentes escanean el mismo código de retiro a la vez → uno lo consigue, el otro `QR_ALREADY_USED`.
- Float insuficiente → rechazo sin asiento ni hold.
- Límite diario exacto (justo en el límite pasa, 1 XAF más no) y con operaciones concurrentes.
- Cliente no confirma → hold liberado, `cancelled`.
- Core/Ledger no responde → `processing` → el *reconciler* lo resuelve correctamente en ambos sentidos (se contabilizó / no se contabilizó).
- Reverso → saldos restaurados; segundo reverso imposible.
- Operación completada no se puede editar (API y BD).

**Seguridad**
- Token de usuario BataPay rechazado en Agent API, y viceversa.
- Agente A no puede ver operaciones, tickets ni dispositivos del agente B (404).
- Firma de dispositivo inválida, caducada o repetida → rechazo.
- 5 PIN fallidos → bloqueo; el contador sobrevive a reinstalar la app.
- Refresh reutilizado → familia revocada.
- Suspensión → la siguiente operación falla aunque el access token siga vigente.
- Nuevo dispositivo → OTP, aviso, enfriamiento.
- Staff no puede aprobar lo que él mismo solicitó.
- Logs no contienen PIN, OTP, tokens ni teléfonos completos (test que analiza la salida del logger).
- QR manipulado (firma o id) → rechazado; QR válido caducado → `QR_EXPIRED`.

**App**
- Sin conexión: dashboard con marca de "sin conexión", botones de operación deshabilitados.
- Corte de red tras confirmar cash-out → "Estamos verificando" → estado real recuperado por clave; nunca muestra "completado" sin servidor.
- Mensajes de error: cada código de API tiene texto en `es` (test que recorre el catálogo).

## 3. Entornos y datos

- `dev` (datos sintéticos), `staging` (idéntico a producción en infraestructura, datos sintéticos, proveedores en *sandbox*), `prod`.
- Generador de datos sintéticos (agentes, clientes, operaciones) con nombres y teléfonos ficticios; **nunca** copias de producción.
- Cada release pasa por staging con la batería E2E y un *smoke test* en producción con una cuenta de prueba interna y límites mínimos.

## 4. Calidad continua

- Cobertura mínima orientativa: 90 % en `operations`, `limits`, `commissions`, `auth`, `risk` y `packages/money`; 70 % global.
- Revisión de código obligatoria por dos personas en módulos de dinero y seguridad (CODEOWNERS).
- *Feature flags* para activar funciones por agente/zona (piloto antes de abrir a todos).
