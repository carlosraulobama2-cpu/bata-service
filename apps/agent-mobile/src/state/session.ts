import { create } from 'zustand';

/**
 * Session state kept in memory. The access token never touches disk; the
 * refresh token lives in the OS keystore (see api/auth.ts).
 */
export type SessionStatus = 'booting' | 'signedOut' | 'signedIn';

interface SessionState {
  status: SessionStatus;
  accessToken: string | null;
  /** The payment PIN is kept behind biometrics on this phone, so fingerprint/face can confirm. */
  biometricEnabled: boolean;
  /** Signed in but the app is locked (after inactivity or a cold start): PIN/biometrics to continue. */
  locked: boolean;
  setSignedIn: (accessToken: string, options?: { locked?: boolean }) => void;
  setLocked: (locked: boolean) => void;
  setAccessToken: (token: string) => void;
  setSignedOut: () => void;
  setBiometricEnabled: (v: boolean) => void;
}

export const useSession = create<SessionState>((set) => ({
  status: 'booting',
  accessToken: null,
  biometricEnabled: false,
  locked: false,
  setSignedIn: (accessToken, options) => set({ status: 'signedIn', accessToken, locked: !!options?.locked }),
  setLocked: (locked) => set({ locked }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setSignedOut: () => set({ status: 'signedOut', accessToken: null, locked: false }),
  setBiometricEnabled: (biometricEnabled) => set({ biometricEnabled })
}));
