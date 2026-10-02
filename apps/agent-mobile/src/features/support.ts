import { Linking } from 'react-native';
import type { Transaction } from '../api/types';
import { config } from '../config';
import { formatDateTime, money } from '../utils/format';

/** Support contacts come with the build (EXPO_PUBLIC_SUPPORT_*), so they work before signing in. */
export const supportContacts = () => config.support;

export const callSupport = (phone: string) => Linking.openURL(`tel:${phone}`);

/** Opens WhatsApp with the message already written. */
export const whatsappSupport = (number: string, text: string) => Linking.openURL(`https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`);

/**
 * What the agent sends about an operation: enough for support to find it
 * (agent ID + reference), never customer data, PINs or codes.
 */
export function problemMessage(t: (key: string, opts?: Record<string, unknown>) => string, agentCode: string, tx?: Pick<Transaction, 'reference' | 'type' | 'amount' | 'status' | 'created_at'>): string {
  if (!tx) return t('support.messageGeneral', { agent: agentCode || '—' });
  return t('support.messageOperation', {
    agent: agentCode || '—',
    reference: tx.reference,
    type: t(`types.${tx.type}`),
    amount: money(tx.amount),
    date: formatDateTime(tx.created_at),
    status: t(`status.${tx.status}`)
  });
}
