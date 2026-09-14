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
  };
}
