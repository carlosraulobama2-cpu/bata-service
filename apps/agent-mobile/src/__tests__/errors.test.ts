jest.mock('expo-crypto', () => ({ randomUUID: () => 'x', getRandomBytes: () => new Uint8Array(32) }));
jest.mock('expo-secure-store', () => ({}));

import i18n from '../i18n';
import { es } from '../i18n/es';
import { ApiError } from '../api/client';
import { errorMessage } from '../features/errors';

// Every error code the API can return, read from the backend itself so a new code can't ship untranslated.
const API_CODES = [
  ...require('node:fs')
    .readFileSync(require('node:path').join(__dirname, '../../../agent-api/src/common/errors/app-error.ts'), 'utf8')
    .matchAll(/E\('([A-Z_]+)'/g)
].map((m: RegExpMatchArray) => m[1] as string);

describe('error messages', () => {
  it('has a Spanish message for every API error code', () => {
    expect(API_CODES.length).toBeGreaterThan(35);
    for (const code of API_CODES) expect(es.errors).toHaveProperty(code);
  });

  it('says when a throttled agent can try again', () => {
    const t = i18n.t.bind(i18n);
    expect(errorMessage(new ApiError('RATE_LIMITED', 429, { retry_after_seconds: 830 }), t)).toBe('Demasiados intentos. Espera un momento. Podrás intentarlo en 14 minutos.');
    expect(errorMessage(new ApiError('RATE_LIMITED', 429, { retry_after_seconds: 20 }), t)).toBe('Demasiados intentos. Espera un momento. Podrás intentarlo en 1 minuto.');
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
