jest.mock('expo-crypto', () => ({ randomUUID: () => 'x', getRandomBytes: () => new Uint8Array(32) }));
jest.mock('expo-secure-store', () => ({}));

import i18n from '../i18n';
import { problemMessage } from '../features/support';

describe('message to support', () => {
  const t = i18n.t.bind(i18n) as (key: string, opts?: Record<string, unknown>) => string;

  it('identifies the agent and the operation, with no customer data', () => {
    const msg = problemMessage(t, 'AG-000001', { reference: 'BTX-00000004', type: 'cash_out', amount: 50000, status: 'completed', created_at: '2026-09-27T14:22:00Z' });
    expect(msg).toBe('Hola, soy el agente AG-000001 de BATA SERVICES. Tengo un problema con la operación BTX-00000004 (Retiro, 50.000 XAF, 27/09/2026 · 15:22, estado: Completada). Lo que pasó: ');
    expect(msg).not.toMatch(/\*\*\*\*|\+240/);
  });

  it('works without an operation or before signing in', () => {
    expect(problemMessage(t, '')).toBe('Hola, soy el agente — de BATA SERVICES. Necesito ayuda con: ');
  });
});
