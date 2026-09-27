import { formatRelative } from '../utils/format';
import { isAcceptablePin } from '../utils/pin';

describe('PIN rules (mirror of the server)', () => {
  it.each(['482913', '739251', '102938'])('accepts %s', (pin) => expect(isAcceptablePin(pin)).toBe(true));
  it.each(['111111', '123456', '654321', '890123', '12345', 'abcdef'])('rejects %s', (pin) => expect(isAcceptablePin(pin)).toBe(false));
});

describe('relative time', () => {
  const t = (key: string, opts?: Record<string, unknown>) => `${key}:${opts?.count ?? ''}`;
  const now = new Date('2026-09-26T12:00:00Z');
  it('is human for recent items and exact for older ones', () => {
    expect(formatRelative('2026-09-26T11:59:40Z', t, now)).toBe('notifications.justNow:');
    expect(formatRelative('2026-09-26T11:35:00Z', t, now)).toBe('notifications.minutesAgo:25');
    expect(formatRelative('2026-09-26T09:00:00Z', t, now)).toBe('notifications.hoursAgo:3');
    expect(formatRelative('2026-09-24T09:00:00Z', t, now)).toBe('24/09/2026 · 10:00');
  });
});
