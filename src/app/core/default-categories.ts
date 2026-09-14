import { Category, TransactionType } from './models';
import { generateId } from './id.util';

/** Curated starter categories - the seed for a brand-new account
 * (`createDefaultCategories` below) and the source list `ensureRequiredCategories`
 * checks an existing account against. Mirrors `category.txt` at the repo
 * root - keep the two in sync if this list changes.
 *
 * No default Commitment categories - unlike Income/Expense, there's no
 * one-size-fits-all starter set for fixed obligations (rent, loan
 * installments, etc.); those are personal enough that the user adds their
 * own from scratch.
 *
 * Five entries carry `locked: true` because `StateService` looks them up
 * by this exact type+name to auto-categorize transactions it generates
 * itself (see `Category.locked`). Fixed Deposits and Investments
 * deliberately share the same three "Investment ..." categories rather
 * than having their own:
 * - "Investment (Out)" (others-out) - principal moved out when a Fixed Deposit is opened, or an Investment starts with a "from fund".
 * - "Investment (In)" (others-in) - principal returned when a Fixed Deposit matures, or an Investment completes.
 * - "Investment Profit" (income) - the gain, if any, on either one.
 * - "Adjustment (In)" (others-in) - a new bank/wallet's non-zero initial balance.
 * - "Adjustment (Out)" (others-out) - reserved for manual balance corrections; nothing auto-assigns it yet.
 * Everything else here is a normal, deletable starter suggestion like any other. */
export const STARTER_CATEGORIES: { name: string; type: TransactionType; color: string; locked?: boolean }[] = [
  // Income
  { name: 'Salary', type: 'income', color: '#16A34A' },
  { name: 'Investment Profit', type: 'income', color: '#10B981', locked: true },
  { name: 'Others (Income)', type: 'income', color: '#84CC16' },

  // Expenses
  { name: 'Food & Drink', type: 'expense', color: '#F97316' },
  { name: 'Groceries', type: 'expense', color: '#EA580C' },
  { name: 'Bills & Utilities', type: 'expense', color: '#F59E0B' },
  { name: 'Petrol & Transport', type: 'expense', color: '#D97706' },
  { name: 'Toll', type: 'expense', color: '#EAB308' },
  { name: 'Shopping', type: 'expense', color: '#EC4899' },
  { name: 'Entertainment', type: 'expense', color: '#DB2777' },
  { name: 'Health and Medical', type: 'expense', color: '#EF4444' },
  { name: 'Travel', type: 'expense', color: '#DC2626' },
  { name: 'Work Expenses', type: 'expense', color: '#78716C' },
  { name: 'Others (Expenses)', type: 'expense', color: '#57534E' },

  // Commitment - deliberately none, see comment above.

  // Others In
  { name: 'Transfer (In)', type: 'others-in', color: '#0EA5E9' },
  { name: 'Investment (In)', type: 'others-in', color: '#0369A1', locked: true },
  { name: 'Adjustment (In)', type: 'others-in', color: '#06B6D4', locked: true },

  // Others Out
  { name: 'Transfer (Out)', type: 'others-out', color: '#6366F1' },
  { name: 'Investment (Out)', type: 'others-out', color: '#4338CA', locked: true },
  { name: 'Adjustment (Out)', type: 'others-out', color: '#7C3AED', locked: true },
];

/** Names this app used to auto-categorize by before Fixed Deposits and
 * Investments were unified onto the shared "Investment ..." categories
 * (see `STARTER_CATEGORIES`'s doc comment). An account that still has one
 * of these (created before the unification) keeps it - `ensureRequiredCategories`
 * only unlocks it, since nothing auto-targets it by this name anymore and
 * it would otherwise be permanently undeletable for no reason. Renaming or
 * deleting it is left to the user. */
const RETIRED_LOCKED_NAMES = new Set([
  'FD Gain',
  'FD Maturity Withdrawal',
  'FD Placement',
  'Investment Gain',
  'Investment Lost',
]);

function categoryKey(type: TransactionType, name: string): string {
  return `${type}::${name.trim().toLowerCase()}`;
}

/** Fresh `Category` objects (new ids each call) for seeding a new file. */
export function createDefaultCategories(): Category[] {
  return STARTER_CATEGORIES.map((c) => ({
    id: generateId(),
    name: c.name,
    type: c.type,
    color: c.color,
    locked: c.locked || undefined,
  }));
}

/** Makes sure an existing account has every category the app depends on by
 * exact name (see `Category.locked`), adding whichever are missing - this
 * is the only backfill mechanism for those now that there's no manual
 * "Load Suggested Categories" step. Also unlocks any category left over
 * from before Fixed Deposits/Investments shared categories (see
 * `RETIRED_LOCKED_NAMES`), so it doesn't stay permanently undeletable once
 * nothing auto-targets it by that name anymore. Called whenever an
 * account's data is loaded (`StateService.load`) or migrated from a
 * legacy file (`migrateState`) - never called on every `updateState`, so
 * it's cheap to run unconditionally. Safe to call repeatedly; never
 * duplicates or touches anything else. */
export function ensureRequiredCategories(categories: Category[]): Category[] {
  const have = new Set(categories.map((c) => categoryKey(c.type, c.name)));
  const missing = STARTER_CATEGORIES.filter((c) => c.locked && !have.has(categoryKey(c.type, c.name)));

  const unlocked = categories.map((c) =>
    c.locked && RETIRED_LOCKED_NAMES.has(c.name) ? { ...c, locked: undefined } : c,
  );

  if (missing.length === 0) return unlocked;
  return [
    ...unlocked,
    ...missing.map((c) => ({ id: generateId(), name: c.name, type: c.type, color: c.color, locked: true as const })),
  ];
}
