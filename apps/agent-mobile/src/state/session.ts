import { create } from 'zustand';

/**
 * Session state kept in memory. The access token never touches disk; the
 * refresh token lives in the OS keystore (see api/auth.ts).
 */
export type SessionStatus = 'booting' | 'signedOut' | 'signedIn';

interface SessionState {
  status: SessionStatus;
  accessToken: string | null;
  deviceId: string | null;
  biometricEnabled: boolean;
  /** Carried between the phone → PIN → OTP login screens. */
  pendingLogin: { phone: string; challengeId?: string; destination?: string } | null;
  setSignedIn: (accessToken: string, deviceId: string | null) => void;
  setAccessToken: (token: string) => void;
  setSignedOut: () => void;
  setPendingLogin: (p: SessionState['pendingLogin']) => void;
  setBiometricEnabled: (v: boolean) => void;
}

export const useSession = create<SessionState>((set) => ({
  status: 'booting',
  accessToken: null,
  deviceId: null,
  biometricEnabled: false,
  pendingLogin: null,
  setSignedIn: (accessToken, deviceId) => set({ status: 'signedIn', accessToken, deviceId, pendingLogin: null }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setSignedOut: () => set({ status: 'signedOut', accessToken: null, pendingLogin: null }),
  setPendingLogin: (pendingLogin) => set({ pendingLogin }),
  setBiometricEnabled: (biometricEnabled) => set({ biometricEnabled })
}));
