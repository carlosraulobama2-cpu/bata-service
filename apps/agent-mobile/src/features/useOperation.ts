import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, newIdempotencyKey } from '../api/client';
import type { StepUp, Transaction } from '../api/types';
import { errorMessage } from './errors';

/** Errors that keep the agent on the PIN sheet (they can try again right away). */
const RETRY_ON_SHEET = new Set(['wrong_pin', 'biometric_cancelled']);
const RECHECK_MS = 3000;

export type OperationPhase =
  | { kind: 'idle' }
  | { kind: 'confirming'; busy: boolean; error: string | null }
  | { kind: 'verifying' } // outcome unknown (network): never assume success
  | { kind: 'done'; tx: Transaction }
  | { kind: 'error'; message: string; code: string; details: Record<string, unknown> };

/**
 * Drives a money operation:
 *  - one Idempotency-Key per operation, reused for every retry of it;
 *  - wrong PIN / cancelled biometrics stay on the sheet;
 *  - a network error moves to "verifying" and sends the SAME request (same key, same PIN) again
 *    until the server answers: the agents API returns the operation that already happened instead
 *    of moving money twice, so the app never shows success without the server.
 */
export function useOperation(send: (key: string, stepUp: StepUp) => Promise<{ transaction: Transaction }>) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<OperationPhase>({ kind: 'idle' });
  const keyRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const stopRechecking = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  useEffect(
    () => () => {
      alive.current = false;
      stopRechecking();
    },
    []
  );

  const finish = useCallback(
    (tx: Transaction) => {
      stopRechecking();
      void qc.invalidateQueries();
      setPhase({ kind: 'done', tx });
    },
    [qc]
  );

  const fail = (err: unknown) => {
    keyRef.current = null; // definite answer: a new attempt is a new operation
    setPhase({ kind: 'error', message: errorMessage(err, t), code: err instanceof ApiError ? err.code : 'server_error', details: err instanceof ApiError ? err.details : {} });
  };

  const attempt = async (stepUp: StepUp): Promise<void> => {
    try {
      finish((await send(keyRef.current!, stepUp)).transaction);
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof ApiError && (err.isNetwork || err.status >= 500)) {
        setPhase({ kind: 'verifying' });
        timerRef.current = setTimeout(() => void attempt(stepUp), RECHECK_MS);
        return;
      }
      if (err instanceof ApiError && RETRY_ON_SHEET.has(err.code)) {
        setPhase({ kind: 'confirming', busy: false, error: err.code === 'biometric_cancelled' ? null : errorMessage(err, t) });
        return;
      }
      fail(err);
    }
  };

  const open = () => {
    keyRef.current ??= newIdempotencyKey();
    setPhase({ kind: 'confirming', busy: false, error: null });
  };

  const submit = async (stepUp: StepUp) => {
    setPhase({ kind: 'confirming', busy: true, error: null });
    await attempt(stepUp);
  };

  const reset = () => {
    stopRechecking();
    keyRef.current = null;
    setPhase({ kind: 'idle' });
  };

  const closeSheet = () => setPhase((p) => (p.kind === 'confirming' && !p.busy ? { kind: 'idle' } : p));

  return { phase, open, submit, reset, closeSheet };
}
