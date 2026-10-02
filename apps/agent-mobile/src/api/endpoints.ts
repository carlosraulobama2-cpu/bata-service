import { periodRange, type Period } from '../utils/period';
import { api } from './client';
import type {
  CashPosition,
  FloatMovement,
  FloatRequest,
  NearbyAgent,
  Preferences,
  AgentProfile,
  AgentUser,
  AppNotification,
  CommissionSummary,
  Customer,
  Figures,
  Limits,
  Me,
  NotificationPage,
  BusinessProfileInput,
  Onboarding,
  VerificationDocument,
  StepUp,
  TopupPreview,
  Totals,
  Transaction,
  TransactionPage,
  TransactionType,
  WithdrawalPreview
} from './types';

export type { Period };

// ---- What the agents API returns (velynt/api-agente/agent_schemas.py) ----

interface AgentOut {
  id: string;
  code: string;
  business_name: string;
  city: string;
  address: string;
  status: AgentProfile['status'];
  status_note: string;
  daily_cash_in_limit_minor: number;
  daily_cash_out_limit_minor: number;
  level?: string;
  max_float_minor?: number;
  created_at: string;
}
interface OperationOut {
  id: string;
  reference: string;
  type: TransactionType;
  amount_minor: number;
  fee_minor: number;
  commission_minor: number;
  customer: Customer | null;
  agent_code: string;
  agent_name: string;
  created_at: string;
}
interface FiguresOut {
  count: number;
  volume_minor: number;
  commission_minor: number;
}
interface LoginOut {
  token: string;
  refresh_token: string;
  user: AgentUser;
  agent: AgentOut | null;
}
interface NotificationOut {
  id: string;
  type: string;
  title: string;
  body: string;
  related_operation_id: string | null;
  created_at: string;
  read_at: string | null;
}

interface CashOut {
  declared_minor: number | null;
  declared_at: string | null;
  cash_in_since_minor: number;
  cash_out_since_minor: number;
  expected_minor: number | null;
}
interface FloatRequestOut {
  id: string;
  code: string;
  amount_minor: number;
  reason: string;
  payment_reference: string;
  has_proof: boolean;
  status: FloatRequest['status'];
  decision_note: string;
  created_at: string;
  decided_at: string | null;
}
interface FloatMovementOut {
  id: string;
  code: string;
  kind: FloatMovement['kind'];
  label: string;
  direction: 'in' | 'out';
  amount_minor: number;
  reason: string;
  other_agent: { code: string; business_name: string } | null;
  created_at: string;
}
interface CustomerOut {
  customer_id: string | null;
  name: string;
  phone_number: string | null;
  operations: number;
  deposits_minor: number;
  withdrawals_minor: number;
  last_at: string;
}

// ---- Into the app's shapes ----

const toCash = (c: CashOut): CashPosition => ({
  declared: c.declared_minor,
  declared_at: c.declared_at,
  cash_in_since: c.cash_in_since_minor,
  cash_out_since: c.cash_out_since_minor,
  expected: c.expected_minor
});
const toFloatRequest = (r: FloatRequestOut): FloatRequest => ({ ...r, amount: r.amount_minor });
const toMovement = (m: FloatMovementOut): FloatMovement => ({ ...m, amount: m.amount_minor });

/** "María N. O. · +240 •••• 4821": the masked name and phone the server gives, nothing else. */
export const maskedCustomer = (c: Customer | null): string | null => (c ? [c.name, c.phone_number].filter(Boolean).join(' · ') : null);

const toAgent = (a: AgentOut): AgentProfile => ({
  id: a.id,
  code: a.code,
  business_name: a.business_name,
  city: a.city,
  address: a.address,
  status: a.status,
  status_note: a.status_note,
  daily_cash_in_limit: a.daily_cash_in_limit_minor,
  daily_cash_out_limit: a.daily_cash_out_limit_minor,
  level: a.level ?? '1',
  max_float: a.max_float_minor ?? 0,
  created_at: a.created_at
});

export const toTransaction = (o: OperationOut): Transaction => ({
  id: o.id,
  reference: o.reference,
  type: o.type,
  status: 'completed',
  amount: o.amount_minor,
  fee: o.fee_minor,
  commission: o.commission_minor,
  customer: o.customer,
  customer_masked: maskedCustomer(o.customer),
  agent_code: o.agent_code,
  agent_name: o.agent_name,
  created_at: o.created_at
});

const toFigures = (f: FiguresOut): Figures => ({ count: f.count, volume: f.volume_minor, commission: f.commission_minor });

const toNotification = (n: NotificationOut): AppNotification => n;

/** Money operations: the payment PIN (typed or via biometrics) and one Idempotency-Key per operation. */
type MoneyInput = { key: string; stepUp: StepUp; prompt: string };
const money = (input: MoneyInput) => ({ idempotencyKey: input.key, stepUp: input.stepUp, biometricPrompt: input.prompt });

const operation = (p: Promise<{ operation: OperationOut }>) => p.then((r) => ({ transaction: toTransaction(r.operation) }));

async function operationsPage(params: { since?: string | null; until?: string | null; type?: TransactionType; limit: number; offset?: number }) {
  const q = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset ?? 0) });
  if (params.type) q.set('type', params.type);
  if (params.since) q.set('since', params.since);
  if (params.until) q.set('until', params.until);
  const page = await api<{ operations: OperationOut[]; pagination: { limit: number; offset: number; total: number }; totals: { cash_in: FiguresOut; cash_out: FiguresOut } }>(
    `/agent/v1/operations?${q.toString()}`
  );
  const totals: Totals = {
    cash_in: toFigures(page.totals.cash_in),
    cash_out: toFigures(page.totals.cash_out),
    commission: page.totals.cash_in.commission_minor + page.totals.cash_out.commission_minor
  };
  const next = page.pagination.offset + page.operations.length;
  return { data: page.operations.map(toTransaction), totals, next_offset: next < page.pagination.total ? next : null } satisfies TransactionPage;
}

export const endpoints = {
  login: (body: { email: string; password: string }) => api<LoginOut>('/agent/v1/auth/login', { body, auth: false }),
  logout: () => api<{ ok: boolean }>('/agent/v1/auth/logout', { method: 'POST' }),

  me: async (): Promise<Me> => {
    const r = await api<{ user: AgentUser; agent: AgentOut | null; float_minor: number; cash?: CashOut | null }>('/agent/v1/me');
    return { user: r.user, agent: r.agent ? toAgent(r.agent) : null, float: r.float_minor, cash: r.cash ? toCash(r.cash) : null, as_of: new Date().toISOString() };
  },

  // ---- Float, cash, transfers, customers ----
  floatRequests: () =>
    api<{ requests: FloatRequestOut[]; max_float_minor: number; float_minor: number }>('/agent/v1/float-requests').then((r) => ({
      requests: r.requests.map(toFloatRequest),
      max_float: r.max_float_minor,
      float: r.float_minor
    })),
  requestFloat: (body: { amount: number; reason: string; payment_reference: string }) =>
    api<{ request: FloatRequestOut }>('/agent/v1/float-requests', { body: { amount_minor: body.amount, reason: body.reason, payment_reference: body.payment_reference } }).then((r) =>
      toFloatRequest(r.request)
    ),
  uploadFloatProof: (id: string, photo: { uri: string; mimeType?: string | null; fileName?: string | null }) => {
    const form = new FormData();
    form.append('file', { uri: photo.uri, name: photo.fileName || 'justificante.jpg', type: photo.mimeType || 'image/jpeg' } as unknown as Blob);
    return api<{ request: FloatRequestOut }>(`/agent/v1/float-requests/${encodeURIComponent(id)}/proof`, { form, timeoutMs: 60000 }).then((r) => toFloatRequest(r.request));
  },
  cancelFloatRequest: (id: string) => api<{ request: FloatRequestOut }>(`/agent/v1/float-requests/${encodeURIComponent(id)}/cancel`, { method: 'POST' }).then((r) => toFloatRequest(r.request)),
  cash: () => api<CashOut>('/agent/v1/cash').then(toCash),
  countCash: (amount: number, note: string) =>
    api<{ difference_minor: number | null; position: CashOut }>('/agent/v1/cash-count', { body: { amount_minor: amount, note } }).then((r) => ({
      difference: r.difference_minor,
      position: toCash(r.position)
    })),
  lookupAgent: (code: string) => api<{ agent: { code: string; business_name: string; city: string } }>(`/agent/v1/agents/lookup?code=${encodeURIComponent(code)}`).then((r) => r.agent),
  transferToAgent: (input: MoneyInput & { toAgentCode: string; amount: number; reason: string }) =>
    api<{ movement: FloatMovementOut; float_minor: number }>('/agent/v1/transfers', {
      body: { to_agent_code: input.toAgentCode, amount_minor: input.amount, reason: input.reason },
      money: money(input)
    }).then((r) => ({ movement: toMovement(r.movement), float: r.float_minor })),
  floatMovements: () => api<{ movements: FloatMovementOut[] }>('/agent/v1/float-movements').then((r) => r.movements.map(toMovement)),
  customers: (offset = 0) =>
    api<{ customers: CustomerOut[]; next_offset: number | null }>(`/agent/v1/customers?limit=30&offset=${offset}`).then((r) => ({
      customers: r.customers.map((c) => ({ ...c, deposits: c.deposits_minor, withdrawals: c.withdrawals_minor })),
      next_offset: r.next_offset
    })),
  nearbyAgents: () => api<{ agents: NearbyAgent[] }>('/agent/v1/nearby-agents').then((r) => r.agents),
  stats: (days: number) =>
    api<{ days: { date: string; cash_in: FiguresOut; cash_out: FiguresOut; commission_minor: number }[] }>(`/agent/v1/stats?days=${days}`).then((r) =>
      r.days.map((d) => ({ date: d.date, cash_in: toFigures(d.cash_in), cash_out: toFigures(d.cash_out), commission: d.commission_minor }))
    ),

  // ---- Photo and settings ----
  preferences: () => api<{ preferences: Preferences }>('/agent/v1/me/preferences').then((r) => r.preferences),
  savePreferences: (change: Partial<Preferences>) => api<{ preferences: Preferences }>('/agent/v1/me/preferences', { method: 'PUT', body: change }).then((r) => r.preferences),
  uploadAvatar: (photo: { uri: string; mimeType?: string | null; fileName?: string | null }) => {
    const form = new FormData();
    form.append('file', { uri: photo.uri, name: photo.fileName || 'perfil.jpg', type: photo.mimeType || 'image/jpeg' } as unknown as Blob);
    return api<{ has_avatar: boolean; avatar_version: number | null }>('/agent/v1/me/avatar', { method: 'PUT', form, timeoutMs: 60000 });
  },
  removeAvatar: () => api<{ has_avatar: boolean; avatar_version: number | null }>('/agent/v1/me/avatar', { method: 'DELETE' }),
  /** Ask to become an agent (needs a verified identity in the Velynt app). */
  apply: (body: { business_name: string; city: string; address: string }) => api<{ agent: AgentOut }>('/agent/v1/apply', { body }).then((r) => toAgent(r.agent)),

  /** Reinforced agent verification: what is missing, the business data and the photos. */
  onboarding: () => api<Onboarding>('/agent/v1/onboarding'),
  saveBusinessProfile: (body: BusinessProfileInput) => api<Onboarding>('/agent/v1/onboarding/profile', { method: 'PUT', body }),
  uploadDocument: (kind: string, photo: { uri: string; mimeType?: string | null; fileName?: string | null }) => {
    const form = new FormData();
    form.append('kind', kind);
    // React Native's FormData takes a file as { uri, name, type }.
    form.append('file', { uri: photo.uri, name: photo.fileName || `${kind}.jpg`, type: photo.mimeType || 'image/jpeg' } as unknown as Blob);
    return api<{ document: VerificationDocument }>('/agent/v1/onboarding/documents', { form, timeoutMs: 60000 }).then((r) => r.document);
  },

  /** Create or change the payment PIN; the account password proves it is the owner. */
  setPin: (body: { password: string; pin: string }) => api<{ ok: boolean }>('/agent/v1/pin', { body }),
  /** Opens the locked app: the server checks the PIN with the same wrong-PIN counter as payments. */
  unlock: (input: { stepUp: StepUp; prompt: string }) => api<{ ok: boolean }>('/agent/v1/unlock', { method: 'POST', money: { stepUp: input.stepUp, biometricPrompt: input.prompt } }),

  limits: async (): Promise<Limits> => {
    const s = await api<{ limits: { daily_cash_in_limit_minor: number; daily_cash_out_limit_minor: number; cash_in_used_today_minor: number; cash_out_used_today_minor: number } }>(
      '/agent/v1/stats?days=1'
    );
    const view = (operation_type: TransactionType, max: number, used: number) => ({ operation_type, daily: { max, used, remaining: Math.max(0, max - used) } });
    return {
      limits: [
        view('cash_in', s.limits.daily_cash_in_limit_minor, s.limits.cash_in_used_today_minor),
        view('cash_out', s.limits.daily_cash_out_limit_minor, s.limits.cash_out_used_today_minor)
      ]
    };
  },

  transactions: (params: { period: Period; type?: TransactionType; limit?: number; offset?: number }) =>
    operationsPage({ ...periodRange(params.period), type: params.type, limit: params.limit ?? 20, offset: params.offset }),
  transaction: (id: string) => operation(api(`/agent/v1/operations/${encodeURIComponent(id)}`)),

  /** Before a deposit: the customer's masked name, to confirm out loud that it is them. */
  lookupCustomer: (who: { phone: string } | { customerId: string }) => {
    const q = 'phone' in who ? `phone_number=${encodeURIComponent(who.phone)}` : `customer_id=${encodeURIComponent(who.customerId)}`;
    return api<{ customer: Customer }>(`/agent/v1/customers/lookup?${q}`).then((r) => r.customer);
  },
  cashIn: (input: MoneyInput & { customer: { phone: string } | { customerId: string }; amount: number }) =>
    operation(
      api('/agent/v1/cash-in/direct', {
        body: { ...('phone' in input.customer ? { phone_number: input.customer.phone } : { customer_id: input.customer.customerId }), amount_minor: input.amount },
        money: money(input)
      })
    ),
  /** The customer's top-up QR (created in their Velynt app): who and how much. */
  resolveTopup: (qr: string) =>
    api<{ topup: { id: string; amount_minor: number; expires_at: string }; customer: Customer }>('/agent/v1/cash-in/resolve', { body: { qr } }).then(
      (r): TopupPreview => ({ topup_id: r.topup.id, amount: r.topup.amount_minor, expires_at: r.topup.expires_at, customer: r.customer, customer_masked: maskedCustomer(r.customer)! })
    ),
  completeTopup: (input: MoneyInput & { topupId: string }) => operation(api(`/agent/v1/cash-in/topups/${encodeURIComponent(input.topupId)}`, { method: 'POST', money: money(input) })),

  /** The customer's withdrawal: by its QR, or by their phone number + the 6-digit code. */
  resolveWithdrawal: (by: { qr: string } | { phone: string; code: string }) =>
    api<{ cashout: { id: string; amount_minor: number; fee_minor: number; expires_at: string }; customer: Customer; code: string }>('/agent/v1/cash-out/resolve', {
      body: 'qr' in by ? { qr: by.qr } : { phone_number: by.phone, code: by.code }
    }).then(
      (r): WithdrawalPreview => ({
        cashout_id: r.cashout.id,
        amount: r.cashout.amount_minor,
        fee: r.cashout.fee_minor,
        expires_at: r.cashout.expires_at,
        customer: r.customer,
        customer_masked: maskedCustomer(r.customer)!,
        code: r.code
      })
    ),
  cashOut: (input: MoneyInput & { cashoutId: string; code: string }) =>
    operation(api(`/agent/v1/cash-out/${encodeURIComponent(input.cashoutId)}/complete`, { body: { code: input.code }, money: money(input) })),

  /** What the agent earned (commissions are credited to the float at once, with each operation). */
  commissionSummary: async (): Promise<CommissionSummary> => {
    const totals = (period: Period) => operationsPage({ ...periodRange(period), limit: 1 }).then((p) => p.totals);
    const [today, week, month] = await Promise.all([totals('today'), totals('last_7_days'), totals('this_month')]);
    return {
      today: today.commission,
      last_7_days: week.commission,
      this_month: month.commission,
      by_type_this_month: (['cash_in', 'cash_out'] as const)
        .map((operation_type) => ({ operation_type, count: month[operation_type].count, amount: month[operation_type].commission }))
        .filter((r) => r.count > 0)
    };
  },

  notifications: async (offset = 0): Promise<NotificationPage> => {
    const r = await api<{ notifications: NotificationOut[]; unread_count: number; pagination: { offset: number; total: number } }>(`/agent/v1/notifications?limit=20&offset=${offset}`);
    const next = r.pagination.offset + r.notifications.length;
    return { data: r.notifications.map(toNotification), unread_count: r.unread_count, next_offset: next < r.pagination.total ? next : null };
  },
  unreadCount: () => api<{ unread_count: number }>('/agent/v1/notifications/unread-count'),
  readNotification: (id: string) => api<{ unread_count: number }>(`/agent/v1/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }),
  readAllNotifications: () => api<{ unread_count: number }>('/agent/v1/notifications/read-all', { method: 'POST' }),

  registerPushToken: (token: string, platform: string) => api<{ ok: boolean }>('/agent/v1/push-token', { body: { token, platform } }),
  unregisterPushToken: (token: string) => api<{ ok: boolean }>('/agent/v1/push-token', { method: 'DELETE', body: { token } })
};
