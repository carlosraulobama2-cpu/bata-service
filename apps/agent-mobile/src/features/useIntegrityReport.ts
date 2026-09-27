import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { endpoints } from '../api/endpoints';
import { checkIntegrity } from '../security/integrity';

/**
 * Reports the phone's integrity when the app starts and each time it comes
 * back to the foreground; refreshes /me when the server's verdict changes
 * (the screens enable or disable operations from it).
 */
export function useIntegrityReport(): void {
  const qc = useQueryClient();
  useEffect(() => {
    let last: boolean | null = null;
    const run = async () => {
      const integrity = await checkIntegrity();
      if (!integrity) return;
      const { compromised } = await endpoints.reportIntegrity(integrity);
      if (last !== null && last !== compromised) void qc.invalidateQueries({ queryKey: ['me'] });
      last = compromised;
    };
    void run().catch(() => undefined);
    const sub = AppState.addEventListener('change', (state) => state === 'active' && void run().catch(() => undefined));
    return () => sub.remove();
  }, [qc]);
}
