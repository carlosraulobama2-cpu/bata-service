/** Public, non-secret configuration only. Anything EXPO_PUBLIC_* ends up in the app bundle. */
const env = (value: string | undefined) => (value && value.trim() ? value.trim() : null);

export const config = {
  appName: 'VELYNT SERVICES',
  /** The Velynt agents API (velynt/api-agente). Android emulator -> host machine: http://10.0.2.2:8001 */
  apiBaseUrl: (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8001').replace(/\/$/, ''),
  appVersion: '1.0.0',
  currency: 'XAF' as const,
  timeZone: 'Africa/Malabo',
  /** Support contacts shown in "Ayuda y soporte" (also before signing in); hidden while unset. */
  support: {
    phone: env(process.env.EXPO_PUBLIC_SUPPORT_PHONE),
    whatsapp: env(process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP),
    hours: env(process.env.EXPO_PUBLIC_SUPPORT_HOURS)
  }
};
