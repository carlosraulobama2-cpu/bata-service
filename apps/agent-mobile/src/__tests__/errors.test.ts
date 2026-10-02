jest.mock('expo-crypto', () => ({ randomUUID: () => 'x', getRandomBytes: () => new Uint8Array(32) }));
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-local-authentication', () => ({}));

import i18n from '../i18n';
import { es } from '../i18n/es';
import { ApiError, detailsFrom } from '../api/client';
import { API_ERROR_CODES, APP_ERROR_CODES } from '../api/error-codes';
import { errorMessage } from '../features/errors';

describe('error messages', () => {
  it('has a Spanish message for every code of the agents API', () => {
    expect(API_ERROR_CODES.length).toBeGreaterThan(40);
    for (const code of [...API_ERROR_CODES, ...APP_ERROR_CODES]) expect(es.errors).toHaveProperty(code);
  });

  it('reads attempts left and waiting time from the API detail', () => {
    expect(detailsFrom('Incorrect PIN. 3 attempts left', null)).toEqual({ attempts_left: 3 });
    expect(detailsFrom('Rate limit exceeded for agent-pin. Retry in 830s.', null)).toEqual({ retry_after_seconds: 830 });
    expect(detailsFrom('Too many wrong PINs. Payments are locked for 30 minutes', null)).toEqual({ retry_after_seconds: 1800 });
    expect(detailsFrom('Too many requests', '20')).toEqual({ retry_after_seconds: 20 });
    expect(detailsFrom('Customer not found', null)).toEqual({});
  });

  it('says when a throttled agent can try again', () => {
    const t = i18n.t.bind(i18n);
    expect(errorMessage(new ApiError('rate_limited', 429, { retry_after_seconds: 830 }), t)).toBe('Demasiados intentos. Espera un momento. Podrás intentarlo en 14 minutos.');
    expect(errorMessage(new ApiError('rate_limited', 429, { retry_after_seconds: 20 }), t)).toBe('Demasiados intentos. Espera un momento. Podrás intentarlo en 1 minuto.');
  });

  it('adds attempts left', () => {
    const t = i18n.t.bind(i18n);
    expect(errorMessage(new ApiError('wrong_pin', 403, { attempts_left: 1 }), t)).toBe('PIN incorrecto. Te queda 1 intento.');
    expect(errorMessage(new ApiError('wrong_pin', 403, { attempts_left: 3 }), t)).toBe('PIN incorrecto. Te quedan 3 intentos.');
  });

  it('never shows unknown or technical errors as-is', () => {
    const t = i18n.t.bind(i18n);
    expect(errorMessage(new ApiError('something_new', 500), t)).toBe(es.errors.server_error);
    expect(errorMessage(new Error('ECONNRESET at socket.js:12'), t)).toBe(es.errors.server_error);
  });
});
