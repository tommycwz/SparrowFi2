/**
 * SparrowFi application state model.
 *
 * This is the shape stored (as encrypted JSON) in Supabase - one record
 * per signed-in account, loaded on sign-in and saved back on demand. It's
 * also still what a legacy `.spw` file (SPW1/SPW2/SPW3) decodes to, for
 * the one-time "Import Legacy File" flow in Settings that migrates an old
 * local file into your account.
 */

export type Currency = 'myr' | 'usd' | 'eur' | 'gbp' | 'sgd' | 'aud';

/** `commitment` is a fixed, recurring obligation (rent, loan installments,
 * insurance premiums, subscriptions) - money that's already spoken for
 * before the month starts. It's tracked as its own sibling of `expense`
 * (rather than a tag on expense categories) so it gets its own totals,
 * its own color, and its own place in the Type picker - "how much of my
 * outflow is committed vs. still variable" is a first-class question, not
 * a footnote on Expenses. Both still reduce Net Cash Flow the same way. */
export type TransactionType = 'income' | 'expense' | 'commitment' | 'others-in' | 'others-out';

/** Display label for each transaction type - the single source of truth so
 * every screen (Add Transaction's type picker, Categories' tabs, CSV
 * export/import) shows the same wording. */
export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  income: 'Income',
  expense: 'Expense',
  commitment: 'Commitment',
  'others-in': 'Others (In)',
  'others-out': 'Others (Out)',
};

export type AccountType = 'bank' | 'wallet' | 'card' | 'cash' | 'others';

export type FixedDepositStatus = 'active' | 'matured' | 'withdrawn';

export interface UserInfo {
  isNew: boolean;
  lastExport: string | null;
}

export interface Settings {
  currency: Currency;
}

export interface Bank {
  id: string;
  name: string;
  initialCapital: number;
  color: string;
}

export interface Wallet {
  id: string;
  name: string;
  initialCapital: number;
  color: string;
}

export interface Card {
  id: string;
  name: string;
  color: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  type: TransactionType;
  /** True only for the handful of default categories a core app feature
   * depends on by exact name - `StateService` looks these up to
   * auto-categorize transactions it generates itself. Fixed Deposits and
   * Investments deliberately share the same three categories rather than
   * having their own - both are "money that left/returned to an account
   * for an investment-like reason", so there's no need to distinguish them
   * by category:
   * - "Investment (Out)" (others-out) - principal moved out when a Fixed Deposit is opened (`addFixedDeposit`) or an Investment starts with a "from fund" (`addInvestment`).
   * - "Investment (In)" (others-in) - principal returned when a Fixed Deposit matures (`updateFixedDeposit`) or an Investment completes (`completeInvestment`).
   * - "Investment Profit" (income) - the gain, if any, on top of the principal for either a matured Fixed Deposit or a completed Investment.
   * - "Adjustment (In)" (others-in) - a new bank/wallet's non-zero initial balance (`addBank`/`addWallet`).
   * - "Adjustment (Out)" (others-out) - reserved for manual balance corrections; nothing auto-assigns it yet.
   * `ensureRequiredCategories` (see `default-categories.ts`) makes sure
   * every account has all five, backfilling any that are missing - there's
   * no more manual "Load Suggested Categories" step to do that by hand.
   * Deleting one would silently break that auto-categorization, so the
   * Categories page hides its delete button. Rename/recolor/retype still
   * work as normal - this only blocks deletion. Absent (falsy) on every
   * other category, including the rest of the starter set and anything
   * user-added. */
  locked?: boolean;
}

export interface Transaction {
  id: string;
  date: string;
  time?: string;
  amount: number;
  type: TransactionType;
  accountType: AccountType;
  accountId?: string;
  categoryId?: string;
  notes?: string;
  /** Set only on a transaction StateService auto-created for a fixed
   * deposit (opening the FD, or its maturity payout) - links it back to
   * `FixedDeposit.id` so editing/deleting that FD keeps this transaction in
   * sync instead of leaving an orphaned entry. Absent on every other
   * transaction. */
  fdId?: string;
  /** Same idea as `fdId`, but for an Investment (opening it, or its
   * completion payout) - links back to `Investment.id`. Absent on every
   * other transaction. */
  investmentId?: string;
  /** Set only on a transaction `StateService.triggerRecurring`/
   * `triggerAllRecurring` created from a `RecurringTransaction` template -
   * links back to `RecurringTransaction.id`, purely for traceability
   * ("where did this row come from"). Unlike `fdId`/`investmentId`,
   * deleting the recurring template does NOT cascade-delete transactions
   * it already produced: those are ordinary historical transactions the
   * user may since have edited, not a payout tightly coupled to a still-
   * live FD/Investment record. Absent on every other transaction. */
  recurringId?: string;
}

export interface FixedDeposit {
  id: string;
  /** Account the principal comes out of when the FD is opened. Optional -
   * choosing no bank records the FD purely as a memo (e.g. one held
   * somewhere outside SparrowFi's tracked accounts): nothing is deducted
   * on opening and nothing is credited back on maturity. */
  bankId?: string;
  toBankId?: string;
  startDate: string;
  amount: number;
  percentage: number;
  months: number;
  status: FixedDepositStatus;
  /** Freeform notes - what this FD is for, a reference/certificate number,
   * anything worth remembering that doesn't fit another field. Purely
   * informational; never read by any auto-categorization logic. */
  remarks?: string;
}

export type InvestmentStatus = 'active' | 'completed';

/** A general investment (stocks, crypto, a business venture, anything
 * without a Fixed Deposit's predictable rate) that can move money out of
 * one account and, later, back into another - possibly for more or less
 * than was put in, and possibly not touching any tracked account on
 * either end at all (a pure memo). Unlike `FixedDeposit`, there's no
 * formula for the payout: it isn't known until you actually complete the
 * investment, which is why `finalAmount`/`completionDate` only get set at
 * that point (see `StateService.completeInvestment`) rather than up
 * front. */
export interface Investment {
  id: string;
  name: string;
  /** Account the invested amount came out of. Optional - some investments
   * start from money already outside SparrowFi's tracked accounts (e.g.
   * untracked cash), in which case no opening "others-out" transaction is
   * created at all. */
  fromAccountId?: string;
  fromAccountType?: 'bank' | 'wallet';
  /** Account the payout lands in when the investment completes. Also
   * optional, same reasoning as `fromAccountId` - an investment can be a
   * pure memo with no tracked account on either end. */
  toAccountId?: string;
  toAccountType?: 'bank' | 'wallet';
  /** Amount originally invested (the cost basis). */
  amount: number;
  /** Date the investment was opened/started. */
  date: string;
  status: InvestmentStatus;
  /** Set only once `status` is 'completed' - the date the payout actually
   * happened. */
  completionDate?: string;
  /** Set only once `status` is 'completed' - the real amount received back,
   * which may be more, less, or the same as `amount`. */
  finalAmount?: number;
  /** Freeform notes - what this investment is, a ticker/reference, terms,
   * anything worth remembering that doesn't fit another field. Purely
   * informational; never read by any auto-categorization logic. */
  remarks?: string;
}

export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** Display label for each recurring frequency - single source of truth for
 * the Recurring page's picker and card captions. Used as-is only when
 * `RecurringTransaction.interval` is 1 - see `recurrenceLabel` in
 * `recurring.util.ts` for the "every N ___" phrasing above that. */
export const RECURRING_FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

/** Singular/plural unit name for each frequency (`['Day', 'Days']`, etc.) -
 * what the Add/Edit form's "Every [N] ___" picker labels its buttons with,
 * and what `recurring.util.ts`'s `frequencyUnitLabel`/`recurrenceLabel`
 * build sentences out of. */
export const RECURRING_FREQUENCY_UNIT_LABELS: Record<RecurringFrequency, [string, string]> = {
  daily: ['Day', 'Days'],
  weekly: ['Week', 'Weeks'],
  monthly: ['Month', 'Months'],
  yearly: ['Year', 'Years'],
};

/** One transaction a `RecurringTransaction` template books every time it's
 * triggered. Most templates have exactly one (a simple bill or subscription),
 * but a template can carry several - e.g. a paycheck that credits one bank
 * *and*, in the same breath, moves fixed amounts out to other accounts as
 * savings/bills - so triggering the template once produces one transaction
 * per line, all dated the same `nextDate`. */
export interface RecurringLine {
  id: string;
  amount: number;
  type: TransactionType;
  accountType: AccountType;
  accountId?: string;
  categoryId?: string;
}

/** A template for one or more transactions that repeat together on a
 * schedule - a subscription, rent, or a paycheck that's simultaneously
 * split into savings/bills across several accounts (see `RecurringLine`).
 * Deliberately does NOT auto-create transactions on its own (there's no
 * background scheduler in a client-only PWA with no server component): the
 * user reviews the Recurring page and taps a specific item, or "Add All",
 * when they want it actually booked - see
 * `StateService.triggerRecurring`/`triggerAllRecurring`, which stamp one
 * real `Transaction` per line, all dated `nextDate`, and then advance
 * `nextDate` to the following occurrence (`nextOccurrenceDate`) so the
 * template is ready for next time without a manual date edit. `nextDate`
 * can be moved to any date at all (not just the day it was created on), so
 * an existing bill on any schedule can be entered as-is rather than forced
 * onto today's date. */
export interface RecurringTransaction {
  id: string;
  /** Short label for the list - "Netflix", "Rent", "Salary" - independent
   * of category naming, since two different recurring items can share a
   * category. */
  name: string;
  /** Always at least one line - see `RecurringLine`. */
  lines: RecurringLine[];
  frequency: RecurringFrequency;
  /** How many `frequency` units apart occurrences are - e.g. `frequency:
   * 'weekly'` with `interval: 2` is every 2 weeks (bi-weekly), `interval: 3`
   * is every 3 weeks (tri-weekly), and so on for any frequency and any N.
   * Always a positive integer once normalized (see `normalizeInterval` in
   * `recurring.util.ts`, which every write path - `StateService.addRecurring`/
   * `updateRecurring`, and legacy-file migration - runs it through).
   * Absent means 1 (plain "every day/week/month/year", the only behavior
   * that existed before this field did). */
  interval?: number;
  /** The date this item is next due, and what gets stamped on every
   * transaction it creates when triggered - freely editable to any date,
   * not limited to "today" or a fixed day-of-month. */
  nextDate: string;
  /** For `monthly`/`yearly` only - the day-of-month this item is meant to
   * land on, independent of whatever `nextDate` currently holds. Always
   * kept in sync with the day of `nextDate` as of the last time a person
   * actually set it (`addRecurring`/`updateRecurring` recompute it from
   * `nextDate` on every save - see `anchorDayOf`), which is what lets an
   * item anchored to the 31st keep aiming for the 31st every month instead
   * of drifting to whatever shorter day a previous month's clamp landed on
   * (see `nextOccurrenceDate`'s doc comment for the full explanation).
   * Ignored for `daily`/`weekly`. Absent is treated as the day of the
   * current `nextDate`. */
  anchorDay?: number;
  /** Freeform notes for the template as a whole, copied onto every
   * transaction every one of its lines creates. */
  notes?: string;
  /** When true, `StateService.triggerAllRecurring` ("Add All to
   * Transactions") skips booking this item's lines - but still advances
   * its `nextDate` to the following occurrence, same as an unpaused item,
   * so a paused subscription/bill doesn't quietly build up a backlog of
   * missed dates while it's off. Doesn't affect triggering this item
   * individually, which always books it regardless of this flag - pausing
   * only changes what "Add All" does with it. Absent/false means not
   * paused. */
  paused?: boolean;
}

/** A monthly spending cap for one category - "how much do I want to spend
 * on X this month". Always targets a `type: 'expense'` category (see the
 * Budget page's category picker, which only ever offers Expense
 * categories - commitments are already fixed/known amounts, and
 * income/transfer categories aren't spend a cap makes sense against).
 * There's no "budget for March vs. April" - the same `amount` just applies
 * fresh every calendar month; the Budget page compares it against that
 * month's actual `type: 'expense'` transactions for the category (see
 * `expenseTotalForCategory` in `budget.util.ts`). At most one `Budget` per
 * `categoryId` in normal use - the Budget page's "Add" picker only offers
 * categories that don't already have one, so a duplicate never gets
 * created through the UI (`StateService.addBudget` itself doesn't enforce
 * this - see its doc comment). */
export interface Budget {
  id: string;
  categoryId: string;
  /** The monthly cap - always saved as a positive number (the Budget
   * page's form rejects zero/negative before it ever reaches
   * `StateService`). */
  amount: number;
}

export interface AppState {
  user: UserInfo;
  settings: Settings;
  banks: Bank[];
  wallets: Wallet[];
  cards: Card[];
  categories: Category[];
  transactions: Transaction[];
  fixedDeposits: FixedDeposit[];
  investments: Investment[];
  recurringTransactions: RecurringTransaction[];
  budgets: Budget[];
}

export const CURRENCIES: { value: Currency; label: string; symbol: string }[] = [
  { value: 'myr', label: 'Malaysian Ringgit', symbol: 'RM' },
  { value: 'usd', label: 'US Dollar', symbol: '$' },
  { value: 'eur', label: 'Euro', symbol: '€' },
  { value: 'gbp', label: 'British Pound', symbol: '£' },
  { value: 'sgd', label: 'Singapore Dollar', symbol: 'S$' },
  { value: 'aud', label: 'Australian Dollar', symbol: 'A$' },
];

/** A broader color palette (spanning multiple hues x two shades each) for
 * account/category swatch pickers. The pickers also offer a custom color
 * input on top of this, so this list is a curated starting point rather
 * than the only choice. */
export const DEFAULT_CATEGORY_COLORS = [
  '#EF4444',
  '#DC2626',
  '#F97316',
  '#EA580C',
  '#F59E0B',
  '#D97706',
  '#EAB308',
  '#CA8A04',
  '#84CC16',
  '#65A30D',
  '#22C55E',
  '#16A34A',
  '#10B981',
  '#059669',
  '#14B8A6',
  '#0D9488',
  '#06B6D4',
  '#0891B2',
  '#0EA5E9',
  '#0284C7',
  '#3B82F6',
  '#1D4ED8',
  '#6366F1',
  '#4F46E5',
  '#8B5CF6',
  '#7C3AED',
  '#A855F7',
  '#9333EA',
  '#D946EF',
  '#C026D3',
  '#EC4899',
  '#DB2777',
  '#F43F5E',
  '#E11D48',
  '#78716C',
  '#57534E',
];

export function createEmptyState(): AppState {
  return {
    user: { isNew: true, lastExport: null },
    settings: { currency: 'myr' },
    banks: [],
    wallets: [],
    cards: [],
    categories: [],
    transactions: [],
    fixedDeposits: [],
    investments: [],
    recurringTransactions: [],
    budgets: [],
  };
}
