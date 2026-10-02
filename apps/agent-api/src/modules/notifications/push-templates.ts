import { formatMoney, isCurrency } from '@velynt/money';

type Params = Record<string, unknown>;
type Template = { title: string; body: (p: Params) => string; channel: 'operations' | 'security' | 'general' };

const amount = (p: Params) => (typeof p.amount === 'number' ? formatMoney(p.amount, isCurrency(p.currency) ? p.currency : 'XAF') : '');
const ref = (p: Params) => (typeof p.reference === 'string' ? ` · ${p.reference}` : '');

/**
 * Spanish texts of the push messages, by i18n key (the same keys the app
 * uses for the in-app inbox). Other languages: add a map per
 * agent_profiles.preferred_language.
 */
const ES: Record<string, Template> = {
  'notif.cash_in_completed': { title: 'Depósito completado', body: (p) => `${amount(p)} ingresados al cliente${ref(p)}`, channel: 'operations' },
  'notif.cash_out_completed': { title: 'Retiro completado', body: (p) => `Entregaste ${amount(p)}${ref(p)}`, channel: 'operations' },
  'notif.qr_payment_completed': { title: 'Cobro QR recibido', body: (p) => `${amount(p)} ya están en tu saldo${ref(p)}`, channel: 'operations' },
  'notif.new_device_detected': { title: 'Nuevo dispositivo', body: () => 'Se ha iniciado sesión desde un teléfono nuevo. Si no fuiste tú, contacta con soporte.', channel: 'security' },
  'notif.pin_changed': { title: 'PIN cambiado', body: () => 'Tu PIN se cambió. Si no fuiste tú, contacta con soporte.', channel: 'security' }
};

export function renderPush(titleKey: string, params: Params): { title: string; body: string; channel: Template['channel'] } {
  const t = ES[titleKey.replace(/\.title$/, '')];
  if (!t) return { title: 'VELYNT SERVICES', body: 'Tienes un aviso nuevo.', channel: 'general' };
  return { title: t.title, body: t.body(params), channel: t.channel };
}

/** Types the agent may silence. Security and account types are always delivered. */
export const OPTIONAL_TYPES = ['cash_in_completed', 'cash_out_completed', 'qr_payment_completed', 'operation_pending', 'settlement_completed', 'kyc_document_expiring', 'limit_changed', 'support_reply'] as const;
export const MANDATORY_TYPES = ['new_device_detected', 'account_suspended', 'security_alert'] as const;
