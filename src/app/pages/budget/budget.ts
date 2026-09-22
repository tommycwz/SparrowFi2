import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../core/state.service';
import { formatMoney } from '../../core/currency.util';
import { expenseTotalForCategory } from '../../core/budget.util';
import { Category } from '../../core/models';
import { monthKeyOf } from '../../core/format.util';
import { IconComponent } from '../../shared/icon';
import { ModalComponent } from '../../shared/modal';

/** Shifts a 'YYYY-MM' key by `delta` whole months in either direction -
 * same "day 1 of the target month via the local-getter `Date` constructor"
 * technique `reports.ts`'s own `shiftMonthKey` uses, kept page-local here
 * too since it's a two-line pure function and this page is its only other
 * user. */
function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  return monthKeyOf(new Date(y, (m || 1) - 1 + delta, 1));
}

interface BudgetForm {
  categoryId: string;
  amount: string;
}

function blankForm(): BudgetForm {
  return { categoryId: '', amount: '' };
}

/** One row the page renders - a `Budget` folded together with the two
 * actual-spend figures (`expenseTotalForCategory`) it's compared against.
 * Computed fresh from `StateService.state()` rather than stored, so it's
 * always current the moment a new Transaction is recorded - there's
 * nothing to "refresh". */
interface BudgetRow {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  amount: number;
  lastMonthSpent: number;
  thisMonthSpent: number;
  overBudget: boolean;
}

@Component({
  selector: 'app-budget',
  standalone: true,
  imports: [FormsModule, IconComponent, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './budget.html',
  styleUrl: './budget.scss',
})
export class BudgetPage {
  readonly showModal = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly form = signal<BudgetForm>(blankForm());

  constructor(readonly state: StateService) {}

  /** Every Expense category - the only type a `Budget` can target (see its
   * doc comment on the interface). Commitment/Income/Others categories
   * never appear in the picker at all. */
  readonly expenseCategories = computed<Category[]>(() =>
    (this.state.state()?.categories ?? []).filter((c) => c.type === 'expense'),
  );

  /** Expense categories that don't already have a budget - what the "Add
   * Budget" picker offers, so picking one can never create a second Budget
   * for the same category (`StateService.addBudget` itself doesn't guard
   * against that - see its doc comment). */
  readonly unbudgetedCategories = computed<Category[]>(() => {
    const budgeted = new Set((this.state.state()?.budgets ?? []).map((b) => b.categoryId));
    return this.expenseCategories().filter((c) => !budgeted.has(c.id));
  });

  /** Same idea, but for the Edit form's picker: every unbudgeted category
   * *plus* whichever one the item being edited already targets, so editing
   * doesn't just show a single frozen option with nothing else to switch
   * to. Used for "Add" too (where `currentCategoryId` is `''` and matches
   * nothing), so the template only needs the one method. */
  editableCategoryOptions(currentCategoryId: string): Category[] {
    const current = this.expenseCategories().find((c) => c.id === currentCategoryId);
    const rest = this.unbudgetedCategories();
    return current ? [current, ...rest] : rest;
  }

  money(amount: number): string {
    return formatMoney(amount, this.state.state()!.settings.currency);
  }

  /** One row per `Budget`, with last month's and this month's actual
   * Expense spend for that category folded in - sorted by how close to (or
   * past) its cap each one is, so whatever needs attention floats to the
   * top first, same "surface what's urgent" idea the Recurring page's
   * soonest-due-first sort uses. A budget whose category was deleted is
   * silently dropped rather than shown against "Uncategorized" - deleting
   * a category doesn't cascade-delete its budget (same non-cascading
   * choice `Transaction.recurringId` documents for Recurring), so this is
   * just where that leftover budget stops being visible. */
  readonly rows = computed<BudgetRow[]>(() => {
    const s = this.state.state();
    if (!s) return [];
    const thisMonth = monthKeyOf();
    const lastMonth = shiftMonthKey(thisMonth, -1);

    const rows: BudgetRow[] = [];
    for (const b of s.budgets) {
      const category = s.categories.find((c) => c.id === b.categoryId);
      if (!category) continue;
      const thisMonthSpent = expenseTotalForCategory(s.transactions, b.categoryId, thisMonth);
      const lastMonthSpent = expenseTotalForCategory(s.transactions, b.categoryId, lastMonth);
      rows.push({
        id: b.id,
        categoryId: b.categoryId,
        categoryName: category.name,
        categoryColor: category.color,
        amount: b.amount,
        lastMonthSpent,
        thisMonthSpent,
        overBudget: thisMonthSpent > b.amount,
      });
    }

    return rows.sort((a, b) => {
      const aRatio = a.amount > 0 ? a.thisMonthSpent / a.amount : 0;
      const bRatio = b.amount > 0 ? b.thisMonthSpent / b.amount : 0;
      return bRatio - aRatio;
    });
  });

  openAdd(): void {
    this.editingId.set(null);
    this.form.set(blankForm());
    this.showModal.set(true);
  }

  openEdit(row: BudgetRow): void {
    this.editingId.set(row.id);
    this.form.set({ categoryId: row.categoryId, amount: String(row.amount) });
    this.showModal.set(true);
  }

  /** A category must be picked and the amount must be a positive number -
   * same all-or-nothing validation style the rest of the app's Add/Edit
   * forms use (e.g. Recurring's `save()`), rejecting the save outright
   * rather than silently coercing a bad value. */
  save(): void {
    const f = this.form();
    if (!f.categoryId) return;
    const amount = Number(f.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;

    const id = this.editingId();
    if (id) {
      this.state.updateBudget(id, { categoryId: f.categoryId, amount });
    } else {
      this.state.addBudget({ categoryId: f.categoryId, amount });
    }
    this.showModal.set(false);
  }

  remove(id: string): void {
    if (confirm('Delete this budget? This will not affect any recorded transactions.')) {
      this.state.removeBudget(id);
    }
  }
}
