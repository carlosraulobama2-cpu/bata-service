import { formatRelative } from '../utils/format';
import { periodRange, startOfLocalDay } from '../utils/period';
import { isAcceptablePin } from '../utils/pin';

describe('PIN rules (mirror of velynt/backend/auth.py validate_new_pin)', () => {
  // 9012 is allowed by the server too: 9 -> 0 is not a step of one.
  it.each(['1357', '4829', '1029', '9012'])('accepts %s', (pin) => expect(isAcceptablePin(pin)).toBe(true));
  it.each(['1111', '1234', '4321', '0123', '6789', '123', '12345', 'abcd'])('rejects %s', (pin) => expect(isAcceptablePin(pin)).toBe(false));
});

describe('periods in the agent day (Africa/Malabo, UTC+1)', () => {
  it('starts "today" at midnight in Malabo, not in UTC', () => {
    // 23:30 UTC on the 1st is already 00:30 on the 2nd in Malabo.
    expect(startOfLocalDay(new Date('2026-10-01T23:30:00Z')).toISOString()).toBe('2026-10-01T23:00:00.000Z');
    expect(startOfLocalDay(new Date('2026-10-01T22:30:00Z')).toISOString()).toBe('2026-09-30T23:00:00.000Z');
  });

  it('gives the since/until the agents API filters by', () => {
    const now = new Date('2026-10-02T10:00:00Z');
    expect(periodRange('today', now)).toEqual({ since: '2026-10-01T23:00:00.000Z', until: null });
    expect(periodRange('yesterday', now)).toEqual({ since: '2026-09-30T23:00:00.000Z', until: '2026-10-01T23:00:00.000Z' });
    expect(periodRange('last_7_days', now)).toEqual({ since: '2026-09-25T23:00:00.000Z', until: null });
    expect(periodRange('this_month', now)).toEqual({ since: '2026-09-30T23:00:00.000Z', until: null });
    // Early on the 1st of the month in Malabo (still the 31st in UTC)
    expect(periodRange('this_month', new Date('2026-10-31T23:30:00Z')).since).toBe('2026-10-31T23:00:00.000Z');
  });
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
