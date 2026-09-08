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

  it('converts non-zero bank initialCapital into an opening-balance transaction and zeroes it', () => {
    const result = migrateState({
      banks: [{ id: 'b1', name: 'Maybank', initialCapital: 500, color: '#000' }],
    });
    const bank = result.banks.find((b) => b.id === 'b1')!;
    expect(bank.initialCapital).toBe(0);
    const tx = result.transactions.find((t) => t.accountId === 'b1');
    expect(tx?.amount).toBe(500);
    expect(tx?.notes).toBe('Initial balance');
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
