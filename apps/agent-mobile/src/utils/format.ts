import { formatMoney } from '@velynt/money';
import { config } from '../config';

export const money = (amount: number, opts: { sign?: boolean } = {}) => formatMoney(amount, config.currency, opts);

const dateFmt = new Intl.DateTimeFormat('es-ES', { timeZone: config.timeZone, day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('es-ES', { timeZone: config.timeZone, hour: '2-digit', minute: '2-digit', hour12: false });

/** "26/09/2026" */
export const formatDate = (iso: string | Date) => dateFmt.format(new Date(iso));
/** "10:42" */
export const formatTime = (iso: string | Date) => timeFmt.format(new Date(iso));
/** "26/09/2026 · 10:42" */
export const formatDateTime = (iso: string | Date) => `${formatDate(iso)} · ${formatTime(iso)}`;

/** Seconds -> "4:05" */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Hour in the operating time zone, for the greeting. */
export function localHour(now = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: config.timeZone, hour: '2-digit', hour12: false }).format(now)) % 24;
}

/** Keeps digits only, groups for display: "222000001" -> "222 000 001". */
export function groupDigits(value: string, size = 3): string {
  return value.replace(/\D/g, '').replace(new RegExp(`(\\d{${size}})(?=\\d)`, 'g'), '$1 ');
}

/** Thousands with dots, from the right, for amounts being typed: "1500000" -> "1.500.000". */
export function groupThousands(value: string): string {
  return value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** "Ahora mismo" / "Hace 5 min" / "Hace 3 h" for today's items, date + time otherwise. */
export function formatRelative(iso: string, t: (key: string, opts?: Record<string, unknown>) => string, now = new Date()): string {
  const diffMin = Math.floor((now.getTime() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return t('notifications.justNow');
  if (diffMin < 60) return t('notifications.minutesAgo', { count: diffMin });
  if (diffMin < 12 * 60 && formatDate(iso) === formatDate(now)) return t('notifications.hoursAgo', { count: Math.floor(diffMin / 60) });
  return formatDateTime(iso);
}

/** "+240333000111" -> "+240 333 000 111" (Equatorial Guinea); other numbers as they are. */
export function formatPhone(e164: string): string {
  const m = /^\+240(\d{9})$/.exec(e164);
  return m ? `+240 ${groupDigits(m[1]!)}` : e164;
}
