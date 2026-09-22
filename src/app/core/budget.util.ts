import { Transaction } from './models';

/** Total amount of `type: 'expense'` transactions posted against one
 * category within one 'YYYY-MM' month - the "actual spend" half of the
 * Budget page's Last Month / This Month columns (the other half, the cap
 * itself, is just `Budget.amount`). Deliberately the same `type: 'expense'`
 * scope Dashboard's "Where It Went" donut uses (`dashboard.ts`'s
 * `categorySpend`) - commitments, income and transfers aren't the kind of
 * discretionary spend a budget caps. */
export function expenseTotalForCategory(
  transactions: Transaction[],
  categoryId: string,
  monthKey: string,
): number {
  let total = 0;
  for (const t of transactions) {
    if (t.type === 'expense' && t.categoryId === categoryId && t.date.slice(0, 7) === monthKey) {
      total += t.amount;
    }
  }
  return total;
}
