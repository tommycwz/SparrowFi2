import { createDefaultCategories, ensureRequiredCategories } from './default-categories';
import { Category } from './models';

describe('createDefaultCategories', () => {
  it('returns a non-empty starter set with fresh, unique ids each call', () => {
    const a = createDefaultCategories();
    const b = createDefaultCategories();
    expect(a.length).toBeGreaterThan(0);
    expect(a.map((c) => c.id)).not.toEqual(b.map((c) => c.id));
    expect(new Set(a.map((c) => c.id)).size).toBe(a.length);
  });

  it('has no default Commitment categories - there is no one-size-fits-all starter set for those', () => {
    const result = createDefaultCategories();
    expect(result.some((c) => c.type === 'commitment')).toBe(false);
  });

  it('locks only the five categories the app auto-categorizes by exact name - Fixed Deposits and Investments share the same three "Investment ..." ones', () => {
    const result = createDefaultCategories();
    const locked = result.filter((c) => c.locked).map((c) => c.name).sort();
    expect(locked).toEqual([
      'Adjustment (In)',
      'Adjustment (Out)',
      'Investment (In)',
      'Investment (Out)',
      'Investment Profit',
    ]);
    // Everything else in the starter set stays a normal, deletable category.
    expect(result.filter((c) => !c.locked).length).toBe(result.length - 5);
  });

  it('gives each locked category the type the auto-categorization lookups expect', () => {
    const byName = new Map(createDefaultCategories().map((c) => [c.name, c]));
    expect(byName.get('Investment Profit')!.type).toBe('income');
    expect(byName.get('Investment (In)')!.type).toBe('others-in');
    expect(byName.get('Adjustment (In)')!.type).toBe('others-in');
    expect(byName.get('Investment (Out)')!.type).toBe('others-out');
    expect(byName.get('Adjustment (Out)')!.type).toBe('others-out');
  });
});

describe('ensureRequiredCategories', () => {
  it('adds every missing locked category and leaves everything else untouched', () => {
    const existing: Category[] = [
      { id: '1', name: 'Salary', type: 'income', color: '#16A34A' },
      { id: '2', name: 'Groceries', type: 'expense', color: '#EA580C' },
    ];
    const result = ensureRequiredCategories(existing);

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: '1', name: 'Salary' }),
        expect.objectContaining({ id: '2', name: 'Groceries' }),
      ]),
    );
    const locked = result.filter((c) => c.locked).map((c) => c.name).sort();
    expect(locked).toEqual([
      'Adjustment (In)',
      'Adjustment (Out)',
      'Investment (In)',
      'Investment (Out)',
      'Investment Profit',
    ]);
  });

  it('is a no-op when every required category is already present - never duplicates', () => {
    const seeded = createDefaultCategories();
    const result = ensureRequiredCategories(seeded);
    expect(result.length).toBe(seeded.length);
    expect(result.map((c) => c.name).sort()).toEqual(seeded.map((c) => c.name).sort());
  });

  it('does not add a required category twice just because it is called repeatedly', () => {
    let categories: Category[] = [];
    categories = ensureRequiredCategories(categories);
    const afterFirst = categories.length;
    categories = ensureRequiredCategories(categories);
    expect(categories.length).toBe(afterFirst);
  });

  it('treats an existing category as satisfying the requirement by exact type+name match, case-insensitively, without re-locking a differently-typed match', () => {
    const existing: Category[] = [
      { id: '1', name: 'investment (in)', type: 'others-in', color: '#000000' },
    ];
    const result = ensureRequiredCategories(existing);
    // The case-insensitive match against "Investment (In)" (others-in) means
    // no second one is added, and the original is left exactly as it was
    // (still unlocked) - ensureRequiredCategories only ever adds, never edits
    // an existing match.
    const investmentIn = result.filter((c) => c.name.toLowerCase() === 'investment (in)');
    expect(investmentIn.length).toBe(1);
    expect(investmentIn[0].id).toBe('1');
    expect(investmentIn[0].locked).toBeUndefined();
  });

  it('unlocks a retired locked category (from before FDs and Investments shared categories) instead of leaving it permanently undeletable', () => {
    const existing: Category[] = [
      { id: '1', name: 'FD Gain', type: 'income', color: '#22C55E', locked: true },
      { id: '2', name: 'Investment Lost', type: 'others-out', color: '#9F1239', locked: true },
      { id: '3', name: 'Salary', type: 'income', color: '#16A34A' },
    ];
    const result = ensureRequiredCategories(existing);
    expect(result.find((c) => c.id === '1')!.locked).toBeUndefined();
    expect(result.find((c) => c.id === '2')!.locked).toBeUndefined();
    // Untouched otherwise.
    expect(result.find((c) => c.id === '3')).toEqual(existing[2]);
  });
});
