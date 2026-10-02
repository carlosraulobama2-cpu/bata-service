import { z } from 'zod';
import { AgentAuthSchema } from '../auth/auth.dto';

const amount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const CashOutResolveSchema = z.object({
  code: z.object({ type: z.enum(['qr', 'code']), value: z.string().min(6).max(200) })
});

export const CashOutSchema = z.object({
  withdrawal_request_id: z.string().min(4).max(100),
  amount,
  currency: z.literal('XAF'),
  agent_auth: AgentAuthSchema
});

export const CashInSchema = z.object({
  customer: z.object({ type: z.enum(['phone', 'token']), value: z.string().min(4).max(200) }),
  amount,
  currency: z.literal('XAF'),
  agent_auth: AgentAuthSchema,
  /** The agent confirmed it isn't a repeat of a recent identical deposit (after 409 POSSIBLE_DUPLICATE). */
  confirm_duplicate: z.boolean().optional()
});

export const ListTransactionsSchema = z.object({
  period: z.enum(['today', 'yesterday', 'last_7_days', 'this_month', 'custom']).default('today'),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional()
});
