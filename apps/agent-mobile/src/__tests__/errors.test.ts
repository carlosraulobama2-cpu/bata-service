jest.mock('expo-crypto', () => ({ randomUUID: () => 'x', getRandomBytes: () => new Uint8Array(32) }));
jest.mock('expo-secure-store', () => ({}));

import i18n from '../i18n';
import { es } from '../i18n/es';
import { ApiError } from '../api/client';
import { errorMessage } from '../features/errors';

// Every error code the API can return (apps/agent-api/src/common/errors/app-error.ts)
const API_CODES = [
  'VALIDATION_ERROR', 'UNAUTHENTICATED', 'SESSION_EXPIRED', 'SESSION_REVOKED', 'INVALID_CREDENTIALS', 'PIN_INVALID',
  'IDENTITY_NOT_VERIFIED', 'OTP_INVALID', 'OTP_EXPIRED', 'FORBIDDEN', 'DEVICE_NOT_TRUSTED', 'SIGNATURE_INVALID',
  'ACCOUNT_LOCKED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_BLOCKED', 'ACCOUNT_NOT_ACTIVE', 'NOT_FOUND', 'ALREADY_PROCESSED',
  'OPERATION_IN_PROGRESS', 'IDEMPOTENCY_KEY_REUSED', 'INSUFFICIENT_FLOAT', 'LIMIT_PER_TX_EXCEEDED', 'AMOUNT_BELOW_MINIMUM',
  'LIMIT_DAILY_EXCEEDED', 'LIMIT_DAILY_COUNT_EXCEEDED', 'LIMIT_MONTHLY_EXCEEDED', 'OPERATION_NOT_ENABLED',
  'CUSTOMER_UNAVAILABLE', 'AMOUNT_MISMATCH', 'QR_EXPIRED', 'QR_ALREADY_USED', 'WITHDRAWAL_CODE_INVALID',
  'OPERATION_NOT_CANCELLABLE', 'APP_UPDATE_REQUIRED', 'INTERNAL_ERROR'
];

describe('error messages', () => {
  it('has a Spanish message for every API error code', () => {
    for (const code of API_CODES) expect(es.errors).toHaveProperty(code);
  });

  it('adds attempts left and lock time', () => {
    const t = i18n.t.bind(i18n);
    expect(errorMessage(new ApiError('PIN_INVALID', 401, { attempts_left: 1 }), t)).toBe('PIN incorrecto. Te queda 1 intento.');
    expect(errorMessage(new ApiError('PIN_INVALID', 401, { attempts_left: 3 }), t)).toBe('PIN incorrecto. Te quedan 3 intentos.');
    expect(errorMessage(new ApiError('ACCOUNT_LOCKED', 423, { locked_until: '2026-09-26T09:57:00Z' }), t)).toBe(
      'Esta cuenta está temporalmente bloqueada. Podrás intentarlo de nuevo a las 10:57.'
    );
  });

  it('never shows unknown or technical errors as-is', () => {
    const t = i18n.t.bind(i18n);
    expect(errorMessage(new ApiError('SOMETHING_NEW', 500), t)).toBe(es.errors.INTERNAL_ERROR);
    expect(errorMessage(new Error('ECONNRESET at socket.js:12'), t)).toBe(es.errors.INTERNAL_ERROR);
  });
});
