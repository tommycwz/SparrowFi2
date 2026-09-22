import {
  convertBudgetAmount,
  expenseTotalForCategoryInRange,
  normalizeBudgetPeriod,
  periodRange,
  roundMoney,
  shiftDate,
  weekStartOf,
} from './budget.util';
import { Transaction } from './models';

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: overrides.id ?? 'tx',
    date: '2026-02-01',
    amount: 10,
    type: 'expense',
    accountType: 'cash',
    ...overrides,
  };
}

describe('normalizeBudgetPeriod', () => {
  it('passes through any of the four real periods unchanged', () => {
    expect(normalizeBudgetPeriod('daily')).toBe('daily');
    expect(normalizeBudgetPeriod('weekly')).toBe('weekly');
    expect(normalizeBudgetPeriod('monthly')).toBe('monthly');
    expect(normalizeBudgetPeriod('yearly')).toBe('yearly');
  });

  it("defaults undefined or anything invalid to 'monthly' - the cadence every budget implicitly used before this field existed", () => {
    expect(normalizeBudgetPeriod(undefined)).toBe('monthly');
    expect(normalizeBudgetPeriod('fortnightly' as any)).toBe('monthly');
  });
});

describe('convertBudgetAmount', () => {
  it('converts monthly <-> yearly by an exact x12 / /12', () => {
    expect(convertBudgetAmount(300, 'yearly', 'monthly')).toBe(25);
    expect(convertBudgetAmount(30, 'monthly', 'yearly')).toBe(360);
  });

  it('returns the amount unchanged when converting a period to itself', () => {
    expect(convertBudgetAmount(42, 'weekly', 'weekly')).toBe(42);
  });

  it('derives weekly/daily off an annualized total (52 weeks, 365 days per year)', () => {
    expect(convertBudgetAmount(52, 'weekly', 'yearly')).toBe(2704); // 52 * 52
    expect(convertBudgetAmount(2704, 'yearly', 'weekly')).toBe(52);
    expect(convertBudgetAmount(365, 'daily', 'yearly')).toBe(133225); // 365 * 365
    expect(convertBudgetAmount(133225, 'yearly', 'daily')).toBe(365);
  });

  it('converts between two non-yearly periods by going via the annualized total', () => {
    // 200/month -> annual 2400 -> /52 weeks -> ~46.15/week.
    expect(convertBudgetAmount(200, 'monthly', 'weekly')).toBeCloseTo(46.153846, 5);
  });
});

describe('roundMoney', () => {
  it('rounds to 2 decimal places', () => {
    expect(roundMoney(5.769230769)).toBe(5.77);
    expect(roundMoney(25)).toBe(25);
    expect(roundMoney(0.005)).toBeCloseTo(0.01, 5);
  });
});

describe('shiftDate', () => {
  it('shifts forward and backward across a month boundary', () => {
    expect(shiftDate('2026-02-27', 3)).toBe('2026-03-02');
    expect(shiftDate('2026-03-02', -3)).toBe('2026-02-27');
  });

  it('shifts across a year boundary', () => {
    expect(shiftDate('2025-12-30', 3)).toBe('2026-01-02');
  });
});

describe('weekStartOf', () => {
  it('returns the same date when given a Monday', () => {
    // 2026-02-16 is a Monday.
    expect(weekStartOf(new Date(2026, 1, 16))).toBe('2026-02-16');
  });

  it('returns the preceding Monday for any other day of the week', () => {
    // 2026-02-20 is a Friday in the same week as the 16th.
    expect(weekStartOf(new Date(2026, 1, 20))).toBe('2026-02-16');
  });

  it('treats Sunday as the last day of the preceding week, not the start of the next', () => {
    // 2026-02-22 is a Sunday - still belongs to the week starting 2026-02-16.
    expect(weekStartOf(new Date(2026, 1, 22))).toBe('2026-02-16');
  });
});

describe('periodRange', () => {
  // 2026-02-18 is a Wednesday.
  const ref = new Date(2026, 1, 18);

  it('daily: returns just that one day, and steps by whole days for a non-zero offset', () => {
    expect(periodRange('daily', 0, ref)).toEqual(['2026-02-18', '2026-02-18']);
    expect(periodRange('daily', -1, ref)).toEqual(['2026-02-17', '2026-02-17']);
    expect(periodRange('daily', 2, ref)).toEqual(['2026-02-20', '2026-02-20']);
  });

  it('weekly: returns the Monday-Sunday week containing the reference date, and steps by whole weeks', () => {
    expect(periodRange('weekly', 0, ref)).toEqual(['2026-02-16', '2026-02-22']);
    expect(periodRange('weekly', -1, ref)).toEqual(['2026-02-09', '2026-02-15']);
  });

  it('monthly: returns the first-to-last day of the month, and steps by whole months across a year boundary', () => {
    expect(periodRange('monthly', 0, ref)).toEqual(['2026-02-01', '2026-02-28']);
    expect(periodRange('monthly', -2, new Date(2026, 0, 15))).toEqual(['2025-11-01', '2025-11-30']);
  });

  it('yearly: returns Jan 1 - Dec 31 of the reference year, and steps by whole years', () => {
    expect(periodRange('yearly', 0, ref)).toEqual(['2026-01-01', '2026-12-31']);
    expect(periodRange('yearly', -1, ref)).toEqual(['2025-01-01', '2025-12-31']);
  });
});

describe('expenseTotalForCategoryInRange', () => {
  it('sums only Expense transactions for the category within the inclusive date range', () => {
    const transactions: Transaction[] = [
      tx({ id: '1', categoryId: 'food', amount: 20, date: '2026-02-16' }), // range start - included
      tx({ id: '2', categoryId: 'food', amount: 30, date: '2026-02-20' }), // mid-range
      tx({ id: '3', categoryId: 'food', amount: 40, date: '2026-02-22' }), // range end - included
      tx({ id: '4', categoryId: 'food', amount: 999, date: '2026-02-15' }), // before range - excluded
      tx({ id: '5', categoryId: 'food', amount: 999, date: '2026-02-23' }), // after range - excluded
      tx({ id: '6', categoryId: 'transport', amount: 999, date: '2026-02-18' }), // different category
      tx({ id: '7', categoryId: 'food', amount: 999, date: '2026-02-18', type: 'commitment' }), // not an expense
    ];
    expect(expenseTotalForCategoryInRange(transactions, 'food', '2026-02-16', '2026-02-22')).toBe(90);
  });

  it('returns 0 for a range with no matching transactions', () => {
    expect(expenseTotalForCategoryInRange([], 'food', '2026-02-16', '2026-02-22')).toBe(0);
  });

  it('works for a single-day range (as used by the Daily tab)', () => {
    const transactions: Transaction[] = [
      tx({ id: '1', categoryId: 'food', amount: 12, date: '2026-02-18' }),
      tx({ id: '2', categoryId: 'food', amount: 999, date: '2026-02-19' }),
    ];
    expect(expenseTotalForCategoryInRange(transactions, 'food', '2026-02-18', '2026-02-18')).toBe(12);
  });
});
