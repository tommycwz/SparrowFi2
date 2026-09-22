import { generateId } from './id.util';
import { ensureRequiredCategories } from './default-categories';
import {
  AppState,
  Bank,
  Budget,
  Card,
  Category,
  Currency,
  FixedDeposit,
  Investment,
  RecurringLine,
  RecurringTransaction,
  Wallet,
  createEmptyState,
} from './models';
import { anchorDayOf, normalizeInterval } from './recurring.util';
import { normalizeBudgetPeriod } from './budget.util';

/**
 * Normalizes a raw, decoded JSON payload (any historical shape) into the
 * current `AppState` schema, applying the migrations documented under
 * "Legacy Migration" in `Sparrow.md`:
 *
 *  - `creditCards[]`            -> `cards[]` (id + name kept, field deleted)
 *  - `dropboxes[]` children     -> flattened into `categories[]` (field deleted)
 *  - `bank.initialCapital !== 0`   -> "Adjustment (In)" transaction, field zeroed
 *  - `wallet.initialCapital !== 0` -> "Adjustment (In)" transaction, field zeroed
 *  - `fixedDeposit.isMatured`   -> `status: 'matured' | 'active'` (field deleted)
 *
 * This is intentionally defensive: it never throws on missing/partial
 * fields, since the goal is to accept anything a previous version of this
 * app (or a hand-edited file) may have produced.
 */
export function migrateState(raw: unknown): AppState {
  const empty = createEmptyState();
  if (!raw || typeof raw !== 'object') {
    return empty;
  }
  // Using `any` (rather than an indexed type) deliberately: this function
  // must tolerate arbitrary/legacy shapes, and `any` avoids the
  // noPropertyAccessFromIndexSignature bracket-notation requirement below.
  const src: any = raw;

  const state: AppState = {
    user: {
      isNew: !!src.user?.isNew,
      lastExport: src.user?.lastExport ?? null,
    },
    settings: {
      currency: (src.settings?.currency as Currency) ?? 'myr',
    },
    banks: Array.isArray(src.banks) ? src.banks.map(normalizeBank) : [],
    wallets: Array.isArray(src.wallets) ? src.wallets.map(normalizeWallet) : [],
    cards: Array.isArray(src.cards) ? src.cards.map(normalizeCard) : [],
    categories: Array.isArray(src.categories) ? src.categories.map(normalizeCategory) : [],
    transactions: Array.isArray(src.transactions) ? [...src.transactions] : [],
    fixedDeposits: Array.isArray(src.fixedDeposits)
      ? src.fixedDeposits.map(normalizeFixedDeposit)
      : [],
    // Investments didn't exist in any legacy file format, so there's
    // nothing to migrate - just make sure the field is always an array.
    investments: Array.isArray(src.investments) ? src.investments.map(normalizeInvestment) : [],
    // Same reasoning as investments - Recurring Transactions is new enough
    // that no legacy file ever had it either.
    recurringTransactions: Array.isArray(src.recurringTransactions)
      ? src.recurringTransactions.map(normalizeRecurring)
      : [],
    // Same reasoning again - Budgets is newer still, so no legacy file (and
    // no pre-Budget cloud save) ever had this key either.
    budgets: Array.isArray(src.budgets) ? src.budgets.map(normalizeBudget) : [],
  };

  // Legacy `creditCards[]` -> `cards[]`.
  if (Array.isArray(src.creditCards)) {
    for (const cc of src.creditCards) {
      state.cards.push({
        id: cc.id ?? generateId(),
        name: cc.name ?? 'Card',
        color: cc.color ?? '#3B82F6',
      });
    }
  }

  // Legacy `dropboxes[]` -> flattened into `categories[]`.
  if (Array.isArray(src.dropboxes)) {
    for (const box of src.dropboxes) {
      const children = Array.isArray(box.children) ? box.children : Array.isArray(box.items) ? box.items : [];
      for (const child of children) {
        state.categories.push(normalizeCategory(child));
      }
    }
  }

  // Top up the migrated file's categories with any locked default it's
  // missing (see `ensureRequiredCategories`) *before* looking one up below -
  // a legacy file predating a given locked category would otherwise never
  // get it until the next `StateService.load()`.
  state.categories = ensureRequiredCategories(state.categories);

  // Non-zero initialCapital on banks/wallets becomes an opening-balance
  // transaction, then the field is zeroed to prevent double-counting -
  // categorized as "Adjustment (In)" when the migrated file's own
  // categories happen to include that locked default (see
  // `Category.locked`), same as `StateService.addBank`/`addWallet`.
  const adjustmentInCategory = state.categories.find(
    (c) => c.type === 'others-in' && c.name === 'Adjustment (In)',
  );
  for (const bank of state.banks) {
    if (bank.initialCapital && bank.initialCapital !== 0) {
      state.transactions.push({
        id: generateId(),
        date: new Date().toISOString().slice(0, 10),
        amount: Math.abs(bank.initialCapital),
        type: 'others-in',
        accountType: 'bank',
        accountId: bank.id,
        categoryId: adjustmentInCategory?.id,
        notes: 'Initial balance',
      });
      bank.initialCapital = 0;
    }
  }
  for (const wallet of state.wallets) {
    if (wallet.initialCapital && wallet.initialCapital !== 0) {
      state.transactions.push({
        id: generateId(),
        date: new Date().toISOString().slice(0, 10),
        amount: Math.abs(wallet.initialCapital),
        type: 'others-in',
        accountType: 'wallet',
        accountId: wallet.id,
        categoryId: adjustmentInCategory?.id,
        notes: 'Initial balance',
      });
      wallet.initialCapital = 0;
    }
  }

  // fixedDeposit.isMatured (boolean) -> status enum.
  state.fixedDeposits = state.fixedDeposits.map((fd: any) => {
    if (fd.isMatured !== undefined && !fd.status) {
      fd.status = fd.isMatured ? 'matured' : 'active';
    }
    delete fd.isMatured;
    return fd;
  });

  return state;
}

function normalizeBank(b: any): Bank {
  return {
    id: b.id ?? generateId(),
    name: b.name ?? 'Bank',
    initialCapital: typeof b.initialCapital === 'number' ? b.initialCapital : 0,
    color: b.color ?? '#22C55E',
  };
}

function normalizeWallet(w: any): Wallet {
  return {
    id: w.id ?? generateId(),
    name: w.name ?? 'Wallet',
    initialCapital: typeof w.initialCapital === 'number' ? w.initialCapital : 0,
    color: w.color ?? '#F97316',
  };
}

function normalizeCard(c: any): Card {
  return {
    id: c.id ?? generateId(),
    name: c.name ?? 'Card',
    color: c.color ?? '#3B82F6',
  };
}

function normalizeCategory(c: any): Category {
  return {
    id: c.id ?? generateId(),
    name: c.name ?? 'Category',
    color: c.color ?? '#F97316',
    type: c.type ?? 'expense',
  };
}

function normalizeFixedDeposit(fd: any): FixedDeposit {
  return {
    id: fd.id ?? generateId(),
    bankId: fd.bankId,
    toBankId: fd.toBankId,
    startDate: fd.startDate ?? new Date().toISOString().slice(0, 10),
    amount: typeof fd.amount === 'number' ? fd.amount : 0,
    percentage: typeof fd.percentage === 'number' ? fd.percentage : 0,
    months: typeof fd.months === 'number' ? fd.months : 12,
    status: fd.status ?? (fd.isMatured ? 'matured' : 'active'),
    remarks: fd.remarks,
  };
}

function normalizeRecurringLine(l: any): RecurringLine {
  return {
    id: l.id ?? generateId(),
    amount: typeof l.amount === 'number' ? l.amount : 0,
    type: l.type ?? 'expense',
    accountType: l.accountType ?? 'bank',
    accountId: l.accountId,
    categoryId: l.categoryId,
  };
}

/** A pre-multi-line recurring item (saved before `RecurringTransaction`
 * gained `lines[]`) carried its one and only line's fields directly on the
 * template itself - `amount`/`type`/`accountType`/`accountId`/`categoryId`.
 * That whole template becomes one line here, so a legacy file keeps
 * behaving exactly as it did before. Same idea for `interval`/`anchorDay`
 * (added once this item already had a `nextDate` to derive a day from) -
 * `normalizeInterval`/`anchorDayOf` give every legacy item the same
 * definite, valid values `StateService.addRecurring`/`updateRecurring`
 * would, rather than leaving them `undefined` for a file saved before
 * either field existed. */
function normalizeRecurring(r: any): RecurringTransaction {
  const lines: RecurringLine[] = Array.isArray(r.lines)
    ? r.lines.map(normalizeRecurringLine)
    : [normalizeRecurringLine(r)];
  const nextDate = r.nextDate ?? new Date().toISOString().slice(0, 10);
  return {
    id: r.id ?? generateId(),
    name: r.name ?? 'Recurring',
    lines: lines.length > 0 ? lines : [normalizeRecurringLine({})],
    frequency: r.frequency ?? 'monthly',
    interval: normalizeInterval(r.interval),
    nextDate,
    anchorDay: typeof r.anchorDay === 'number' ? r.anchorDay : anchorDayOf(nextDate),
    notes: r.notes,
    paused: r.paused === true,
  };
}

function normalizeBudget(b: any): Budget {
  return {
    id: b.id ?? generateId(),
    categoryId: b.categoryId ?? '',
    // Backfills the period for a budget saved before Daily/Weekly/Yearly
    // entry existed (or anything else invalid) to 'monthly' - the cadence
    // every budget implicitly used before then - same as every live write
    // path (`StateService.addBudget`/`updateBudget`) runs through.
    period: normalizeBudgetPeriod(b.period),
    amount: typeof b.amount === 'number' && b.amount > 0 ? b.amount : 0,
  };
}

function normalizeInvestment(inv: any): Investment {
  return {
    id: inv.id ?? generateId(),
    name: inv.name ?? 'Investment',
    fromAccountId: inv.fromAccountId,
    fromAccountType: inv.fromAccountType,
    toAccountId: inv.toAccountId,
    toAccountType: inv.toAccountType,
    amount: typeof inv.amount === 'number' ? inv.amount : 0,
    date: inv.date ?? new Date().toISOString().slice(0, 10),
    status: inv.status ?? 'active',
    completionDate: inv.completionDate,
    finalAmount: typeof inv.finalAmount === 'number' ? inv.finalAmount : undefined,
    remarks: inv.remarks,
  };
}
