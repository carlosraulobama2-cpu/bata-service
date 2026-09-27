import { useQuery } from '@tanstack/react-query';
import { Linking } from 'react-native';
import { endpoints } from '../api/endpoints';
import type { Transaction } from '../api/types';
import { formatDateTime, money } from '../utils/format';

/** Support contacts come from the server (they work before signing in, too). */
export const usePublicConfig = () => useQuery({ queryKey: ['public-config'], queryFn: endpoints.publicConfig, staleTime: 10 * 60_000 });

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
