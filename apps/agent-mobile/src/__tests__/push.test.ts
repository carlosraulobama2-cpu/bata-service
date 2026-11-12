jest.mock('expo-notifications', () => ({}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-constants', () => ({ expoConfig: {} }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'x', getRandomBytes: () => new Uint8Array(32) }));
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-local-authentication', () => ({}));

import { routeForNotification } from '../features/push';

describe('tapping a push', () => {
  it('opens the operation when there is one, else the screen for its type, else the inbox', () => {
    // What the Velynt worker sends (backend/jobs.py): notification_id, type, transfer_id.
    expect(routeForNotification({ notification_id: 'n1', type: 'cash_in', transfer_id: '0b8e2c1a-5f7d-4e3b-9a1c-2d3e4f5a6b7c' })).toBe('/transaction/0b8e2c1a-5f7d-4e3b-9a1c-2d3e4f5a6b7c');
    expect(routeForNotification({ notification_id: 'n2', type: 'agent_low_float', transfer_id: null })).toBe('/float-request'); // its screen: ask Velynt for float
    expect(routeForNotification({ type: 'agent_document_rejected', transfer_id: null })).toBe('/verification');
    expect(routeForNotification({ type: 'something_new', transfer_id: null })).toBe('/notifications');
    expect(routeForNotification({ transfer_id: '../../evil' })).toBe('/notifications');
    expect(routeForNotification(undefined)).toBe('/notifications');
  });
});
