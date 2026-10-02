import { config } from '../config';
import { forgetBiometricPin, hasBiometricPin } from '../security/biometrics';
import { KEYS, secureStorage } from '../security/storage';
import { useSession } from '../state/session';
import { forgetPushToken } from '../features/push';
import { endpoints } from './endpoints';

/** On app start: resume the session with the stored refresh token, if any. */
export async function bootSession(): Promise<void> {
  const refreshToken = await secureStorage.get(KEYS.refreshToken);
  if (!refreshToken) {
    useSession.getState().setSignedOut();
    return;
  }
  try {
    const res = await fetch(`${config.apiBaseUrl}/agent/v1/auth/refresh`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    if (!res.ok) {
      // The session ended (signed in on another phone, expired, revoked): sign in again.
      await secureStorage.remove(KEYS.refreshToken);
      useSession.getState().setSignedOut();
      return;
    }
    const data = (await res.json()) as { token: string; refresh_token: string };
    await secureStorage.set(KEYS.refreshToken, data.refresh_token);
    useSession.getState().setBiometricEnabled(await hasBiometricPin());
    // Resuming a saved session on app start: someone else may be holding the phone.
    useSession.getState().setSignedIn(data.token, { locked: true });
  } catch {
    // Offline at start: keep the refresh token and let the agent retry from the login screen.
    useSession.getState().setSignedOut();
  }
}

export async function rememberedEmail(): Promise<string | null> {
  return secureStorage.get(KEYS.email);
}

/**
 * Same Velynt account (email + password) as the customer app, but an agents-app session: the
 * agents API only accepts its own sessions, and only one per account (signing in here closes the
 * session on any other phone).
 */
export async function signIn(email: string, password: string): Promise<void> {
  const res = await endpoints.login({ email: email.trim().toLowerCase(), password });
  const previous = await secureStorage.get(KEYS.email);
  if (previous && previous !== res.user.email) await forgetBiometricPin(); // another account on this phone
  await secureStorage.set(KEYS.email, res.user.email);
  await secureStorage.set(KEYS.refreshToken, res.refresh_token);
  useSession.getState().setBiometricEnabled(await hasBiometricPin());
  useSession.getState().setSignedIn(res.token);
}

export async function signOut(): Promise<void> {
  await forgetPushToken().catch(() => undefined);
  await endpoints.logout().catch(() => undefined); // offline or already closed: sign out locally anyway
  await secureStorage.remove(KEYS.refreshToken);
  useSession.getState().setSignedOut();
}
