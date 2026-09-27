/** Public, non-secret configuration only. Anything EXPO_PUBLIC_* ends up in the app bundle. */
export const config = {
  apiBaseUrl: (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  appVersion: '1.0.0',
  currency: 'XAF' as const,
  timeZone: 'Africa/Malabo',
  /** Development helpers (simulated customer actions). Never enabled in production builds. */
  devTools: process.env.EXPO_PUBLIC_DEV_TOOLS === 'true'
};
