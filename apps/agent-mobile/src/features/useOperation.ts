import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, newIdempotencyKey } from '../api/client';
import { endpoints } from '../api/endpoints';
import type { StepUp, Transaction } from '../api/types';
import { errorMessage } from './errors';

/** Errors that keep the agent on the PIN sheet (they can try again right away). */
const RETRY_ON_SHEET = new Set(['PIN_INVALID', 'IDENTITY_NOT_VERIFIED', 'BIOMETRIC_CANCELLED', 'SIGNATURE_INVALID']);

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
 *  - a network error moves to "verifying" and polls the real state by
 *    key — the app never shows success without the server.
 */
export function useOperation(send: (key: string, stepUp: StepUp) => Promise<{ transaction: Transaction }>) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<OperationPhase>({ kind: 'idle' });
  const keyRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };
  useEffect(() => stopPolling, []);

  const finish = useCallback(
    (tx: Transaction) => {
      stopPolling();
      void qc.invalidateQueries();
      setPhase({ kind: 'done', tx });
    },
    [qc]
  );

  const startVerifying = useCallback(() => {
    setPhase({ kind: 'verifying' });
    stopPolling();
    const key = keyRef.current!;
    pollRef.current = setInterval(async () => {
      try {
        const { transaction } = await endpoints.transactionByKey(key);
        if (transaction.status !== 'processing') finish(transaction);
      } catch (err) {
        // 404: the request never reached the server -> safe to go back to confirming with the SAME key.
        if (err instanceof ApiError && err.code === 'NOT_FOUND') {
          stopPolling();
          setPhase({ kind: 'confirming', busy: false, error: t('errors.NETWORK_OFFLINE') });
        }
      }
    }, 2500);
  }, [finish, t]);

  const open = () => {
    keyRef.current ??= newIdempotencyKey();
    setPhase({ kind: 'confirming', busy: false, error: null });
  };

  const submit = async (stepUp: StepUp) => {
    setPhase({ kind: 'confirming', busy: true, error: null });
    try {
      const { transaction } = await send(keyRef.current!, stepUp);
      if (transaction.status === 'processing') {
        startVerifying();
        return;
      }
      finish(transaction);
    } catch (err) {
      if (err instanceof ApiError && err.isNetwork) return startVerifying();
      if (err instanceof ApiError && RETRY_ON_SHEET.has(err.code)) {
        setPhase({ kind: 'confirming', busy: false, error: err.code === 'BIOMETRIC_CANCELLED' ? null : errorMessage(err, t) });
        return;
      }
      if (err instanceof ApiError && err.code === 'OPERATION_IN_PROGRESS') return startVerifying();
      keyRef.current = null; // definite answer: a new attempt is a new operation
      setPhase({ kind: 'error', message: errorMessage(err, t), code: err instanceof ApiError ? err.code : 'INTERNAL_ERROR', details: err instanceof ApiError ? err.details : {} });
    }
  };

  const reset = () => {
    stopPolling();
    keyRef.current = null;
    setPhase({ kind: 'idle' });
  };

  const closeSheet = () => setPhase((p) => (p.kind === 'confirming' && !p.busy ? { kind: 'idle' } : p));

  return { phase, open, submit, reset, closeSheet };
}
