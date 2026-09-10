import { generateId } from './id.util';
import { AppState, Bank, Card, Category, Currency, FixedDeposit, Wallet, createEmptyState } from './models';

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

  // Non-zero initialCapital on banks/wallets becomes an opening-balance
  // transaction, then the field is zeroed to prevent double-counting.
  for (const bank of state.banks) {
    if (bank.initialCapital && bank.initialCapital !== 0) {
      state.transactions.push({
        id: generateId(),
        date: new Date().toISOString().slice(0, 10),
        amount: Math.abs(bank.initialCapital),
        type: 'others-in',
        accountType: 'bank',
        accountId: bank.id,
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
  };
}
