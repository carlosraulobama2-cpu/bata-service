import * as Crypto from 'expo-crypto';
import { config } from '../config';
import { pinFromBiometrics, rememberPinForBiometrics } from '../security/biometrics';
import { KEYS, secureStorage } from '../security/storage';
import { useSession } from '../state/session';
import type { StepUp } from './types';

/** Error with a stable API code (`code` of the agents API); the UI turns it into a message. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
    readonly requestId: string | null = null
  ) {
    super(code);
    this.name = 'ApiError';
  }

  /** The request may or may not have reached the server. */
  get isNetwork(): boolean {
    return this.code === 'network_offline';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  /** Money operation: one Idempotency-Key per operation (reused on retries) + the payment PIN. */
  money?: { idempotencyKey?: string; stepUp: StepUp; biometricPrompt?: string };
  timeoutMs?: number;
}

/**
 * Numbers the API only writes in `detail` ("Incorrect PIN. 3 attempts left", "Retry in 830s"):
 * the app shows them in its own words.
 */
export function detailsFrom(detail: string, retryAfterHeader: string | null): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  const left = /(\d+) attempts? left/i.exec(detail);
  if (left) details.attempts_left = Number(left[1]);
  const retry = retryAfterHeader ? Number(retryAfterHeader) : Number(/Retry in (\d+)\s*s/i.exec(detail)?.[1] ?? NaN);
  if (Number.isFinite(retry) && retry > 0) details.retry_after_seconds = retry;
  const minutes = /locked for (\d+) minutes/i.exec(detail);
  if (minutes) details.retry_after_seconds = Number(minutes[1]) * 60;
  return details;
}

let refreshing: Promise<boolean> | null = null;

/** Single-flight refresh: concurrent 401s share one refresh call. */
async function refreshAccessToken(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const refreshToken = await secureStorage.get(KEYS.refreshToken);
      if (!refreshToken) return false;
      const res = await rawFetch('/agent/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }), headers: {} });
      if (!res.ok) return false;
      const data = await res.json();
      await secureStorage.set(KEYS.refreshToken, data.refresh_token);
      useSession.getState().setAccessToken(data.token);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

async function rawFetch(path: string, init: { method: string; body?: string; headers: Record<string, string> }, timeoutMs = 20000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${config.apiBaseUrl}${path}`, {
      method: init.method,
      body: init.body,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'X-App-Version': config.appVersion,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers
      }
    });
  } catch {
    throw new ApiError('network_offline', 0);
  } finally {
    clearTimeout(timer);
  }
}

/** The PIN to send: typed, or unlocked from the keystore with fingerprint/face. */
async function pinFor(stepUp: StepUp, prompt: string): Promise<string> {
  if (stepUp.method === 'pin') return stepUp.pin;
  const pin = await pinFromBiometrics(prompt);
  if (!pin) throw new ApiError('biometric_cancelled', 0);
  return pin;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = {};
  if (options.money) {
    headers['X-Transaction-PIN'] = await pinFor(options.money.stepUp, options.money.biometricPrompt ?? config.appName);
    if (options.money.idempotencyKey) headers['Idempotency-Key'] = options.money.idempotencyKey;
  }
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  const attempt = (): Promise<Response> => {
    const token = useSession.getState().accessToken;
    const auth: Record<string, string> = options.auth !== false && token ? { Authorization: `Bearer ${token}` } : {};
    return rawFetch(path, { method, body, headers: { ...headers, ...auth } }, options.timeoutMs);
  };

  let res = await attempt();
  if (res.status === 401 && options.auth !== false) {
    // Expired access token: refresh once and repeat. Anything else (session closed because the agent
    // signed in on another phone, account gone): back to the login screen.
    if (await refreshAccessToken()) res = await attempt();
    if (res.status === 401) {
      await secureStorage.remove(KEYS.refreshToken);
      useSession.getState().setSignedOut();
    }
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const e = (data ?? {}) as { code?: string; detail?: string; request_id?: string };
    throw new ApiError(e.code ?? (res.status >= 500 ? 'server_error' : 'error'), res.status, detailsFrom(e.detail ?? '', res.headers.get('Retry-After')), e.request_id ?? res.headers.get('X-Request-ID'));
  }
  // A typed PIN the server accepted: let fingerprint/face confirm next time (only once per PIN).
  if (options.money?.stepUp.method === 'pin' && useSession.getState().biometricEnabled === false) {
    void rememberPinForBiometrics(options.money.stepUp.pin).then((ok) => ok && useSession.getState().setBiometricEnabled(true));
  }
  return data as T;
}

/** A fresh idempotency key: one per logical operation, reused on retries. */
export const newIdempotencyKey = () => Crypto.randomUUID();
