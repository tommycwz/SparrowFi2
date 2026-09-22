import {
  anchorDayOf,
  frequencyUnitLabel,
  nextOccurrenceDate,
  normalizeInterval,
  recurrenceLabel,
} from './recurring.util';

describe('normalizeInterval', () => {
  it('passes a valid positive integer through unchanged', () => {
    expect(normalizeInterval(1)).toBe(1);
    expect(normalizeInterval(5)).toBe(5);
  });

  it('floors a fractional interval down to a whole number', () => {
    expect(normalizeInterval(2.9)).toBe(2);
  });

  it('falls back to 1 for undefined, zero, negative, or non-finite input', () => {
    expect(normalizeInterval(undefined)).toBe(1);
    expect(normalizeInterval(0)).toBe(1);
    expect(normalizeInterval(-3)).toBe(1);
    expect(normalizeInterval(NaN)).toBe(1);
  });
});

describe('anchorDayOf', () => {
  it("reads the day-of-month out of a 'YYYY-MM-DD' string", () => {
    expect(anchorDayOf('2026-01-31')).toBe(31);
    expect(anchorDayOf('2026-02-05')).toBe(5);
  });

  it('falls back to 1 for a missing or malformed date', () => {
    expect(anchorDayOf(undefined)).toBe(1);
    expect(anchorDayOf('')).toBe(1);
    expect(anchorDayOf('not-a-date')).toBe(1);
  });
});

describe('nextOccurrenceDate', () => {
  it('steps a daily item forward by 1 day when interval is omitted', () => {
    expect(nextOccurrenceDate('2026-01-01', 'daily')).toBe('2026-01-02');
  });

  it('steps a daily item forward by N days for interval N', () => {
    expect(nextOccurrenceDate('2026-01-01', 'daily', 5)).toBe('2026-01-06');
  });

  it('steps a weekly item forward by 7 * N days ("bi-weekly", "tri-weekly", ...)', () => {
    expect(nextOccurrenceDate('2026-01-01', 'weekly', 1)).toBe('2026-01-08');
    expect(nextOccurrenceDate('2026-01-01', 'weekly', 2)).toBe('2026-01-15');
    expect(nextOccurrenceDate('2026-01-01', 'weekly', 3)).toBe('2026-01-22');
  });

  it('steps a plain monthly item (day <= 28) forward by N months without any clamping', () => {
    expect(nextOccurrenceDate('2026-01-15', 'monthly', 1)).toBe('2026-02-15');
    expect(nextOccurrenceDate('2026-01-15', 'monthly', 3)).toBe('2026-04-15');
  });

  it('clamps a day-31 monthly item to the shorter month\'s last day instead of overflowing into the next month', () => {
    // 2026 is not a leap year - February has 28 days.
    expect(nextOccurrenceDate('2026-01-31', 'monthly')).toBe('2026-02-28');
    // April has 30 days.
    expect(nextOccurrenceDate('2026-03-31', 'monthly')).toBe('2026-04-30');
  });

  it('returns to the real anchor day the very next month that has it, rather than staying stuck at the clamped day', () => {
    // Simulates three successive triggers of an item anchored to the 31st:
    // Jan 31 -> Feb 28 (clamped) -> Mar 31 (back to 31, not stuck at 28) -> Apr 30 (clamped again).
    const anchor = 31;
    const step1 = nextOccurrenceDate('2026-01-31', 'monthly', 1, anchor);
    expect(step1).toBe('2026-02-28');
    const step2 = nextOccurrenceDate(step1, 'monthly', 1, anchor);
    expect(step2).toBe('2026-03-31');
    const step3 = nextOccurrenceDate(step2, 'monthly', 1, anchor);
    expect(step3).toBe('2026-04-30');
  });

  it('clamps a yearly Feb-29 anchor to Feb 28 in a non-leap year, then back to Feb 29 the next leap year', () => {
    const anchor = 29;
    // 2028 is a leap year, 2029 is not.
    const inLeapYear = nextOccurrenceDate('2028-02-29', 'yearly', 1, anchor);
    expect(inLeapYear).toBe('2029-02-28');
    // 2032 is a leap year again.
    const backToLeapYear = nextOccurrenceDate('2031-02-28', 'yearly', 1, anchor);
    expect(backToLeapYear).toBe('2032-02-29');
  });

  it('steps a yearly item forward by N years for interval N', () => {
    expect(nextOccurrenceDate('2026-06-01', 'yearly', 2)).toBe('2028-06-01');
  });

  it('falls back to the day already in dateStr when anchorDay is omitted', () => {
    expect(nextOccurrenceDate('2026-01-31', 'monthly', 1)).toBe('2026-02-28');
  });
});

describe('frequencyUnitLabel', () => {
  it('is singular at interval 1 and plural otherwise', () => {
    expect(frequencyUnitLabel('weekly', 1)).toBe('Week');
    expect(frequencyUnitLabel('weekly', 2)).toBe('Weeks');
    expect(frequencyUnitLabel('daily', 5)).toBe('Days');
  });
});

describe('recurrenceLabel', () => {
  it('uses the plain frequency label at interval 1 (or when interval is omitted)', () => {
    expect(recurrenceLabel('monthly', 1)).toBe('Monthly');
    expect(recurrenceLabel('weekly', undefined)).toBe('Weekly');
  });

  it('reads "Every N ___" for any other interval, e.g. bi-weekly/tri-weekly', () => {
    expect(recurrenceLabel('weekly', 2)).toBe('Every 2 weeks');
    expect(recurrenceLabel('weekly', 3)).toBe('Every 3 weeks');
    expect(recurrenceLabel('monthly', 6)).toBe('Every 6 months');
  });
});
