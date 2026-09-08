/**
 * SparrowFi application state model.
 *
 * This mirrors the JSON schema documented in `Sparrow.md` exactly. Every
 * `.spw` file (SPW1/SPW2/SPW3) decodes to this shape after decompression /
 * decryption, and every save re-serializes this shape before it is encoded
 * back to bytes.
 */

export type Currency = 'myr' | 'usd' | 'eur' | 'gbp' | 'sgd' | 'aud';

export type TransactionType = 'income' | 'expense' | 'others-in' | 'others-out';

export type AccountType = 'bank' | 'wallet' | 'card' | 'cash' | 'others';

export type FixedDepositStatus = 'active' | 'matured' | 'withdrawn';

export interface UserInfo {
  isNew: boolean;
  lastExport: string | null;
}

export interface Settings {
  currency: Currency;
  passwordEnabled: boolean;
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
}

export interface FixedDeposit {
  id: string;
  bankId: string;
  toBankId?: string;
  startDate: string;
  amount: number;
  percentage: number;
  months: number;
  status: FixedDepositStatus;
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
    settings: { currency: 'myr', passwordEnabled: false },
    banks: [],
    wallets: [],
    cards: [],
    categories: [],
    transactions: [],
    fixedDeposits: [],
  };
}
