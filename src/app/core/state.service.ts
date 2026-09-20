import { Injectable, computed, signal } from '@angular/core';
import {
  AppState,
  Bank,
  Card,
  Category,
  FixedDeposit,
  Investment,
  RecurringLine,
  RecurringTransaction,
  Transaction,
  Wallet,
  createEmptyState,
} from './models';
import { CloudDataService } from './cloud-data.service';
import { generateId } from './id.util';
import { createDefaultCategories, ensureRequiredCategories } from './default-categories';
import { fdGainValue, fdMaturityDate } from './fixed-deposit.util';
import { nextOccurrenceDate } from './recurring.util';

export interface AccountBalance {
  kind: 'bank' | 'wallet' | 'card' | 'bucket';
  id: string;
  name: string;
  color: string;
  balance: number;
}

const CASH_BUCKET_COLOR = '#14B8A6';
const OTHERS_BUCKET_COLOR = '#94A3B8';

/** `notes` value stamped on the one-time opening-balance transaction that
 * `addBank`/`addWallet` (and `migrateState`, for a legacy file's
 * `initialCapital`) create instead of storing capital on the account
 * record itself - see `addBank` for why. Used by `buildAccountBalances` to
 * recognize that transaction and always count it, regardless of any
 * `asOf` cutoff. */
const OPENING_BALANCE_NOTE = 'Initial balance';

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

  readonly accountBalances = computed<AccountBalance[]>(() => this.buildAccountBalances(null));

  /** Same shape as `accountBalances()`, but every balance is rebuilt using
   * only transactions dated on or before `asOfDate` - lets a report
   * reconstruct what balances looked like at the end of a past period
   * instead of always reading today's live figures. A bank/wallet's
   * opening balance (see `addBank`/`addWallet`) has no meaningful date of
   * its own - it's recorded as a transaction stamped with whatever day the
   * account happened to be created in the app, not a real historical
   * event - so it's always included here regardless of `asOfDate`, same as
   * in `accountBalances()`. Without this, an account created today would
   * appear to have had a $0 balance on any past date, which defeats the
   * point of "as of" reconstruction. */
  accountBalancesAsOf(asOfDate: string): AccountBalance[] {
    return this.buildAccountBalances(asOfDate);
  }

  /** Shared by `accountBalances` and `accountBalancesAsOf` - `cutoffDate:
   * null` means "no cutoff" (every transaction counts, i.e. today's live
   * figures), otherwise only transactions dated on or before it count -
   * except an opening-balance transaction (see `OPENING_BALANCE_NOTE`),
   * which always counts since it represents the account's starting point
   * rather than a dated event. */
  private buildAccountBalances(cutoffDate: string | null): AccountBalance[] {
    const s = this._state();
    if (!s) return [];
    const totals = new Map<string, number>();
    const bump = (key: string, delta: number) => totals.set(key, (totals.get(key) ?? 0) + delta);

    for (const t of s.transactions) {
      const isOpeningBalance = t.notes === OPENING_BALANCE_NOTE;
      if (cutoffDate !== null && !isOpeningBalance && t.date > cutoffDate) continue;
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
  }

  /** Principal locked away in still-`active` fixed deposits (no projected
   * interest included - only the money actually committed). Counted
   * whether or not the FD has a bank: when it does, this corrects for that
   * bank's balance already having dropped by the same amount (see
   * `addFixedDeposit`); when it doesn't (a bank-less FD tracked purely as
   * a memo), this is simply the new wealth the FD record itself
   * discloses - either way, this is what keeps Net Worth accurate. A
   * `matured` or `withdrawn` FD's principal is deliberately excluded here:
   * the moment an FD matures, `updateFixedDeposit` immediately books its
   * principal back as an "others-in" transaction (plus its interest as a
   * separate "income" one) when it has a bank, so that money already shows
   * up in the destination account's own balance - counting it here too
   * would double it. */
  readonly activeFixedDepositTotal = computed(() =>
    (this._state()?.fixedDeposits ?? [])
      .filter((fd) => fd.status === 'active')
      .reduce((sum, fd) => sum + fd.amount, 0),
  );

  /** Same idea as `activeFixedDepositTotal`, reconstructed for a past
   * `asOfDate` instead of today's live `status` - an FD is counted as
   * still locked as of that date when it had already started
   * (`fd.startDate <= asOfDate`) and hadn't yet naturally matured by then
   * (`fdMaturityDate(fd) > asOfDate`), regardless of what's happened to it
   * since. This can't account for an *early* withdrawal, though: unlike a
   * natural maturity, an early withdrawal has no date field of its own, so
   * there's no way to tell whether it was still locked as of a past date -
   * a `withdrawn` FD is excluded here entirely rather than guessed at,
   * which can slightly understate a historical total when the withdrawal
   * actually happened after `asOfDate`. */
  activeFixedDepositTotalAsOf(asOfDate: string): number {
    return (this._state()?.fixedDeposits ?? [])
      .filter((fd) => fd.status !== 'withdrawn')
      .filter((fd) => fd.startDate <= asOfDate && fdMaturityDate(fd) > asOfDate)
      .reduce((sum, fd) => sum + fd.amount, 0);
  }

  /** Same idea as `activeFixedDepositTotal`, for Investments - the invested
   * amount of every still-`active` investment, with or without a "from
   * fund" (no projected gain/loss included, since that isn't known until
   * it completes). Excludes `completed` investments for the same reason
   * `activeFixedDepositTotal` excludes matured/withdrawn FDs: the moment
   * one completes, `completeInvestment` books its payout straight into the
   * destination account's own balance, so counting it here too would
   * double it. */
  readonly activeInvestmentTotal = computed(() =>
    (this._state()?.investments ?? [])
      .filter((inv) => inv.status === 'active')
      .reduce((sum, inv) => sum + inv.amount, 0),
  );

  /** Same idea as `activeInvestmentTotal`, reconstructed for a past
   * `asOfDate` using each investment's `date`/`completionDate` instead of
   * today's live `status` - fully reconstructable, unlike Fixed Deposits,
   * since a completed investment's payout date is always recorded: an
   * investment counts as still active as of that date when it had already
   * started and either hasn't completed yet at all, or completed only
   * after `asOfDate`. */
  activeInvestmentTotalAsOf(asOfDate: string): number {
    return (this._state()?.investments ?? [])
      .filter((inv) => inv.date <= asOfDate && (!inv.completionDate || inv.completionDate > asOfDate))
      .reduce((sum, inv) => sum + inv.amount, 0);
  }

  /** Total account balances plus money currently locked away in active
   * fixed deposits and active investments - without this, placing an FD or
   * opening an investment makes Net Worth look like it dropped by that
   * amount, when really that money hasn't gone anywhere (or, for a
   * bank-less one, wasn't counted at all until you told SparrowFi about
   * it). */
  readonly netWorth = computed(
    () =>
      this.accountBalances().reduce((sum, a) => sum + a.balance, 0) +
      this.activeFixedDepositTotal() +
      this.activeInvestmentTotal(),
  );

  constructor(private readonly cloudData: CloudDataService) {}

  // ----- Lifecycle: load / save / sign out --------------------------------

  /** Loads the signed-in account's data from Supabase (decrypting
   * client-side), or seeds a fresh empty state with the default category
   * list for a brand-new account that hasn't saved anything yet. Called by
   * the Launcher right after a successful sign-in/sign-up. An existing
   * account is topped up with any category the app depends on by name that
   * it's missing (`ensureRequiredCategories`) - there's no more manual
   * "Load Suggested Categories" step to do that by hand. */
  async load(): Promise<void> {
    const loaded = await this.cloudData.load();
    this._state.set(
      loaded
        ? {
            ...loaded,
            categories: ensureRequiredCategories(loaded.categories),
            // Backfills the field for any account saved before Recurring
            // Transactions existed - without this, an older save's `loaded`
            // object simply has no `recurringTransactions` key at all, and
            // every `s.recurringTransactions.___` call throughout this
            // service would throw the moment that account's data loads.
            recurringTransactions: loaded.recurringTransactions ?? [],
          }
        : { ...createEmptyState(), categories: createDefaultCategories() },
    );
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

  /** Creates a bank. `bank.initialCapital`, if non-zero, is recorded as an
   * "Initial balance" transaction (categorized as "Adjustment (In)" when
   * that locked category exists - see `Category.locked`) rather than
   * stored on the bank record itself - same pattern `migrateState` uses
   * for a legacy file's initialCapital, so a bank's balance is always
   * "opening transaction + everything since" with nothing to double-count.
   * This also means there is no `initialCapital` field left to edit
   * afterwards: `updateBank` only ever touches name/color, by design - a
   * bank's opening balance is a one-time thing set at creation, not
   * something you come back and change later (adjust it with a regular
   * transaction instead). */
  addBank(bank: Omit<Bank, 'id'>): void {
    const id = generateId();
    const capital = bank.initialCapital || 0;
    this.updateState((s) => {
      const category = s.categories.find((c) => c.type === 'others-in' && c.name === 'Adjustment (In)');
      return {
        ...s,
        banks: [...s.banks, { name: bank.name, color: bank.color, id, initialCapital: 0 }],
        transactions:
          capital !== 0
            ? [
                ...s.transactions,
                {
                  id: generateId(),
                  date: new Date().toISOString().slice(0, 10),
                  amount: Math.abs(capital),
                  type: 'others-in',
                  accountType: 'bank',
                  accountId: id,
                  categoryId: category?.id,
                  notes: OPENING_BALANCE_NOTE,
                },
              ]
            : s.transactions,
      };
    });
  }
  /** Name/color only - see `addBank` for why initial capital isn't here. */
  updateBank(id: string, patch: Pick<Bank, 'name' | 'color'>): void {
    this.updateState((s) => ({
      ...s,
      banks: s.banks.map((b) => (b.id === id ? { ...b, ...patch, id } : b)),
    }));
  }
  /** Refuses to delete a bank that any transaction still references
   * (including ones this service generated itself, like a fixed deposit's
   * opening/maturity entries or the bank's own opening balance) - deleting
   * the account out from under its history used to silently cascade-delete
   * that history along with it, which is exactly the kind of data loss a
   * misclick shouldn't cause. Throws instead so `AccountsPage` can show
   * why; check `accountHasTransactions` first to avoid the throw entirely. */
  removeBank(id: string): void {
    if (this.accountHasTransactions('bank', id)) {
      throw new Error(
        'This bank has transactions linked to it and can’t be deleted. Delete or reassign those transactions first.',
      );
    }
    this.updateState((s) => ({ ...s, banks: s.banks.filter((b) => b.id !== id) }));
  }

  /** Same opening-balance-as-transaction pattern as `addBank`. */
  addWallet(wallet: Omit<Wallet, 'id'>): void {
    const id = generateId();
    const capital = wallet.initialCapital || 0;
    this.updateState((s) => {
      const category = s.categories.find((c) => c.type === 'others-in' && c.name === 'Adjustment (In)');
      return {
        ...s,
        wallets: [...s.wallets, { name: wallet.name, color: wallet.color, id, initialCapital: 0 }],
        transactions:
          capital !== 0
            ? [
                ...s.transactions,
                {
                  id: generateId(),
                  date: new Date().toISOString().slice(0, 10),
                  amount: Math.abs(capital),
                  type: 'others-in',
                  accountType: 'wallet',
                  accountId: id,
                  categoryId: category?.id,
                  notes: OPENING_BALANCE_NOTE,
                },
              ]
            : s.transactions,
      };
    });
  }
  /** Name/color only - see `addBank` for why initial capital isn't here. */
  updateWallet(id: string, patch: Pick<Wallet, 'name' | 'color'>): void {
    this.updateState((s) => ({
      ...s,
      wallets: s.wallets.map((w) => (w.id === id ? { ...w, ...patch, id } : w)),
    }));
  }
  /** Same "refuse rather than cascade" rule as `removeBank`. */
  removeWallet(id: string): void {
    if (this.accountHasTransactions('wallet', id)) {
      throw new Error(
        'This wallet has transactions linked to it and can’t be deleted. Delete or reassign those transactions first.',
      );
    }
    this.updateState((s) => ({ ...s, wallets: s.wallets.filter((w) => w.id !== id) }));
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
  /** Same "refuse rather than cascade" rule as `removeBank`. */
  removeCard(id: string): void {
    if (this.accountHasTransactions('card', id)) {
      throw new Error(
        'This card has transactions linked to it and can’t be deleted. Delete or reassign those transactions first.',
      );
    }
    this.updateState((s) => ({ ...s, cards: s.cards.filter((c) => c.id !== id) }));
  }

  /** Whether any transaction currently references this bank/wallet/card -
   * including transactions StateService generated itself (a fixed
   * deposit's opening/maturity entries, or an account's own opening
   * balance). Used by the three `remove*` methods above to refuse
   * deletion, and by `AccountsPage` to explain why before even asking for
   * delete confirmation. */
  accountHasTransactions(accountType: 'bank' | 'wallet' | 'card', accountId: string): boolean {
    return (this._state()?.transactions ?? []).some(
      (t) => t.accountType === accountType && t.accountId === accountId,
    );
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
   * `migrateState`'s "Initial balance" transactions) - skipped entirely
   * when no bank was chosen (the FD is tracked purely as a memo). Uses the
   * "Investment (Out)" locked default category when present, but works
   * fine without it - see `Category.locked` for why Fixed Deposits and
   * Investments share the same three categories. */
  addFixedDeposit(fd: Omit<FixedDeposit, 'id'>): void {
    const id = generateId();
    this.updateState((s) => {
      const bank = s.banks.find((b) => b.id === fd.bankId);
      const category = s.categories.find(
        (c) => c.type === 'others-out' && c.name === 'Investment (Out)',
      );
      const transactions: Transaction[] = fd.bankId
        ? [
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
          ]
        : s.transactions;
      return {
        ...s,
        fixedDeposits: [...s.fixedDeposits, { ...fd, id }],
        transactions,
      };
    });
  }

  /** Patches a fixed deposit and keeps any transaction(s) it previously
   * generated in sync with the new values - including adding or dropping
   * the opening transaction if `bankId` is set or cleared after creation,
   * same as `updateInvestment` does for an investment's "from fund". The
   * moment `status` transitions into 'matured' for the first time (or on
   * any later edit to an already-matured/withdrawn FD), this also books
   * the maturity payout - credited to `toBankId` (or `bankId` if the
   * proceeds go back to the same account), or skipped entirely if neither
   * is set - as an "others-in" transaction for the principal ("Investment
   * (In)"), plus, only if there's an actual gain, a separate "income"
   * transaction for it ("Investment Profit") so Income totals and Reports
   * reflect the real gain instead of the whole payout looking like a
   * transfer. The gains transaction is omitted (or removed, if one already
   * existed) whenever there's nothing to book - e.g. a 0% FD. */
  updateFixedDeposit(id: string, patch: Partial<FixedDeposit>): void {
    this.updateState((s) => {
      const existing = s.fixedDeposits.find((f) => f.id === id);
      if (!existing) return s;
      const updated: FixedDeposit = { ...existing, ...patch, id };
      const hasMatured = updated.status === 'matured' || updated.status === 'withdrawn';
      const destBankId = updated.toBankId || updated.bankId;

      // Keep the opening (others-out) transaction lined up with the FD's
      // current bank/amount/date - adding or dropping it if `bankId` was
      // set or cleared since it was created.
      const openingTx = s.transactions.find((t) => t.fdId === id && t.type === 'others-out');
      let transactions = s.transactions;
      if (updated.bankId) {
        const openCategory = s.categories.find(
          (c) => c.type === 'others-out' && c.name === 'Investment (Out)',
        );
        transactions = openingTx
          ? transactions.map((t) =>
              t.id === openingTx.id
                ? { ...t, date: updated.startDate, amount: updated.amount, accountId: updated.bankId }
                : t,
            )
          : [
              ...transactions,
              {
                id: generateId(),
                fdId: id,
                date: updated.startDate,
                amount: updated.amount,
                type: 'others-out',
                accountType: 'bank',
                accountId: updated.bankId,
                categoryId: openCategory?.id,
                notes: `Fixed Deposit${s.banks.find((b) => b.id === updated.bankId) ? ' - ' + s.banks.find((b) => b.id === updated.bankId)!.name : ''}`,
              },
            ];
      } else if (openingTx) {
        transactions = transactions.filter((t) => t.id !== openingTx.id);
      }

      if (hasMatured && destBankId) {
        const bank = s.banks.find((b) => b.id === destBankId);
        const maturityDate = fdMaturityDate(updated);
        const principal = updated.amount;
        const gain = fdGainValue(updated);

        // Principal returned - a transfer back into the account, not new
        // money, so it stays an "others-in" (mirrors the opening
        // "others-out" `addFixedDeposit` created).
        const principalCategory = s.categories.find(
          (c) => c.type === 'others-in' && c.name === 'Investment (In)',
        );
        const existingPrincipalTx = transactions.find((t) => t.fdId === id && t.type === 'others-in');
        transactions = existingPrincipalTx
          ? transactions.map((t) =>
              t.id === existingPrincipalTx.id
                ? { ...t, date: maturityDate, amount: principal, accountId: destBankId }
                : t,
            )
          : [
              ...transactions,
              {
                id: generateId(),
                fdId: id,
                date: maturityDate,
                amount: principal,
                type: 'others-in',
                accountType: 'bank',
                accountId: destBankId,
                categoryId: principalCategory?.id,
                notes: `Fixed Deposit matured - principal${bank ? ' - ' + bank.name : ''}`,
              },
            ];

        // Interest/gains earned - real income, booked separately.
        const gainCategory = s.categories.find(
          (c) => c.type === 'income' && c.name === 'Investment Profit',
        );
        const existingGainTx = transactions.find((t) => t.fdId === id && t.type === 'income');
        if (gain > 0) {
          transactions = existingGainTx
            ? transactions.map((t) =>
                t.id === existingGainTx.id
                  ? { ...t, date: maturityDate, amount: gain, accountId: destBankId }
                  : t,
              )
            : [
                ...transactions,
                {
                  id: generateId(),
                  fdId: id,
                  date: maturityDate,
                  amount: gain,
                  type: 'income',
                  accountType: 'bank',
                  accountId: destBankId,
                  categoryId: gainCategory?.id,
                  notes: `Fixed Deposit matured - interest earned${bank ? ' - ' + bank.name : ''}`,
                },
              ];
        } else if (existingGainTx) {
          // Edited down to 0% (or less) after already having a gains
          // transaction booked - drop it rather than leave a stale or
          // zero-amount entry behind.
          transactions = transactions.filter((t) => t.id !== existingGainTx.id);
        }
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

  /** Creating an investment optionally moves money out of a "from fund"
   * bank/wallet, so this also records an "others-out" transaction against
   * that account for the invested amount - same pattern as
   * `addFixedDeposit`, except entirely skipped when no "from fund" was
   * chosen (the money came from somewhere outside SparrowFi's tracked
   * accounts). Uses the "Investment (Out)" locked default category when
   * present, but works fine without it. */
  addInvestment(inv: Omit<Investment, 'id' | 'status'>): void {
    const id = generateId();
    this.updateState((s) => {
      const category = s.categories.find(
        (c) => c.type === 'others-out' && c.name === 'Investment (Out)',
      );
      const transactions: Transaction[] =
        inv.fromAccountId && inv.fromAccountType
          ? [
              ...s.transactions,
              {
                id: generateId(),
                investmentId: id,
                date: inv.date,
                amount: inv.amount,
                type: 'others-out',
                accountType: inv.fromAccountType,
                accountId: inv.fromAccountId,
                categoryId: category?.id,
                notes: `Investment - ${inv.name}`,
              },
            ]
          : s.transactions;
      return {
        ...s,
        investments: [...s.investments, { ...inv, id, status: 'active' }],
        transactions,
      };
    });
  }

  /** Patches an investment's own fields (name/amount/date/from fund/to
   * fund) and keeps its opening "others-out" transaction in sync -
   * mirrors `updateFixedDeposit`'s re-sync of the opening transaction, but
   * also handles a "from fund" being added or removed after creation
   * (adding/dropping that transaction rather than just patching it, since
   * a Fixed Deposit's source account can never be unset the way an
   * investment's can). Does NOT complete the investment - see
   * `completeInvestment` for that, since completing needs a final amount
   * this method doesn't take. */
  updateInvestment(
    id: string,
    patch: Partial<Omit<Investment, 'id' | 'status' | 'completionDate' | 'finalAmount'>>,
  ): void {
    this.updateState((s) => {
      const existing = s.investments.find((i) => i.id === id);
      if (!existing) return s;
      const updated: Investment = { ...existing, ...patch, id };
      const openingTx = s.transactions.find(
        (t) => t.investmentId === id && t.type === 'others-out',
      );
      let transactions = s.transactions;

      if (updated.fromAccountId && updated.fromAccountType) {
        const category = s.categories.find(
          (c) => c.type === 'others-out' && c.name === 'Investment (Out)',
        );
        if (openingTx) {
          transactions = transactions.map((t) =>
            t.id === openingTx.id
              ? {
                  ...t,
                  date: updated.date,
                  amount: updated.amount,
                  accountType: updated.fromAccountType!,
                  accountId: updated.fromAccountId!,
                }
              : t,
          );
        } else {
          transactions = [
            ...transactions,
            {
              id: generateId(),
              investmentId: id,
              date: updated.date,
              amount: updated.amount,
              type: 'others-out',
              accountType: updated.fromAccountType,
              accountId: updated.fromAccountId,
              categoryId: category?.id,
              notes: `Investment - ${updated.name}`,
            },
          ];
        }
      } else if (openingTx) {
        // "From fund" was cleared - drop the opening transaction rather
        // than leave one pointing at an account the investment no longer
        // claims to have come from.
        transactions = transactions.filter((t) => t.id !== openingTx.id);
      }

      return {
        ...s,
        investments: s.investments.map((i) => (i.id === id ? updated : i)),
        transactions,
      };
    });
  }

  /** Books an investment's completion, but only when a "to fund" account
   * was chosen - a fund-less investment is a pure memo and completing it
   * moves no money anywhere, so it's marked completed with no transactions
   * at all (and any stale ones from an earlier "to fund" are removed).
   * When there is a "to fund": the smaller of the invested amount and the
   * final amount comes back as an "others-in" "Investment (In)" (so a loss
   * simply shows up as a smaller principal return, with nothing else to
   * categorize), and if `finalAmount` is higher than the invested amount,
   * the excess is booked separately as "Investment Profit" income - that's
   * what makes a real gain show up in Income/Reports instead of the whole
   * payout looking like a neutral transfer. Safe to call again on an
   * already-completed investment (e.g. correcting a typo'd final amount)
   * - it re-syncs the transactions instead of duplicating them, and drops
   * the gain transaction if a later correction erases it. */
  completeInvestment(id: string, completionDate: string, finalAmount: number): void {
    this.updateState((s) => {
      const existing = s.investments.find((i) => i.id === id);
      if (!existing) return s;
      const updated: Investment = { ...existing, status: 'completed', completionDate, finalAmount };

      let transactions = s.transactions;
      const existingPrincipalTx = transactions.find(
        (t) => t.investmentId === id && t.type === 'others-in',
      );
      const existingGainTx = transactions.find(
        (t) => t.investmentId === id && t.type === 'income',
      );

      if (!updated.toAccountId || !updated.toAccountType) {
        // No destination account - nothing to book, and drop any stale
        // completion transactions from a "to fund" that was since cleared.
        if (existingPrincipalTx) transactions = transactions.filter((t) => t.id !== existingPrincipalTx.id);
        if (existingGainTx) transactions = transactions.filter((t) => t.id !== existingGainTx.id);
        return {
          ...s,
          investments: s.investments.map((i) => (i.id === id ? updated : i)),
          transactions,
        };
      }

      // Pulled into their own consts (rather than read as `updated.toAccountId`
      // inline below) so the guard clause above actually narrows them to
      // non-undefined inside the closures passed to `.map()` below - TS
      // doesn't carry a narrowed property access through a nested function.
      const toAccountId = updated.toAccountId;
      const toAccountType = updated.toAccountType;

      const principalAmount = Math.min(updated.amount, finalAmount);
      const gain = Math.max(0, finalAmount - updated.amount);

      const principalCategory = s.categories.find(
        (c) => c.type === 'others-in' && c.name === 'Investment (In)',
      );
      transactions = existingPrincipalTx
        ? transactions.map((t) =>
            t.id === existingPrincipalTx.id
              ? {
                  ...t,
                  date: completionDate,
                  amount: principalAmount,
                  accountType: toAccountType,
                  accountId: toAccountId,
                }
              : t,
          )
        : [
            ...transactions,
            {
              id: generateId(),
              investmentId: id,
              date: completionDate,
              amount: principalAmount,
              type: 'others-in',
              accountType: toAccountType,
              accountId: toAccountId,
              categoryId: principalCategory?.id,
              notes: `Investment completed - principal - ${updated.name}`,
            },
          ];

      const gainCategory = s.categories.find(
        (c) => c.type === 'income' && c.name === 'Investment Profit',
      );
      if (gain > 0) {
        transactions = existingGainTx
          ? transactions.map((t) =>
              t.id === existingGainTx.id
                ? {
                    ...t,
                    date: completionDate,
                    amount: gain,
                    accountType: toAccountType,
                    accountId: toAccountId,
                  }
                : t,
            )
          : [
              ...transactions,
              {
                id: generateId(),
                investmentId: id,
                date: completionDate,
                amount: gain,
                type: 'income',
                accountType: toAccountType,
                accountId: toAccountId,
                categoryId: gainCategory?.id,
                notes: `Investment completed - gain - ${updated.name}`,
              },
            ];
      } else if (existingGainTx) {
        // Broke even or a loss - drop any stale gain transaction from a
        // previous completion attempt with a higher final amount.
        transactions = transactions.filter((t) => t.id !== existingGainTx.id);
      }

      return {
        ...s,
        investments: s.investments.map((i) => (i.id === id ? updated : i)),
        transactions,
      };
    });
  }

  /** Deleting an investment record also removes whatever transaction(s) it
   * auto-generated (opening and/or completion) - same cascade as
   * `removeFixedDeposit`. */
  removeInvestment(id: string): void {
    this.updateState((s) => ({
      ...s,
      investments: s.investments.filter((i) => i.id !== id),
      transactions: s.transactions.filter((t) => t.investmentId !== id),
    }));
  }

  // ----- Recurring Transactions ------------------------------------------
  // A recurring item is only ever a *template* - creating or editing one
  // never touches `transactions[]` on its own. `triggerRecurring`/
  // `triggerAllRecurring` are the only two places that turn a template into
  // a real, ordinary transaction (see `RecurringTransaction`'s doc comment
  // for why there's no background scheduler doing this automatically).

  /** `r.lines` come in without ids (the caller - the Recurring page's form
   * - doesn't assign them) - ids are generated here, same as the
   * template's own id, keeping id generation inside `StateService` rather
   * than scattered across page components. */
  addRecurring(r: Omit<RecurringTransaction, 'id' | 'lines'> & { lines: Omit<RecurringLine, 'id'>[] }): void {
    this.updateState((s) => ({
      ...s,
      recurringTransactions: [
        ...s.recurringTransactions,
        { ...r, id: generateId(), lines: r.lines.map((line) => ({ ...line, id: generateId() })) },
      ],
    }));
  }

  /** `patch.lines`, if given, *replaces* the template's whole line set
   * (the Recurring page's Add/Edit form always saves the complete list
   * rather than patching individual lines) - fresh ids are generated for
   * it the same way `addRecurring` does. Omitting `lines` from `patch`
   * leaves the existing lines untouched. */
  updateRecurring(
    id: string,
    patch: Partial<Omit<RecurringTransaction, 'id' | 'lines'>> & { lines?: Omit<RecurringLine, 'id'>[] },
  ): void {
    this.updateState((s) => ({
      ...s,
      recurringTransactions: s.recurringTransactions.map((r) =>
        r.id === id
          ? {
              ...r,
              ...patch,
              id,
              lines: patch.lines ? patch.lines.map((line) => ({ ...line, id: generateId() })) : r.lines,
            }
          : r,
      ),
    }));
  }

  /** Deleting a recurring template does NOT touch any transaction it
   * already produced (see `Transaction.recurringId`'s doc comment) - only
   * the template itself, and only future occurrences, go away. */
  removeRecurring(id: string): void {
    this.updateState((s) => ({
      ...s,
      recurringTransactions: s.recurringTransactions.filter((r) => r.id !== id),
    }));
  }

  /** Flips `paused` on one recurring item - see `RecurringTransaction.paused`
   * for what pausing actually changes (only `triggerAllRecurring`'s
   * behavior; triggering it individually is unaffected). */
  togglePauseRecurring(id: string): void {
    this.updateState((s) => ({
      ...s,
      recurringTransactions: s.recurringTransactions.map((r) =>
        r.id === id ? { ...r, paused: !r.paused } : r,
      ),
    }));
  }

  /** Books one recurring item as real transactions dated on its current
   * `nextDate` - one transaction per line (see `RecurringLine`; most
   * templates have exactly one, but a paycheck-style template can carry
   * several, all booked together) - then advances `nextDate` to the
   * following occurrence per `frequency` - so triggering it again later
   * picks up right where this one left off instead of needing a manual
   * date edit every time. Silently no-ops if the id no longer exists (e.g.
   * a stale reference from a closed tab). */
  triggerRecurring(id: string): void {
    this.updateState((s) => {
      const r = s.recurringTransactions.find((x) => x.id === id);
      if (!r) return s;
      return {
        ...s,
        transactions: [...s.transactions, ...this.recurringLineTransactions(r, r.nextDate)],
        recurringTransactions: s.recurringTransactions.map((x) =>
          x.id === id ? { ...x, nextDate: nextOccurrenceDate(x.nextDate, x.frequency) } : x,
        ),
      };
    });
  }

  /** Same as `triggerRecurring`, but for every recurring item at once - the
   * Recurring page's "Add All to Transactions" action - as a single state
   * update rather than one signal write per item. A `paused` item is
   * skipped here (none of its lines are booked), but its `nextDate` still
   * advances to the following occurrence exactly like an unpaused one - so
   * pausing something doesn't leave it stuck on a stale date, or silently
   * dump a backlog of skipped occurrences onto it the moment it's
   * unpaused. Pausing has no effect on triggering that item individually
   * (`triggerRecurring`), only on this bulk action. */
  triggerAllRecurring(): void {
    this.updateState((s) => {
      if (s.recurringTransactions.length === 0) return s;
      const newTransactions: Transaction[] = s.recurringTransactions
        .filter((r) => !r.paused)
        .flatMap((r) => this.recurringLineTransactions(r, r.nextDate));
      return {
        ...s,
        transactions: [...s.transactions, ...newTransactions],
        recurringTransactions: s.recurringTransactions.map((r) => ({
          ...r,
          nextDate: nextOccurrenceDate(r.nextDate, r.frequency),
        })),
      };
    });
  }

  /** One real `Transaction` per line of `r`, all dated `date` and all
   * carrying `recurringId: r.id` - the shared building block behind
   * `triggerRecurring`/`triggerAllRecurring`, so "book this template's
   * lines on this date" is defined exactly once. */
  private recurringLineTransactions(r: RecurringTransaction, date: string): Transaction[] {
    const notes = this.recurringNotes(r);
    return r.lines.map((line) => ({
      id: generateId(),
      date,
      amount: line.amount,
      type: line.type,
      accountType: line.accountType,
      accountId: line.accountId,
      categoryId: line.categoryId,
      notes,
      recurringId: r.id,
    }));
  }

  /** Builds the `notes` shared by every transaction a recurring template's
   * lines create together: leads with the recurring item's own name (its
   * "title") so the generated transactions read like the app's other
   * auto-generated notes (e.g. `Fixed Deposit - <bank>`, `Investment -
   * <name>`), then appends any notes typed on the template itself, if
   * present. All lines from the same trigger share this text - their
   * account/category/amount are what tell them apart in the Transactions
   * list, and they all carry the same `recurringId` besides. */
  private recurringNotes(r: RecurringTransaction): string {
    return r.notes ? `${r.name} - ${r.notes}` : r.name;
  }

  private requireState(): AppState {
    const s = this._state();
    if (!s) throw new Error('No account data is currently loaded.');
    return s;
  }
}
