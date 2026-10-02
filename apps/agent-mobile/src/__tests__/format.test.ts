import { formatCountdown, formatDate, formatPhone, formatTime, groupDigits, groupThousands, money } from '../utils/format';

describe('format', () => {
  it('groups typed amounts in thousands from the right', () => {
    expect(groupThousands('1500000')).toBe('1.500.000');
    expect(groupThousands('15000')).toBe('15.000');
    expect(groupThousands('0950')).toBe('950');
    expect(groupThousands('')).toBe('');
  });

  it('formats XAF amounts with dot grouping, even for 4 digits', () => {
    expect(money(2450000)).toBe('2.450.000 XAF');
    expect(money(8500)).toBe('8.500 XAF');
    expect(money(500, { sign: true })).toBe('+500 XAF');
  });

  it('shows dates and times in Malabo time', () => {
    expect(formatDate('2026-09-26T23:30:00Z')).toBe('27/09/2026');
    expect(formatTime('2026-09-26T09:42:00Z')).toBe('10:42');
  });

  it('formats countdowns and phone digit groups', () => {
    expect(formatCountdown(245)).toBe('4:05');
    expect(formatCountdown(-3)).toBe('0:00');
    expect(groupDigits('222000001')).toBe('222 000 001');
    expect(groupDigits('22a2')).toBe('222');
  });
});

describe('formatPhone', () => {
  it('groups Equatorial Guinea numbers and leaves others as they are', () => {
    expect(formatPhone('+240333000111')).toBe('+240 333 000 111');
    expect(formatPhone('+34600111222')).toBe('+34600111222');
  });
});
