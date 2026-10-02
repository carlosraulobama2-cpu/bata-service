import type { AgentTransaction } from '../../common/db/schema';

const NEXT_ACTION: Record<string, Record<string, string>> = {
  cash_out: { completed: 'HAND_OVER_CASH', processing: 'WAIT_DO_NOT_HAND_OVER_CASH', pending: 'WAIT_DO_NOT_HAND_OVER_CASH' },
  cash_in: { pending: 'WAIT_CUSTOMER_CONFIRMATION', processing: 'WAIT', completed: 'KEEP_CASH' },
  qr_payment: { pending: 'WAIT_CUSTOMER_PAYMENT', processing: 'WAIT', completed: 'PAYMENT_RECEIVED' }
};

/** Public shape of an operation. Only masked customer data. */
export function presentTransaction(tx: AgentTransaction, agentCode: string) {
  return {
    id: tx.id,
    reference: tx.reference,
    type: tx.type,
    status: tx.status,
    status_reason: tx.status_reason,
    amount: tx.amount,
    currency: tx.currency,
    commission: tx.commission_amount,
    fee: tx.fee_amount,
    customer_masked: tx.customer_masked,
    agent_code: agentCode,
    method: tx.method,
    created_at: tx.created_at.toISOString(),
    completed_at: tx.completed_at?.toISOString() ?? null,
    expires_at: tx.expires_at?.toISOString() ?? null,
    next_action: NEXT_ACTION[tx.type]?.[tx.status] ?? null
  };
}
