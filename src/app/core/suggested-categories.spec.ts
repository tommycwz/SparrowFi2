import { SUGGESTED_CATEGORIES, missingSuggestedCategories } from './suggested-categories';
import { STARTER_CATEGORIES } from './default-categories';
import { Category } from './models';

describe('SUGGESTED_CATEGORIES', () => {
  it('is the exact same starter list a brand-new account is seeded with', () => {
    expect(SUGGESTED_CATEGORIES).toBe(STARTER_CATEGORIES);
  });
});

describe('missingSuggestedCategories', () => {
  it('returns every suggested category (with fresh ids) when the account has none', () => {
    const result = missingSuggestedCategories([]);
    expect(result.length).toBe(SUGGESTED_CATEGORIES.length);
    expect(new Set(result.map((c) => c.id)).size).toBe(result.length);
  });

  it('skips a suggested entry the account already has, matched by name + type', () => {
    const existing: Category[] = [{ id: 'x1', name: 'Groceries', color: '#000', type: 'expense' }];
    const result = missingSuggestedCategories(existing);
    expect(result.some((c) => c.name === 'Groceries' && c.type === 'expense')).toBe(false);
    expect(result.length).toBe(SUGGESTED_CATEGORIES.length - 1);
  });

  it('matches case- and whitespace-insensitively, so re-running never duplicates', () => {
    const existing: Category[] = [{ id: 'x1', name: '  groceries  ', color: '#000', type: 'expense' }];
    const result = missingSuggestedCategories(existing);
    expect(result.some((c) => c.name === 'Groceries')).toBe(false);
  });

  it('does not skip a same-named category of a different type', () => {
    // "Groceries" exists as a commitment (unusual, but a user could rename
    // things), which should not block the expense-typed suggestion.
    const existing: Category[] = [{ id: 'x1', name: 'Groceries', color: '#000', type: 'commitment' }];
    const result = missingSuggestedCategories(existing);
    expect(result.some((c) => c.name === 'Groceries' && c.type === 'expense')).toBe(true);
  });

  it('carries the `locked` flag through for the nine FD/Investment/Adjustment-linked entries', () => {
    const result = missingSuggestedCategories([]);
    const locked = result.filter((c) => c.locked).map((c) => c.name).sort();
    expect(locked).toEqual([
      'Adjustment (In)',
      'Adjustment (Out)',
      'FD Gain',
      'FD Maturity Withdrawal',
      'FD Placement',
      'Investment (In)',
      'Investment (Out)',
      'Investment Gain',
      'Investment Lost',
    ]);
  });
});
