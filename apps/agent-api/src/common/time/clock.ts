/** Injectable clock so tests can control time. */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

/** Calendar day (YYYY-MM-DD) and month start in the operating time zone. */
export function operatingPeriods(at: Date, timeZone: string): { day: string; monthStart: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return { day: `${parts.year}-${parts.month}-${parts.day}`, monthStart: `${parts.year}-${parts.month}-01` };
}
