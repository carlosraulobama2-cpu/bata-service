import { z } from 'zod';

export const DeviceInfoSchema = z.object({
  installation_id: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  platform: z.enum(['android', 'ios', 'web']),
  model: z.string().max(100).optional(),
  os_version: z.string().max(40).optional(),
  app_version: z.string().max(40).optional()
});

export const LoginSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/),
  pin: z.string().regex(/^\d{6}$/),
  device: DeviceInfoSchema
});

export const VerifyOtpSchema = z.object({
  challenge_id: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
  device_keys: z
    .object({
      device_public_key: z.record(z.string(), z.unknown()),
      biometric_public_key: z.record(z.string(), z.unknown()).optional()
    })
    .optional()
});

export const RefreshSchema = z.object({
  refresh_token: z.string().min(20).max(200)
});

export const AgentAuthSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('pin'), pin: z.string().regex(/^\d{6}$/) }),
  z.object({ method: z.literal('biometric'), signature: z.string().min(16).max(512) })
]);

export type AgentAuthInput = z.infer<typeof AgentAuthSchema>;
