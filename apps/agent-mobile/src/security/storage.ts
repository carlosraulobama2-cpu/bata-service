import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Secrets (refresh token, device private key) live in the OS keystore via
 * expo-secure-store (Android Keystore / iOS Keychain), readable only by
 * this app and only on this device.
 *
 * The web build is for UI development only: values are kept in memory and
 * disappear on reload. Operations from web are not a supported channel
 * (docs/01-arquitectura.md §5).
 */
const memory = new Map<string, string>();
const isWeb = Platform.OS === 'web';

const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const secureStorage = {
  async get(key: string): Promise<string | null> {
    if (isWeb) return memory.get(key) ?? null;
    return SecureStore.getItemAsync(key, OPTIONS);
  },
  async set(key: string, value: string): Promise<void> {
    if (isWeb) {
      memory.set(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value, OPTIONS);
  },
  async remove(key: string): Promise<void> {
    if (isWeb) {
      memory.delete(key);
      return;
    }
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
  deviceId: 'bs.device_id',
  installationId: 'bs.installation_id',
  deviceKey: 'bs.device_key',
  biometricKey: 'bs.biometric_key',
  phone: 'bs.phone'
} as const;
