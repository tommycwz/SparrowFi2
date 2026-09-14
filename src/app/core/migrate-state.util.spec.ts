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

  it('returns a valid empty state for garbage input', () => {
    const result = migrateState(null);
    expect(result.banks).toEqual([]);
    expect(result.settings.currency).toBe('myr');
  });
});
