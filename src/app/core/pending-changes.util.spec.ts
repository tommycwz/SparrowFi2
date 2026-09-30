import { TestBed } from '@angular/core/testing';
import { AppState, createEmptyState } from './models';
import { diffStates, groupPendingChanges, stableStringify } from './pending-changes.util';
import { StateService } from './state.service';
import { CloudDataService } from './cloud-data.service';

function baseState(): AppState {
  return {
    ...createEmptyState(),
    settings: { currency: 'myr' },
    banks: [{ id: 'b1', name: 'Maybank', initialCapital: 0, color: '#000' }],
    categories: [
      { id: 'c1', name: 'Groceries', color: '#111', type: 'expense' },
      { id: 'c2', name: 'Dining', color: '#222', type: 'expense' },
    ],
    transactions: [
      {
        id: 't1',
        date: '2026-09-12',
        amount: 45,
        type: 'expense',
        accountType: 'bank',
        accountId: 'b1',
        categoryId: 'c1',
      },
      {
        id: 't2',
        date: '2026-09-13',
        amount: 20,
        type: 'expense',
        accountType: 'cash',
        categoryId: 'c2',
      },
    ],
  };
}

describe('diffStates', () => {
  it('reports nothing for identical or missing states', () => {
    const s = baseState();
    expect(diffStates(s, s)).toEqual([]);
    expect(diffStates(s, structuredClone(s))).toEqual([]);
    expect(diffStates(null, s)).toEqual([]);
    expect(diffStates(s, null)).toEqual([]);
  });

  it('lists an added transaction with a readable label', () => {
    const saved = baseState();
    const current = {
      ...saved,
      transactions: [
        ...saved.transactions,
        {
          id: 't3',
          date: '2026-09-20',
          amount: 12.5,
          type: 'expense' as const,
          accountType: 'bank' as const,
          accountId: 'b1',
          categoryId: 'c2',
          notes: 'Lunch',
        },
      ],
    };
    const changes = diffStates(saved, current);
    expect(changes.length).toBe(1);
    expect(changes[0].kind).toBe('added');
    expect(changes[0].section).toBe('Transactions');
    expect(changes[0].label).toContain('2026-09-20');
    expect(changes[0].label).toContain('Dining');
    expect(changes[0].label).toContain('12.50');
    expect(changes[0].detail).toBe('Maybank · Lunch');
  });

  it('lists a deleted item', () => {
    const saved = baseState();
    const current = {
      ...saved,
      transactions: saved.transactions.filter((t) => t.id !== 't2'),
    };
    const changes = diffStates(saved, current);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('deleted');
    expect(changes[0].label).toContain('Dining');
  });

  it('lists a modified item with before/after for each changed field', () => {
    const saved = baseState();
    const current = {
      ...saved,
      transactions: saved.transactions.map((t) =>
        t.id === 't1' ? { ...t, amount: 50, categoryId: 'c2' } : t,
      ),
    };
    const [change] = diffStates(saved, current);
    expect(change.kind).toBe('modified');
    const byField = Object.fromEntries(change.fields!.map((f) => [f.field, f]));
    expect(byField['Amount'].before).toContain('45.00');
    expect(byField['Amount'].after).toContain('50.00');
    expect(byField['Category']).toEqual({
      field: 'Category',
      before: 'Groceries',
      after: 'Dining',
    });
  });

  it('ignores a new object that has the same content (key order / explicit undefined)', () => {
    const saved = baseState();
    const t1 = saved.transactions[0];
    const reordered = { categoryId: t1.categoryId, ...t1, notes: undefined };
    const current = {
      ...saved,
      transactions: [reordered, saved.transactions[1]],
    };
    expect(diffStates(saved, current)).toEqual([]);
  });

  it('ignores user.lastExport / isNew, which save() stamps itself', () => {
    const saved = baseState();
    const current = {
      ...saved,
      user: { isNew: false, lastExport: '2026-09-30T00:00:00Z' },
    };
    expect(diffStates(saved, current)).toEqual([]);
  });

  it('reports a currency change under Settings', () => {
    const saved = baseState();
    const current = { ...saved, settings: { currency: 'usd' as const } };
    const [change] = diffStates(saved, current);
    expect(change.section).toBe('Settings');
    expect(change.fields![0]).toEqual({
      field: 'Currency',
      before: 'Malaysian Ringgit',
      after: 'US Dollar',
    });
  });

  it('names a renamed bank by its new name and shows the rename', () => {
    const saved = baseState();
    const current = { ...saved, banks: [{ ...saved.banks[0], name: 'CIMB' }] };
    const [change] = diffStates(saved, current);
    expect(change.label).toBe('CIMB');
    expect(change.fields).toEqual([{ field: 'Name', before: 'Maybank', after: 'CIMB' }]);
  });

  it('groups by section in first-seen order', () => {
    const saved = baseState();
    const current = {
      ...saved,
      banks: [...saved.banks, { id: 'b2', name: 'CIMB', initialCapital: 0, color: '#fff' }],
      transactions: saved.transactions.slice(1),
    };
    const groups = groupPendingChanges(diffStates(saved, current));
    expect(groups.map((g) => g.section)).toEqual(['Transactions', 'Banks']);
    expect(groups.every((g) => g.changes.length === 1)).toBe(true);
  });
});

describe('stableStringify', () => {
  it('is insensitive to key order', () => {
    expect(stableStringify({ a: 1, b: { c: 2, d: 3 } })).toBe(
      stableStringify({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });
});

describe('StateService pending changes', () => {
  let service: StateService;
  let stored: AppState;
  let saves: number;

  beforeEach(async () => {
    stored = baseState();
    saves = 0;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CloudDataService,
          useValue: {
            load: async () => stored,
            save: async (s: AppState) => {
              saves++;
              stored = s;
            },
            reset: async () => {},
          },
        },
      ],
    });
    service = TestBed.inject(StateService);
    await service.load();
  });

  it('starts clean after load', () => {
    expect(service.pendingChanges()).toEqual([]);
    expect(service.dirty()).toBe(false);
  });

  it('counts each change and clears on save', async () => {
    service.addCategory({ name: 'Fuel', color: '#333', type: 'expense' });
    service.removeTransaction('t2');
    expect(service.pendingChanges().length).toBe(2);
    expect(service.dirty()).toBe(true);

    await service.save();
    expect(saves).toBe(1);
    expect(service.pendingChanges()).toEqual([]);
    expect(service.dirty()).toBe(false);
  });

  it('drops an edit that is put back the way it was', () => {
    service.updateTransaction('t1', { amount: 99 });
    expect(service.dirty()).toBe(true);
    service.updateTransaction('t1', { amount: 45 });
    expect(service.pendingChanges()).toEqual([]);
    expect(service.dirty()).toBe(false);
  });

  it('discardChanges restores the last-saved state', () => {
    service.updateTransaction('t1', { amount: 99 });
    service.addBank({ name: 'CIMB', color: '#fff', initialCapital: 0 });
    service.discardChanges();
    expect(service.dirty()).toBe(false);
    expect(service.state()!.transactions.find((t) => t.id === 't1')!.amount).toBe(45);
    expect(service.state()!.banks.length).toBe(1);
  });

  it('updateState(..., false) does not count as unsaved', () => {
    service.updateState(
      (s) => ({
        ...s,
        banks: [...s.banks, { id: 'bx', name: 'X', initialCapital: 0, color: '#fff' }],
      }),
      false,
    );
    expect(service.dirty()).toBe(false);
  });

  it('keeps edits made while a save is in flight as unsaved', async () => {
    const pending = service.save();
    service.updateTransaction('t1', { amount: 70 });
    await pending;
    expect(service.state()!.transactions.find((t) => t.id === 't1')!.amount).toBe(70);
    expect(service.pendingChanges().length).toBe(1);
  });

  it('is not dirty after sign out', () => {
    service.updateTransaction('t1', { amount: 99 });
    service.signOut();
    expect(service.dirty()).toBe(false);
    expect(service.pendingChanges()).toEqual([]);
  });
});
