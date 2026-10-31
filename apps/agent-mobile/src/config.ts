/** Public, non-secret configuration only. Anything EXPO_PUBLIC_* ends up in the app bundle. */
const env = (value: string | undefined) => (value && value.trim() ? value.trim() : null);

/** Where the agents API runs in production: with the customers' API on Render (paths /agent/...). */
export const PRODUCTION_API = 'https://velynt.onrender.com';

export const config = {
  appName: 'VELYNT SERVICES',
  /**
   * The Velynt agents API. A build without EXPO_PUBLIC_API_BASE_URL used to point at localhost, which on a real phone is
   * the phone itself: the app could not sign in. Only a development build falls back to the local API on :8001
   * (Android emulator -> host machine: http://10.0.2.2:8001).
   */
  apiBaseUrl: (process.env.EXPO_PUBLIC_API_BASE_URL ?? (__DEV__ ? 'http://localhost:8001' : PRODUCTION_API)).replace(/\/$/, ''),
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
