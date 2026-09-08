import { Category, TransactionType } from './models';
import { generateId } from './id.util';

/** Default starter categories offered when creating a brand-new file, one
 * pass of the app's curated palette per group so each category gets a
 * distinct, sensible color out of the box. Mirrors `category.txt` at the
 * repo root - keep the two in sync if this list changes. */
const SEED: { name: string; type: TransactionType; color: string }[] = [
  // Income
  { name: 'Salary', type: 'income', color: '#16A34A' },
  { name: 'Dividend Gain', type: 'income', color: '#22C55E' },
  { name: 'Investment Profit', type: 'income', color: '#10B981' },
  { name: 'Rental Income', type: 'income', color: '#059669' },
  { name: 'Others (Income)', type: 'income', color: '#84CC16' },

  // Expenses
  { name: 'Food and Drinks', type: 'expense', color: '#F97316' },
  { name: 'Grocery', type: 'expense', color: '#EA580C' },
  { name: 'Bills and Utilities', type: 'expense', color: '#F59E0B' },
  { name: 'Petrol & Transport', type: 'expense', color: '#D97706' },
  { name: 'Toll', type: 'expense', color: '#EAB308' },
  { name: 'Shopping', type: 'expense', color: '#EC4899' },
  { name: 'Entertainment', type: 'expense', color: '#DB2777' },
  { name: 'Health and Medical', type: 'expense', color: '#EF4444' },
  { name: 'Travel', type: 'expense', color: '#DC2626' },
  { name: 'Work Expenses', type: 'expense', color: '#78716C' },
  { name: 'Others (Expenses)', type: 'expense', color: '#57534E' },

  // Others In
  { name: 'Transfer (In)', type: 'others-in', color: '#0EA5E9' },
  { name: 'Investment (In)', type: 'others-in', color: '#0284C7' },
  { name: 'Adjustment (In)', type: 'others-in', color: '#06B6D4' },

  // Others Out
  { name: 'Transfer (Out)', type: 'others-out', color: '#6366F1' },
  { name: 'Investment (Out)', type: 'others-out', color: '#4F46E5' },
  { name: 'Bank Withdrawal', type: 'others-out', color: '#8B5CF6' },
  { name: 'Credit Card Payment', type: 'others-out', color: '#A855F7' },
  { name: 'Adjustment (Out)', type: 'others-out', color: '#7C3AED' },
];

/** Fresh `Category` objects (new ids each call) for seeding a new file. */
export function createDefaultCategories(): Category[] {
  return SEED.map((c) => ({ id: generateId(), name: c.name, type: c.type, color: c.color }));
}
