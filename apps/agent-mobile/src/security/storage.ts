import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Secrets (refresh token, biometric-protected PIN) live in the OS keystore via
 * expo-secure-store (Android Keystore / iOS Keychain), readable only by
 * this app and only on this device.
 *
 * The web build has no keystore: values go to localStorage so a reload keeps the session
 * (the app still asks for the PIN on start when the agent has one, and signing out removes
 * the token). If localStorage is blocked (private window), they live in memory only.
 */
const memory = new Map<string, string>();
const isWeb = Platform.OS === 'web';

const web = {
  get(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? memory.get(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  },
  set(key: string, value: string): void {
    memory.set(key, value);
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* memory only */
    }
  },
  remove(key: string): void {
    memory.delete(key);
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* memory only */
    }
  }
};

const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const secureStorage = {
  async get(key: string): Promise<string | null> {
    if (isWeb) return web.get(key);
    return SecureStore.getItemAsync(key, OPTIONS);
  },
  async set(key: string, value: string): Promise<void> {
    if (isWeb) return web.set(key, value);
    await SecureStore.setItemAsync(key, value, OPTIONS);
  },
  async remove(key: string): Promise<void> {
    if (isWeb) return web.remove(key);
    await SecureStore.deleteItemAsync(key, OPTIONS);
  },
  /** Value that can only be read after a biometric check (native only). */
  async setBiometricProtected(key: string, value: string): Promise<boolean> {
    if (isWeb || !SecureStore.canUseBiometricAuthentication()) return false;
    await SecureStore.setItemAsync(key, value, { ...OPTIONS, requireAuthentication: true });
    return true;
  },
  async getBiometricProtected(key: string, prompt: string): Promise<string | null> {
    if (isWeb) return null;
    return SecureStore.getItemAsync(key, { ...OPTIONS, requireAuthentication: true, authenticationPrompt: prompt });
  },
  async removeBiometricProtected(key: string): Promise<void> {
    if (isWeb) return;
    await SecureStore.deleteItemAsync(key, { ...OPTIONS, requireAuthentication: true });
  }
};

export const KEYS = {
  refreshToken: 'bs.refresh_token',
  /** Payment PIN behind biometrics: fingerprint/face unlock it and the app sends it like a typed PIN. */
  biometricPin: 'bs.biometric_pin',
  /** Not secret: only says the biometric PIN exists, so the app can offer fingerprint/face. */
  biometricPinSet: 'bs.biometric_pin_set',
  email: 'bs.email'
} as const;
