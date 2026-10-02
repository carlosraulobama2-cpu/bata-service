import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useSession } from '../state/session';

/** Background time after which the app asks for the PIN again. */
export const LOCK_AFTER_MS = 3 * 60 * 1000;

/**
 * Locks the app when it comes back after LOCK_AFTER_MS in the background:
 * a phone left on the counter must not let someone else see balances or
 * operate. (A cold start is locked too, see bootSession.)
 */
export function useInactivityLock(): void {
  const since = useRef<number | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') since.current = Date.now();
      else if (state === 'active' && since.current !== null) {
        if (Date.now() - since.current >= LOCK_AFTER_MS) useSession.getState().setLocked(true);
        since.current = null;
      }
    });
    return () => sub.remove();
  }, []);
}
