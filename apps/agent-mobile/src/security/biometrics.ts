import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { KEYS, secureStorage } from './storage';

/** True when the phone has biometrics enrolled and the keystore can gate a key behind them. */
export async function biometricsAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const [hardware, enrolled] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]);
    return hardware && enrolled && SecureStore.canUseBiometricAuthentication();
  } catch {
    return false;
  }
}

/**
 * Keeps the payment PIN in the keystore behind biometrics, after the server accepted it. The server
 * always checks the same secret: fingerprint/face only unlock it on this phone.
 */
export async function rememberPinForBiometrics(pin: string): Promise<boolean> {
  if (!(await biometricsAvailable())) return false;
  try {
    const stored = await secureStorage.setBiometricProtected(KEYS.biometricPin, pin);
    if (stored) await secureStorage.set(KEYS.biometricPinSet, '1');
    return stored;
  } catch {
    return false;
  }
}

/** The PIN after a fingerprint/face check, or null (cancelled, not set up, biometrics changed). */
export async function pinFromBiometrics(prompt: string): Promise<string | null> {
  try {
    return await secureStorage.getBiometricProtected(KEYS.biometricPin, prompt);
  } catch {
    return null;
  }
}

/** Whether fingerprint/face can confirm on this phone (reading the PIN itself would prompt). */
export async function hasBiometricPin(): Promise<boolean> {
  return (await biometricsAvailable()) && (await secureStorage.get(KEYS.biometricPinSet)) === '1';
}

export async function forgetBiometricPin(): Promise<void> {
  await secureStorage.removeBiometricProtected(KEYS.biometricPin).catch(() => undefined);
  await secureStorage.remove(KEYS.biometricPinSet).catch(() => undefined);
}
