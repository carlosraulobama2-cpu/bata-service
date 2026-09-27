jest.mock('expo-notifications', () => ({}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-constants', () => ({ expoConfig: {} }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'x', getRandomBytes: () => new Uint8Array(32) }));
jest.mock('expo-secure-store', () => ({}));

import { routeForNotification } from '../features/push';

describe('tapping a push', () => {
  it('opens the operation when there is one, the inbox otherwise', () => {
    expect(routeForNotification({ transaction_id: '0b8e2c1a-5f7d-4e3b-9a1c-2d3e4f5a6b7c', type: 'cash_out_completed' })).toBe('/transaction/0b8e2c1a-5f7d-4e3b-9a1c-2d3e4f5a6b7c');
    expect(routeForNotification({ transaction_id: null, type: 'security_alert' })).toBe('/notifications');
    expect(routeForNotification({ transaction_id: '../../evil' })).toBe('/notifications');
    expect(routeForNotification(undefined)).toBe('/notifications');
  });
});
