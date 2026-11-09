import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { Me } from '../api/types';
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
  const qc = useQueryClient();
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') since.current = Date.now();
      else if (state === 'active' && since.current !== null) {
        // Only with a payment PIN: without one there is nothing to unlock with.
        const hasPin = qc.getQueryData<Me>(['me'])?.user.has_pin;
        if (Date.now() - since.current >= LOCK_AFTER_MS && hasPin) useSession.getState().setLocked(true);
        since.current = null;
      }
    });
    return () => sub.remove();
  }, [qc]);
}
