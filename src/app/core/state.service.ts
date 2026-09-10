import { Injectable, computed, signal } from '@angular/core';
import {
  AppState,
  Bank,
  Card,
  Category,
  FixedDeposit,
  Transaction,
  Wallet,
  createEmptyState,
} from './models';
import { CloudDataService } from './cloud-data.service';
import { generateId } from './id.util';
import { createDefaultCategories } from './default-categories';
import { fdMaturityDate, fdMaturityValue } from './fixed-deposit.util';

export interface AccountBalance {
  kind: 'bank' | 'wallet' | 'card' | 'bucket';
  id: string;
  name: string;
  color: string;
  balance: number;
}

const CASH_BUCKET_COLOR = '#14B8A6';
const OTHERS_BUCKET_COLOR = '#94A3B8';

/**
 * Single source of truth for the signed-in account's finance data: the
 * parsed state and its loaded/dirty/busy status. All mutation methods live
 * here so every screen shares one signal graph. Data only ever moves
 * to/from Supabase through `CloudDataService`, which handles the
 * client-side encryption - this service never sees a network request or a
 * raw byte, only the already-decrypted `AppState`.
 */
@Injectable({ providedIn: 'root' })
export class StateService {
  private readonly _state = signal<AppState | null>(null);
  private readonly _dirty = signal(false);
  private readonly _busy = signal(false);

  readonly state = this._state.asReadonly();
  readonly dirty = this._dirty.asReadonly();
  readonly busy = this._busy.asReadonly();

  readonly isLoaded = computed(() => this._state() !== null);

  readonly accountBalances = computed<AccountBalance[]>(() => {
    const s = this._state();
    if (!s) return [];
    const totals = new Map<string, number>();
    const bump = (key: string, delta: number) => totals.set(key, (totals.get(key) ?? 0) + delta);

    for (const t of s.transactions) {
      const signedAmount = t.type === 'income' || t.type === 'others-in' ? t.amount : -t.amount;
      if (t.accountType === 'cash') {
        bump('bucket:cash', signedAmount);
      } else if (t.accountType === 'others') {
        bump('bucket:others', signedAmount);
      } else if (t.accountId) {
        bump(`${t.accountType}:${t.accountId}`, signedAmount);
      }
    }

    const balances: AccountBalance[] = [];
    for (const b of s.banks) {
      balances.push({
        kind: 'bank',
        id: b.id,
        name: b.name,
        color: b.color,
        balance: b.initialCapital + (totals.get(`bank:${b.id}`) ?? 0),
      });
    }
    for (const w of s.wallets) {
      balances.push({
        kind: 'wallet',
        id: w.id,
        name: w.name,
        color: w.color,
        balance: w.initialCapital + (totals.get(`wallet:${w.id}`) ?? 0),
      });
    }
    for (const c of s.cards) {
      balances.push({
        kind: 'card',
        id: c.id,
        name: c.name,
        color: c.color,
        balance: totals.get(`card:${c.id}`) ?? 0,
      });
    }
    if (totals.has('bucket:cash')) {
      balances.push({
        kind: 'bucket',
        id: 'cash',
        name: 'Cash',
        color: CASH_BUCKET_COLOR,
        balance: totals.get('bucket:cash')!,
      });
    }
    if (totals.has('bucket:others')) {
      balances.push({
        kind: 'bucket',
        id: 'others',
        name: 'Others',
        color: OTHERS_BUCKET_COLOR,
        balance: totals.get('bucket:others')!,
      });
    }
    return balances;
  });

  readonly netWorth = computed(() =>
    this.accountBalances().reduce((sum, a) => sum + a.balance, 0),
  );

  constructor(private readonly cloudData: CloudDataService) {}

  // ----- Lifecycle: load / save / sign out --------------------------------

  /** Loads the signed-in account's data from Supabase (decrypting
   * client-side), or seeds a fresh empty state with the default category
   * list for a brand-new account that hasn't saved anything yet. Called by
   * the Launcher right after a successful sign-in/sign-up. */
  async load(): Promise<void> {
    const loaded = await this.cloudData.load();
    this._state.set(loaded ?? { ...createEmptyState(), categories: createDefaultCategories() });
    this._dirty.set(false);
  }

  /** Encrypts and saves the current state back to Supabase, replacing
   * whatever was there before. */
  async save(): Promise<void> {
    const current = this.requireState();
    const toSave: AppState = {
      ...current,
      user: { ...current.user, isNew: false, lastExport: new Date().toISOString() },
    };
    this._busy.set(true);
    try {
      await this.cloudData.save(toSave);
      this._state.set(toSave);
      this._dirty.set(false);
    } finally {
      this._busy.set(false);
    }
  }

  /** Deletes the signed-in account's saved record from Supabase, then
   * replaces the in-memory state with a fresh empty one (default
   * categories, everything else blank) and saves that back - so the
   * account ends up at a clean slate rather than left pointing at nothing
   * until the next save. Irreversible: there is no recovery key, so the
   * caller (Settings) must get explicit confirmation before calling this. */
  async resetData(): Promise<void> {
    this._busy.set(true);
    try {
      await this.cloudData.reset();
      const empty = { ...createEmptyState(), categories: createDefaultCategories() };
      await this.cloudData.save(empty);
      this._state.set(empty);
      this._dirty.set(false);
    } finally {
      this._busy.set(false);
    }
  }

  /** Clears the in-memory state (does not sign out of Supabase itself -
   * callers pair this with `CloudAuthService.signOut()`). */
  signOut(): void {
    this._state.set(null);
    this._dirty.set(false);
  }

  /** Wholesale-replaces the current state, e.g. after decoding an imported
   * legacy `.spw` file. Marks the result dirty so the caller is prompted
   * to `save()` it. */
  replaceState(state: AppState): void {
    this._state.set(state);
    this._dirty.set(true);
  }

  // ----- Mutations ----------------------------------------------------

  updateState(fn: (state: AppState) => AppState, markDirty = true): void {
    const current = this._state();
    if (!current) return;
    this._state.set(fn(current));
    if (markDirty) this._dirty.set(true);
  }

  setCurrency(currency: AppState['settings']['currency']): void {
    this.updateState((s) => ({ ...s, settings: { ...s.settings, currency } }));
  }

  addBank(bank: Omit<Bank, 'id'>): void {
    this.updateState((s) => ({
      ...s,
      banks: [...s.banks, { ...bank, id: generateId(), initialCapital: 0 }],
    }));
  }
  updateBank(id: string, patch: Partial<Bank>): void {
    this.updateState((s) => ({
      ...s,
      banks: s.banks.map((b) => (b.id === id ? { ...b, ...patch, id } : b)),
    }));
  }
  removeBank(id: string): void {
    this.updateState((s) => ({
      ...s,
      banks: s.banks.filter((b) => b.id !== id),
      transactions: s.transactions.filter((t) => !(t.accountType === 'bank' && t.accountId === id)),
    }));
  }

  addWallet(wallet: Omit<Wallet, 'id'>): void {
    this.updateState((s) => ({
      ...s,
      wallets: [...s.wallets, { ...wallet, id: generateId(), initialCapital: 0 }],
    }));
  }
  updateWallet(id: string, patch: Partial<Wallet>): void {
    this.updateState((s) => ({
      ...s,
      wallets: s.wallets.map((w) => (w.id === id ? { ...w, ...patch, id } : w)),
    }));
  }
  removeWallet(id: string): void {
    this.updateState((s) => ({
      ...s,
      wallets: s.wallets.filter((w) => w.id !== id),
      transactions: s.transactions.filter(
        (t) => !(t.accountType === 'wallet' && t.accountId === id),
      ),
    }));
  }

  addCard(card: Omit<Card, 'id'>): void {
    this.updateState((s) => ({ ...s, cards: [...s.cards, { ...card, id: generateId() }] }));
  }
  updateCard(id: string, patch: Partial<Card>): void {
    this.updateState((s) => ({
      ...s,
      cards: s.cards.map((c) => (c.id === id ? { ...c, ...patch, id } : c)),
    }));
  }
  removeCard(id: string): void {
    this.updateState((s) => ({
      ...s,
      cards: s.cards.filter((c) => c.id !== id),
      transactions: s.transactions.filter((t) => !(t.accountType === 'card' && t.accountId === id)),
    }));
  }

  addCategory(category: Omit<Category, 'id'>): void {
    this.updateState((s) => ({
      ...s,
      categories: [...s.categories, { ...category, id: generateId() }],
    }));
  }
  updateCategory(id: string, patch: Partial<Category>): void {
    this.updateState((s) => ({
      ...s,
      categories: s.categories.map((c) => (c.id === id ? { ...c, ...patch, id } : c)),
    }));
  }
  removeCategory(id: string): void {
    this.updateState((s) => ({
      ...s,
      categories: s.categories.filter((c) => c.id !== id),
      transactions: s.transactions.map((t) =>
        t.categoryId === id ? { ...t, categoryId: undefined } : t,
      ),
    }));
  }

  addTransaction(t: Omit<Transaction, 'id'>): void {
    this.updateState((s) => ({
      ...s,
      transactions: [...s.transactions, { ...t, id: generateId() }],
    }));
  }
  /** Adds many transactions (e.g. a CSV import) as a single state update,
   * rather than one signal write per row. */
  addTransactions(list: Omit<Transaction, 'id'>[]): void {
    if (list.length === 0) return;
    this.updateState((s) => ({
      ...s,
      transactions: [...s.transactions, ...list.map((t) => ({ ...t, id: generateId() }))],
    }));
  }
  updateTransaction(id: string, patch: Partial<Transaction>): void {
    this.updateState((s) => ({
      ...s,
      transactions: s.transactions.map((t) => (t.id === id ? { ...t, ...patch, id } : t)),
    }));
  }
  removeTransaction(id: string): void {
    this.updateState((s) => ({ ...s, transactions: s.transactions.filter((t) => t.id !== id) }));
  }

  /** Creating a fixed deposit is money leaving a bank account, so this also
   * records an "others-out" transaction against that bank for the
   * principal - same as the other account-opening flows in this file (see
   * `migrateState`'s "Initial balance" transactions). Uses the "Investment
   * (Out)" default category when present, but works fine without it. */
  addFixedDeposit(fd: Omit<FixedDeposit, 'id'>): void {
    const id = generateId();
    this.updateState((s) => {
      const bank = s.banks.find((b) => b.id === fd.bankId);
      const category = s.categories.find(
        (c) => c.type === 'others-out' && c.name === 'Investment (Out)',
      );
      return {
        ...s,
        fixedDeposits: [...s.fixedDeposits, { ...fd, id }],
        transactions: [
          ...s.transactions,
          {
            id: generateId(),
            fdId: id,
            date: fd.startDate,
            amount: fd.amount,
            type: 'others-out',
            accountType: 'bank',
            accountId: fd.bankId,
            categoryId: category?.id,
            notes: `Fixed Deposit${bank ? ' - ' + bank.name : ''}`,
          },
        ],
      };
    });
  }

  /** Patches a fixed deposit and keeps any transaction(s) it previously
   * generated in sync with the new values. The moment `status` transitions
   * into 'matured' for the first time, this also records the maturity
   * payout - principal + interest, credited to `toBankId` (or `bankId` if
   * the proceeds go back to the same account) - as an "others-in"
   * transaction, mirroring the opening one `addFixedDeposit` created. */
  updateFixedDeposit(id: string, patch: Partial<FixedDeposit>): void {
    this.updateState((s) => {
      const existing = s.fixedDeposits.find((f) => f.id === id);
      if (!existing) return s;
      const updated: FixedDeposit = { ...existing, ...patch, id };
      const justMatured = existing.status === 'active' && updated.status === 'matured';
      const destBankId = updated.toBankId || updated.bankId;

      // Keep the opening (others-out) transaction lined up with the FD's
      // current bank/amount/date, if this FD has one.
      let transactions = s.transactions.map((t) =>
        t.fdId === id && t.type === 'others-out'
          ? { ...t, date: updated.startDate, amount: updated.amount, accountId: updated.bankId }
          : t,
      );

      if (justMatured) {
        const bank = s.banks.find((b) => b.id === destBankId);
        const category = s.categories.find(
          (c) => c.type === 'others-in' && c.name === 'Investment (In)',
        );
        transactions = [
          ...transactions,
          {
            id: generateId(),
            fdId: id,
            date: fdMaturityDate(updated),
            amount: fdMaturityValue(updated),
            type: 'others-in',
            accountType: 'bank',
            accountId: destBankId,
            categoryId: category?.id,
            notes: `Fixed Deposit matured${bank ? ' - ' + bank.name : ''}`,
          },
        ];
      } else {
        // Already-matured FD edited afterwards (bank/amount/rate/tenure
        // changed) - keep its maturity transaction in sync too, rather than
        // leaving it pointing at stale numbers.
        transactions = transactions.map((t) =>
          t.fdId === id && t.type === 'others-in'
            ? {
                ...t,
                date: fdMaturityDate(updated),
                amount: fdMaturityValue(updated),
                accountId: destBankId,
              }
            : t,
        );
      }

      return {
        ...s,
        fixedDeposits: s.fixedDeposits.map((f) => (f.id === id ? updated : f)),
        transactions,
      };
    });
  }

  /** Deleting a fixed deposit record also removes whatever transaction(s)
   * it auto-generated, same as removing a bank/wallet/card cascades to
   * their transactions - otherwise you'd be left with an "others-out"/
   * "others-in" entry with nothing behind it. */
  removeFixedDeposit(id: string): void {
    this.updateState((s) => ({
      ...s,
      fixedDeposits: s.fixedDeposits.filter((f) => f.id !== id),
      transactions: s.transactions.filter((t) => t.fdId !== id),
    }));
  }

  private requireState(): AppState {
    const s = this._state();
    if (!s) throw new Error('No account data is currently loaded.');
    return s;
  }
}
