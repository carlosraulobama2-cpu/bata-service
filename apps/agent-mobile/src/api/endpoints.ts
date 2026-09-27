import { config } from '../config';
import { api } from './client';
import type { AccessEvent, AgentQr, Balance, CommissionLine, CommissionSummary, DeviceInfo, NotificationPage, SecurityOverview, SessionInfo, ScanResult, Limits, LoginResponse, Me, StepUp, Transaction, TransactionPage, WithdrawalPreview } from './types';

export type Period = 'today' | 'yesterday' | 'last_7_days' | 'this_month';

export const endpoints = {
  login: (body: { phone: string; pin: string; device: Record<string, unknown> }) => api<LoginResponse>('/agent/v1/auth/login', { body, auth: false }),
  verifyOtp: (body: { challenge_id: string; code: string; device_keys: object }) =>
    api<{ access_token: string; refresh_token: string; device: { id: string; cooldown_until: string | null } }>('/agent/v1/auth/verify-otp', { body, auth: false }),
  logout: () => api<void>('/agent/v1/auth/logout', { method: 'POST' }),

  me: () => api<Me>('/agent/v1/me'),
  balance: () => api<Balance>('/agent/v1/balance'),
  limits: () => api<Limits>('/agent/v1/limits'),

  transactions: (params: { period: Period; type?: string; limit?: number; cursor?: string | null }) => {
    const q = new URLSearchParams({ period: params.period, limit: String(params.limit ?? 20) });
    if (params.type) q.set('type', params.type);
    if (params.cursor) q.set('cursor', params.cursor);
    return api<TransactionPage>(`/agent/v1/transactions?${q.toString()}`);
  },
  transaction: (id: string) => api<{ transaction: Transaction }>(`/agent/v1/transactions/${id}`),
  transactionByKey: (key: string) => api<{ transaction: Transaction }>(`/agent/v1/transactions/by-key/${key}`),

  resolveWithdrawal: (code: { type: 'qr' | 'code'; value: string }) => api<WithdrawalPreview>('/agent/v1/cash-out/resolve', { body: { code } }),
  cashOut: (input: { withdrawalRequestId: string; amount: number; key: string; stepUp: StepUp; prompt: string }) =>
    api<{ transaction: Transaction }>('/agent/v1/cash-out', {
      body: { withdrawal_request_id: input.withdrawalRequestId, amount: input.amount, currency: config.currency },
      signed: { idempotencyKey: input.key, stepUp: input.stepUp, biometricPrompt: input.prompt }
    }),
  cashIn: (input: { customer: { type: 'phone' | 'token'; value: string }; amount: number; key: string; stepUp: StepUp; prompt: string }) =>
    api<{ transaction: Transaction }>('/agent/v1/cash-in', {
      body: { customer: input.customer, amount: input.amount, currency: config.currency },
      signed: { idempotencyKey: input.key, stepUp: input.stepUp, biometricPrompt: input.prompt }
    }),
  createCollectQr: (input: { amount: number; key: string }) =>
    api<AgentQr>('/agent/v1/qr/create', { body: { kind: 'collect', amount: input.amount, currency: config.currency }, signed: { idempotencyKey: input.key } }),
  staticQr: (key: string) => api<AgentQr>('/agent/v1/qr/create', { body: { kind: 'agent_static' }, signed: { idempotencyKey: key } }),
  qr: (id: string) => api<AgentQr>(`/agent/v1/qr/${id}`),
  scanQr: (payload: string) => api<ScanResult>('/agent/v1/qr/scan', { body: { payload } }),
  commissionSummary: () => api<CommissionSummary>('/agent/v1/commissions/summary'),
  commissions: (params: { cursor?: string | null; limit?: number } = {}) => {
    const q = new URLSearchParams({ limit: String(params.limit ?? 20) });
    if (params.cursor) q.set('cursor', params.cursor);
    return api<{ data: CommissionLine[]; next_cursor: string | null }>(`/agent/v1/commissions?${q.toString()}`);
  },

  notifications: (cursor?: string | null) => api<NotificationPage>(`/agent/v1/notifications?limit=20${cursor ? `&cursor=${cursor}` : ''}`),
  unreadCount: () => api<{ unread_count: number }>('/agent/v1/notifications/unread-count'),
  readNotification: (id: string) => api<{ unread_count: number }>(`/agent/v1/notifications/${id}/read`, { method: 'POST' }),
  readAllNotifications: () => api<{ unread_count: number }>('/agent/v1/notifications/read-all', { method: 'POST' }),

  unlock: (input: { key: string; stepUp: StepUp; prompt: string }) =>
    api<{ unlocked: true }>('/agent/v1/security/unlock', { body: {}, signed: { idempotencyKey: input.key, stepUp: input.stepUp, biometricPrompt: input.prompt } }),
  reportIntegrity: (integrity: { rooted: boolean; emulator: boolean }) => api<{ compromised: boolean }>('/agent/v1/security/device-integrity', { body: integrity }),
  registerPushToken: (token: string) => api<{ registered: boolean }>('/agent/v1/push-tokens', { body: { token } }),
  notificationPreferences: () => api<{ data: { type: string; push_enabled: boolean; locked: boolean }[] }>('/agent/v1/notifications/preferences'),
  setNotificationPreferences: (preferences: Record<string, boolean>) =>
    api<{ data: { type: string; push_enabled: boolean; locked: boolean }[] }>('/agent/v1/notifications/preferences', { method: 'PUT', body: { preferences } }),

  securityOverview: () => api<SecurityOverview>('/agent/v1/security/overview'),
  devices: () => api<{ data: DeviceInfo[] }>('/agent/v1/security/devices'),
  sessions: () => api<{ data: SessionInfo[] }>('/agent/v1/security/sessions'),
  accessHistory: (cursor?: string | null) => api<{ data: AccessEvent[]; next_cursor: string | null }>(`/agent/v1/security/access-history?limit=20${cursor ? `&cursor=${cursor}` : ''}`),
  revokeOtherSessions: (input: { key: string; stepUp: StepUp; prompt: string }) =>
    api<{ revoked: number }>('/agent/v1/security/sessions/revoke-others', { body: {}, signed: { idempotencyKey: input.key, stepUp: input.stepUp, biometricPrompt: input.prompt } }),
  revokeDevice: (input: { deviceId: string; key: string; stepUp: StepUp; prompt: string }) =>
    api<{ revoked: true; sessions_revoked: number }>(`/agent/v1/security/devices/${input.deviceId}`, {
      method: 'DELETE',
      body: {},
      signed: { idempotencyKey: input.key, stepUp: input.stepUp, biometricPrompt: input.prompt }
    }),
  changePin: (input: { currentPin: string; newPin: string; key: string }) =>
    api<{ changed: true; other_sessions_revoked: number }>('/agent/v1/security/pin/change', { body: { current_pin: input.currentPin, new_pin: input.newPin }, signed: { idempotencyKey: input.key } }),

  cancel: (id: string) => api<{ transaction: Transaction }>(`/agent/v1/transactions/${id}/cancel`, { method: 'POST' }),

  /** Development only: simulates the customer confirming in the BataPay app. */
  devConfirmDeposit: (transactionId: string) => api<{ result: string }>('/dev/deposits/confirm', { body: { agent_transaction_id: transactionId }, auth: false }),
  /** Development only: simulates a customer paying a collect QR in the BataPay app. */
  devPayQr: (payload: string) => api<{ result: string }>('/dev/qr/pay', { body: { payload }, auth: false })
};
