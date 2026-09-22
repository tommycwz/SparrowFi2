import { migrateState } from './migrate-state.util';

describe('migrateState', () => {
  it('converts legacy creditCards[] into cards[]', () => {
    const result = migrateState({ creditCards: [{ id: 'cc1', name: 'Visa' }] });
    expect(result.cards.some((c) => c.id === 'cc1' && c.name === 'Visa')).toBe(true);
  });

  it('flattens dropboxes[] children into categories[]', () => {
    const result = migrateState({
      dropboxes: [{ children: [{ id: 'cat1', name: 'Food', type: 'expense' }] }],
    });
    expect(result.categories.some((c) => c.id === 'cat1' && c.name === 'Food')).toBe(true);
  });

  it('converts non-zero bank initialCapital into an opening-balance transaction and zeroes it, categorized as the auto-backfilled "Adjustment (In)"', () => {
    const result = migrateState({
      banks: [{ id: 'b1', name: 'Maybank', initialCapital: 500, color: '#000' }],
    });
    const bank = result.banks.find((b) => b.id === 'b1')!;
    expect(bank.initialCapital).toBe(0);
    const tx = result.transactions.find((t) => t.accountId === 'b1');
    expect(tx?.amount).toBe(500);
    expect(tx?.notes).toBe('Initial balance');
    // This legacy file has no categories at all, but `ensureRequiredCategories`
    // backfills the locked defaults (including "Adjustment (In)") before this
    // transaction is categorized - so it's no longer left uncategorized the
    // way a truly unmigrated file would have been.
    const adjustmentIn = result.categories.find((c) => c.name === 'Adjustment (In)' && c.type === 'others-in');
    expect(adjustmentIn).toBeDefined();
    expect(tx?.categoryId).toBe(adjustmentIn!.id);
  });

  it('categorizes the opening transaction as "Adjustment (In)" when the legacy file already has that category, reusing it rather than adding a second one', () => {
    const result = migrateState({
      banks: [{ id: 'b1', name: 'Maybank', initialCapital: 500, color: '#000' }],
      categories: [{ id: 'cat-adj-in', name: 'Adjustment (In)', type: 'others-in', color: '#06B6D4' }],
    });
    const tx = result.transactions.find((t) => t.accountId === 'b1');
    expect(tx?.categoryId).toBe('cat-adj-in');
    expect(result.categories.filter((c) => c.name === 'Adjustment (In)').length).toBe(1);
  });

  it('backfills the locked "Investment ..." categories onto a legacy file that never had them', () => {
    const result = migrateState({ banks: [{ id: 'b1', name: 'Maybank', color: '#000' }] });
    const locked = result.categories.filter((c) => c.locked).map((c) => c.name).sort();
    expect(locked).toEqual([
      'Adjustment (In)',
      'Adjustment (Out)',
      'Investment (In)',
      'Investment (Out)',
      'Investment Profit',
    ]);
  });

  it('migrates fixedDeposit.isMatured boolean into a status enum', () => {
    const result = migrateState({
      fixedDeposits: [
        { id: 'fd1', bankId: 'b1', startDate: '2026-01-01', amount: 1000, percentage: 3, months: 12, isMatured: true },
      ],
    });
    expect(result.fixedDeposits[0].status).toBe('matured');
    expect((result.fixedDeposits[0] as any).isMatured).toBeUndefined();
  });

  it('wraps a pre-multi-line recurring item\'s own type/account/amount fields into a single line', () => {
    const result = migrateState({
      recurringTransactions: [
        {
          id: 'r1',
          name: 'Netflix',
          amount: 45,
          type: 'expense',
          accountType: 'cash',
          frequency: 'monthly',
          nextDate: '2026-01-01',
        },
      ],
    });
    const r = result.recurringTransactions.find((x) => x.id === 'r1')!;
    expect(r.lines.length).toBe(1);
    expect(r.lines[0]).toEqual(
      expect.objectContaining({ amount: 45, type: 'expense', accountType: 'cash' }),
    );
  });

  it('passes through a recurring item that already has multiple lines unchanged', () => {
    const result = migrateState({
      recurringTransactions: [
        {
          id: 'r1',
          name: 'Salary',
          frequency: 'monthly',
          nextDate: '2026-01-01',
          lines: [
            { id: 'l1', amount: 5000, type: 'income', accountType: 'bank', accountId: 'b1' },
            { id: 'l2', amount: 500, type: 'expense', accountType: 'bank', accountId: 'b2' },
          ],
        },
      ],
    });
    const r = result.recurringTransactions.find((x) => x.id === 'r1')!;
    expect(r.lines.length).toBe(2);
    expect(r.lines.map((l) => l.id)).toEqual(['l1', 'l2']);
  });

  it('backfills a legacy recurring item (saved before interval/anchorDay existed) with interval 1 and anchorDay from its nextDate', () => {
    const result = migrateState({
      recurringTransactions: [
        {
          id: 'r1',
          name: 'Netflix',
          amount: 45,
          type: 'expense',
          accountType: 'cash',
          frequency: 'monthly',
          nextDate: '2026-01-31',
        },
      ],
    });
    const r = result.recurringTransactions.find((x) => x.id === 'r1')!;
    expect(r.interval).toBe(1);
    expect(r.anchorDay).toBe(31);
  });

  it('normalizes an already-invalid stored interval (0, negative, fractional) back to 1, and keeps a valid stored anchorDay as-is', () => {
    const result = migrateState({
      recurringTransactions: [
        { id: 'r1', name: 'A', frequency: 'monthly', nextDate: '2026-02-15', interval: 0 },
        { id: 'r2', name: 'B', frequency: 'monthly', nextDate: '2026-02-15', interval: -3 },
        { id: 'r3', name: 'C', frequency: 'monthly', nextDate: '2026-02-15', interval: 2.7 },
        { id: 'r4', name: 'D', frequency: 'monthly', nextDate: '2026-02-15', interval: 3, anchorDay: 31 },
      ],
    });
    expect(result.recurringTransactions.find((x) => x.id === 'r1')!.interval).toBe(1);
    expect(result.recurringTransactions.find((x) => x.id === 'r2')!.interval).toBe(1);
    expect(result.recurringTransactions.find((x) => x.id === 'r3')!.interval).toBe(2);
    const d = result.recurringTransactions.find((x) => x.id === 'r4')!;
    expect(d.interval).toBe(3);
    // A stored anchorDay (31) is kept even though it no longer matches
    // nextDate's own day (15) - it may have been set on a 31st before a
    // short-month clamp moved nextDate itself, exactly the case anchorDay
    // exists to remember.
    expect(d.anchorDay).toBe(31);
  });

  it('carries budgets through unchanged, and defaults to an empty array for a file saved before Budgets existed', () => {
    const withBudgets = migrateState({
      budgets: [{ id: 'bg1', categoryId: 'cat1', amount: 500 }],
    });
    expect(withBudgets.budgets).toEqual([{ id: 'bg1', categoryId: 'cat1', amount: 500 }]);

    const withoutBudgets = migrateState({ banks: [] });
    expect(withoutBudgets.budgets).toEqual([]);
  });

  it('normalizes a garbage stored budget amount (missing/zero/negative) back to 0 rather than leaving it invalid', () => {
    const result = migrateState({
      budgets: [
        { id: 'bg1', categoryId: 'cat1' },
        { id: 'bg2', categoryId: 'cat2', amount: -50 },
        { id: 'bg3', categoryId: 'cat3', amount: 0 },
      ],
    });
    expect(result.budgets.map((b) => b.amount)).toEqual([0, 0, 0]);
  });

  it('returns a valid empty state for garbage input', () => {
    const result = migrateState(null);
    expect(result.banks).toEqual([]);
    expect(result.settings.currency).toBe('myr');
    expect(result.budgets).toEqual([]);
  });
});
