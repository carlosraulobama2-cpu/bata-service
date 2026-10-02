export type Period = 'today' | 'yesterday' | 'last_7_days' | 'this_month';

/** Africa/Malabo (config.timeZone) is UTC+1 all year: no daylight saving. */
const OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Start of the agent's local day (Africa/Malabo) that contains `now`, as a UTC instant. */
export function startOfLocalDay(now: Date): Date {
  const local = now.getTime() + OFFSET_MS;
  return new Date(local - (local % DAY_MS) - OFFSET_MS);
}

/**
 * The `since`/`until` the agents API filters by, in the agent's days (not UTC): "today" starts at
 * 00:00 in Malabo. `until` is exclusive; null means "up to now".
 */
export function periodRange(period: Period, now = new Date()): { since: string; until: string | null } {
  const today = startOfLocalDay(now);
  switch (period) {
    case 'today':
      return { since: today.toISOString(), until: null };
    case 'yesterday':
      return { since: new Date(today.getTime() - DAY_MS).toISOString(), until: today.toISOString() };
    case 'last_7_days':
      return { since: new Date(today.getTime() - 6 * DAY_MS).toISOString(), until: null };
    case 'this_month': {
      const local = new Date(today.getTime() + OFFSET_MS); // midnight local, read with UTC getters
      const first = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - OFFSET_MS;
      return { since: new Date(first).toISOString(), until: null };
    }
  }
}
