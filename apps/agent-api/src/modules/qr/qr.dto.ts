import { z } from 'zod';

export const QrCreateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('collect'), amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), currency: z.literal('XAF') }),
  z.object({ kind: z.literal('agent_static') })
]);

export const QrScanSchema = z.object({ payload: z.string().min(6).max(500) });
