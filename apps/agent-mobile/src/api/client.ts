import * as Crypto from 'expo-crypto';
import { config } from '../config';
import { signWithBiometricKey, signWithDeviceKey, sha256Hex } from '../security/device-keys';
import { KEYS, secureStorage } from '../security/storage';
import { useSession } from '../state/session';
import type { StepUp } from './types';

/** Error with a stable API code; the UI turns the code into a message (never raw text). */
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
    return this.code === 'NETWORK_OFFLINE';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  /** Financial / security call: device signature + idempotency key (+ step-up). */
  signed?: { idempotencyKey: string; stepUp?: StepUp; biometricPrompt?: string };
  timeoutMs?: number;
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
      useSession.getState().setAccessToken(data.access_token);
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
    throw new ApiError('NETWORK_OFFLINE', 0);
  } finally {
    clearTimeout(timer);
  }
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
  const attempt = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    const session = useSession.getState();
    if (options.auth !== false && session.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
    if (session.deviceId) headers['X-Device-Id'] = session.deviceId;

    let body = options.body;
    if (options.signed) {
      const timestamp = String(Date.now());
      const key = options.signed.idempotencyKey;
      if (options.signed.stepUp) {
        let agentAuth: Record<string, string>;
        if (options.signed.stepUp.method === 'pin') {
          agentAuth = { method: 'pin', pin: options.signed.stepUp.pin };
        } else {
          const bio = await signWithBiometricKey([method, path, timestamp, key].join('\n'), options.signed.biometricPrompt ?? 'BATA SERVICES');
          if (!bio) throw new ApiError('BIOMETRIC_CANCELLED', 0);
          agentAuth = { method: 'biometric', signature: bio };
        }
        body = { ...(body as object), agent_auth: agentAuth };
      }
      const raw = JSON.stringify(body ?? {});
      const canonical = [method, path.split('?')[0], sha256Hex(raw), timestamp, key].join('\n');
      headers['Idempotency-Key'] = key;
      headers['X-Timestamp'] = timestamp;
      headers['X-Device-Signature'] = await signWithDeviceKey(canonical);
      return rawFetch(path, { method, body: raw, headers }, options.timeoutMs);
    }
    return rawFetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers }, options.timeoutMs);
  };

  let res = await attempt();
  if (res.status === 401 && options.auth !== false) {
    const payload = await res.clone().json().catch(() => null);
    if (payload?.error?.code === 'SESSION_EXPIRED' && (await refreshAccessToken())) {
      res = await attempt();
    } else if (['SESSION_EXPIRED', 'SESSION_REVOKED', 'UNAUTHENTICATED', 'DEVICE_NOT_TRUSTED'].includes(payload?.error?.code)) {
      await secureStorage.remove(KEYS.refreshToken);
      useSession.getState().setSignedOut();
    }
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(e.code ?? 'INTERNAL_ERROR', res.status, e.details ?? {}, e.request_id ?? null);
  }
  return data as T;
}

/** A fresh idempotency key: one per logical operation, reused on retries. */
export const newIdempotencyKey = () => Crypto.randomUUID();
