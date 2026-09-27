/**
 * Business error with a stable code. The code is what the app translates
 * into a message for the agent (docs/02-ux-ui.md §5). Messages here are
 * Spanish defaults; internal details never go to the client.
 */
export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

const E = (code: string, status: number, message: string) => (details?: Record<string, unknown>) =>
  new AppError(code, status, message, details);

export const Errors = {
  validation: E('VALIDATION_ERROR', 400, 'Los datos enviados no son válidos.'),
  unauthenticated: E('UNAUTHENTICATED', 401, 'Tu sesión no es válida. Vuelve a entrar.'),
  sessionExpired: E('SESSION_EXPIRED', 401, 'Tu sesión ha caducado. Vuelve a entrar.'),
  sessionRevoked: E('SESSION_REVOKED', 401, 'Tu sesión se ha cerrado. Vuelve a entrar.'),
  invalidCredentials: E('INVALID_CREDENTIALS', 401, 'Teléfono o PIN incorrectos.'),
  pinInvalid: E('PIN_INVALID', 401, 'PIN incorrecto.'),
  biometricInvalid: E('IDENTITY_NOT_VERIFIED', 401, 'No hemos podido verificar la identidad.'),
  otpInvalid: E('OTP_INVALID', 400, 'Código incorrecto.'),
  otpExpired: E('OTP_EXPIRED', 410, 'El código ha caducado. Solicita uno nuevo.'),
  forbidden: E('FORBIDDEN', 403, 'No tienes permiso para realizar esta acción.'),
  deviceNotTrusted: E('DEVICE_NOT_TRUSTED', 403, 'Este dispositivo no está autorizado.'),
  signatureInvalid: E('SIGNATURE_INVALID', 401, 'No hemos podido verificar la operación.'),
  accountLocked: E('ACCOUNT_LOCKED', 423, 'Esta cuenta está temporalmente bloqueada.'),
  accountSuspended: E('ACCOUNT_SUSPENDED', 403, 'Tu cuenta está suspendida. Contacta con soporte.'),
  accountBlocked: E('ACCOUNT_BLOCKED', 403, 'Esta cuenta está bloqueada. Contacta con soporte.'),
  accountNotActive: E('ACCOUNT_NOT_ACTIVE', 403, 'Tu cuenta de agente todavía no está activa.'),
  notFound: E('NOT_FOUND', 404, 'No encontrado.'),
  alreadyProcessed: E('ALREADY_PROCESSED', 409, 'La operación ya ha sido procesada.'),
  operationInProgress: E('OPERATION_IN_PROGRESS', 409, 'Estamos verificando la operación.'),
  idempotencyKeyReused: E('IDEMPOTENCY_KEY_REUSED', 409, 'Esta solicitud ya se usó con otros datos.'),
  idempotencyKeyRequired: E('IDEMPOTENCY_KEY_REQUIRED', 400, 'Falta la clave de la operación.'),
  insufficientFloat: E('INSUFFICIENT_FLOAT', 422, 'Saldo operativo insuficiente.'),
  limitPerTx: E('LIMIT_PER_TX_EXCEEDED', 422, 'Esta operación supera tu límite por operación.'),
  limitBelowMin: E('AMOUNT_BELOW_MINIMUM', 422, 'El importe es inferior al mínimo permitido.'),
  limitDaily: E('LIMIT_DAILY_EXCEEDED', 422, 'Esta operación supera tu límite diario.'),
  limitDailyCount: E('LIMIT_DAILY_COUNT_EXCEEDED', 422, 'Has alcanzado el número máximo de operaciones de hoy.'),
  limitMonthly: E('LIMIT_MONTHLY_EXCEEDED', 422, 'Esta operación supera tu límite mensual.'),
  noLimitPolicy: E('OPERATION_NOT_ENABLED', 422, 'Esta operación no está habilitada para tu cuenta.'),
  customerUnavailable: E('CUSTOMER_UNAVAILABLE', 422, 'No es posible operar con este cliente ahora mismo.'),
  amountMismatch: E('AMOUNT_MISMATCH', 422, 'El importe no coincide con la solicitud del cliente.'),
  qrExpired: E('QR_EXPIRED', 410, 'El código QR ha caducado.'),
  qrInvalid: E('QR_INVALID', 404, 'No reconocemos este código.'),
  qrAlreadyUsed: E('QR_ALREADY_USED', 409, 'Este código ya se ha utilizado.'),
  withdrawalCodeInvalid: E('WITHDRAWAL_CODE_INVALID', 404, 'El código de retiro no es válido.'),
  operationNotCancellable: E('OPERATION_NOT_CANCELLABLE', 409, 'Esta operación ya no se puede cancelar.'),
  rateLimited: E('RATE_LIMITED', 429, 'Demasiados intentos. Espera un momento.'),
  pinTooWeak: E('PIN_TOO_WEAK', 422, 'Elige un PIN más seguro: sin repeticiones ni secuencias.'),
  pinReused: E('PIN_REUSED', 422, 'El nuevo PIN debe ser distinto de los últimos que has usado.'),
  unsupportedCurrency: E('UNSUPPORTED_CURRENCY', 422, 'Moneda no soportada.'),
  appUpdateRequired: E('APP_UPDATE_REQUIRED', 426, 'Actualiza la app para seguir operando.'),
  internal: E('INTERNAL_ERROR', 500, 'No hemos podido completar la acción. Inténtalo de nuevo.')
} as const;
