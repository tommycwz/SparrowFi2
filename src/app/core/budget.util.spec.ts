import { expenseTotalForCategory } from './budget.util';
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

describe('expenseTotalForCategory', () => {
  it('sums only Expense transactions for the given category and month', () => {
    const transactions: Transaction[] = [
      tx({ id: '1', categoryId: 'food', amount: 50, date: '2026-02-05' }),
      tx({ id: '2', categoryId: 'food', amount: 30, date: '2026-02-20' }),
      // Different category - excluded.
      tx({ id: '3', categoryId: 'transport', amount: 999, date: '2026-02-05' }),
      // Same category, different month - excluded.
      tx({ id: '4', categoryId: 'food', amount: 999, date: '2026-01-31' }),
      // Same category and month, but not an Expense - excluded (see the
      // function's doc comment on why only `type: 'expense'` counts).
      tx({ id: '5', categoryId: 'food', amount: 999, date: '2026-02-10', type: 'commitment' }),
    ];
    expect(expenseTotalForCategory(transactions, 'food', '2026-02')).toBe(80);
  });

  it('returns 0 for a category/month with no matching transactions', () => {
    expect(expenseTotalForCategory([], 'food', '2026-02')).toBe(0);
    expect(expenseTotalForCategory([tx({ categoryId: 'food', date: '2026-02-01' })], 'transport', '2026-02')).toBe(0);
  });

  it('ignores an uncategorized transaction (no categoryId) even when a category filter is empty-ish', () => {
    const uncategorized = tx({ categoryId: undefined, date: '2026-02-01' });
    expect(expenseTotalForCategory([uncategorized], 'food', '2026-02')).toBe(0);
  });
});
