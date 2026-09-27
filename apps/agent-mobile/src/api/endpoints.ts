import { config } from '../config';
import { api } from './client';
import type { AgentQr, Balance, ScanResult, Limits, LoginResponse, Me, StepUp, Transaction, TransactionPage, WithdrawalPreview } from './types';

export type Period = 'today' | 'yesterday' | 'last_7_days' | 'this_month';

export const endpoints = {
  login: (body: { phone: string; pin: string; device: Record<string, string> }) => api<LoginResponse>('/agent/v1/auth/login', { body, auth: false }),
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
  cancel: (id: string) => api<{ transaction: Transaction }>(`/agent/v1/transactions/${id}/cancel`, { method: 'POST' }),

  /** Development only: simulates the customer confirming in the BataPay app. */
  devConfirmDeposit: (transactionId: string) => api<{ result: string }>('/dev/deposits/confirm', { body: { agent_transaction_id: transactionId }, auth: false }),
  /** Development only: simulates a customer paying a collect QR in the BataPay app. */
  devPayQr: (payload: string) => api<{ result: string }>('/dev/qr/pay', { body: { payload }, auth: false })
};
