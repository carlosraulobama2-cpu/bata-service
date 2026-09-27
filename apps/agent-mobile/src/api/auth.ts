import { Platform } from 'react-native';
import { config } from '../config';
import { biometricsAvailable } from '../security/biometrics';
import { clearDeviceKeys, createDeviceKeys, installationId, storeDeviceKeys } from '../security/device-keys';
import { checkIntegrity } from '../security/integrity';
import { KEYS, secureStorage } from '../security/storage';
import { useSession } from '../state/session';
import { api } from './client';
import { endpoints } from './endpoints';

async function deviceInfo() {
  const integrity = await checkIntegrity();
  return {
    ...(integrity ? { integrity } : {}),
    installation_id: await installationId(),
    platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
    model: String(Platform.constants && 'Model' in Platform.constants ? (Platform.constants as { Model?: string }).Model : Platform.OS),
    app_version: config.appVersion
  };
}

/** On app start: resume the session with the stored refresh token, if any. */
export async function bootSession(): Promise<void> {
  const [refreshToken, deviceId] = await Promise.all([secureStorage.get(KEYS.refreshToken), secureStorage.get(KEYS.deviceId)]);
  if (!refreshToken) {
    useSession.getState().setSignedOut();
    return;
  }
  try {
    const data = await api<{ access_token: string; refresh_token: string }>('/agent/v1/auth/refresh', { body: { refresh_token: refreshToken }, auth: false });
    await secureStorage.set(KEYS.refreshToken, data.refresh_token);
    useSession.getState().setBiometricEnabled(await biometricsAvailable());
    // Resuming a saved session on app start: someone else may be holding the phone.
    useSession.getState().setSignedIn(data.access_token, deviceId, { locked: true });
  } catch (err) {
    // Offline at start: keep the refresh token and let the user retry from login.
    if (!(err instanceof Error && err.message === 'NETWORK_OFFLINE')) await secureStorage.remove(KEYS.refreshToken);
    useSession.getState().setSignedOut();
  }
}

export async function rememberedPhone(): Promise<string | null> {
  return secureStorage.get(KEYS.phone);
}

/** Step 2 of login. Returns 'otp' when this device still has to be verified. */
export async function submitPin(phone: string, pin: string): Promise<'signedIn' | 'otp'> {
  const res = await endpoints.login({ phone, pin, device: await deviceInfo() });
  await secureStorage.set(KEYS.phone, phone);
  if (res.status === 'authenticated') {
    await secureStorage.set(KEYS.refreshToken, res.refresh_token);
    useSession.getState().setBiometricEnabled(await biometricsAvailable());
    useSession.getState().setSignedIn(res.access_token, await secureStorage.get(KEYS.deviceId));
    return 'signedIn';
  }
  useSession.getState().setPendingLogin({ phone, challengeId: res.challenge_id, destination: res.destination_masked });
  return 'otp';
}

/** Step 3 (new device): verify the SMS code and register this device's keys. */
export async function verifyOtp(code: string): Promise<{ cooldownUntil: string | null }> {
  const pending = useSession.getState().pendingLogin;
  if (!pending?.challengeId) throw new Error('NO_PENDING_LOGIN');
  const keys = createDeviceKeys();
  const withBiometrics = await biometricsAvailable();
  const res = await endpoints.verifyOtp({
    challenge_id: pending.challengeId,
    code,
    device_keys: { device_public_key: keys.devicePublic, ...(withBiometrics ? { biometric_public_key: keys.biometricPublic } : {}) }
  });
  const { biometricEnabled } = await storeDeviceKeys(keys);
  await secureStorage.set(KEYS.refreshToken, res.refresh_token);
  await secureStorage.set(KEYS.deviceId, res.device.id);
  useSession.getState().setBiometricEnabled(withBiometrics && biometricEnabled);
  useSession.getState().setSignedIn(res.access_token, res.device.id);
  return { cooldownUntil: res.device.cooldown_until };
}

export async function signOut(): Promise<void> {
  await endpoints.logout().catch(() => undefined);
  await secureStorage.remove(KEYS.refreshToken);
  useSession.getState().setSignedOut();
}

/** Used when the server says this device is no longer trusted. */
export async function forgetDevice(): Promise<void> {
  await clearDeviceKeys();
  await secureStorage.remove(KEYS.deviceId);
  await secureStorage.remove(KEYS.refreshToken);
}
