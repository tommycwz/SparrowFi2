import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../core/state.service';
import { formatMoney } from '../../core/currency.util';
import {
  convertBudgetAmount,
  expenseTotalForCategoryInRange,
  normalizeBudgetPeriod,
  periodRange,
  roundMoney,
} from '../../core/budget.util';
import { BUDGET_PERIOD_LABELS, BudgetPeriod, Category } from '../../core/models';
import { IconComponent } from '../../shared/icon';
import { ModalComponent } from '../../shared/modal';

interface BudgetForm {
  categoryId: string;
  amount: string;
  period: BudgetPeriod;
}

function blankForm(period: BudgetPeriod): BudgetForm {
  return { categoryId: '', amount: '', period };
}

/** "how X's (and last X's) actual spending" - the wording `emptyStateHint`
 * below builds its sentence from, one per `BudgetPeriod`. */
const SPEND_PHRASE: Record<BudgetPeriod, string> = {
  daily: "today's (and yesterday's)",
  weekly: "this week's (and last week's)",
  monthly: "this month's (and last month's)",
  yearly: "this year's (and last year's)",
};

/** One row the page renders - a `Budget` folded together with the
 * previous- and current-period actual Expense spend for its category, both
 * expressed in whichever period the page's `tab` is currently viewing
 * (`periodRange` + `expenseTotalForCategoryInRange`, in `budget.util.ts`).
 * Computed fresh from `StateService.state()` rather than stored, so it's
 * always current the moment a new Transaction is recorded - there's
 * nothing to "refresh". Every budgeted category appears in every tab (a
 * `Budget` is one cap, not one per period - see its doc comment on the
 * interface) - only its displayed *amount* changes as `tab` changes,
 * converted live via `convertBudgetAmount`. */
interface BudgetRow {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  /** The budget exactly as stored - `Budget.period`/`amount`, normalized -
   * what `openEdit` seeds the form with, so editing without changing
   * anything can't drift the number through a display-only conversion and
   * back. */
  rawPeriod: BudgetPeriod;
  rawAmount: number;
  /** `rawAmount` converted into the page's current `tab` period - what's
   * actually shown as the cap, and what `overBudget`/the sort order below
   * compare `currentSpent` against. */
  displayAmount: number;
  previousSpent: number;
  currentSpent: number;
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
  readonly periodOptions: BudgetPeriod[] = ['daily', 'weekly', 'monthly', 'yearly'];
  readonly periodLabels = BUDGET_PERIOD_LABELS;

  /** Which period the whole page is currently viewed through - every
   * budgeted category's one cap gets converted into this period for
   * display, and the two spend columns compare against this period's
   * current/previous date range (see `BudgetRow`'s doc comment). */
  readonly tab = signal<BudgetPeriod>('monthly');

  readonly showModal = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly form = signal<BudgetForm>(blankForm('monthly'));

  constructor(readonly state: StateService) {}

  /** Every Expense category - the only type a `Budget` can target (see its
   * doc comment on the interface). Commitment/Income/Others categories
   * never appear in the picker at all. */
  readonly expenseCategories = computed<Category[]>(() =>
    (this.state.state()?.categories ?? []).filter((c) => c.type === 'expense'),
  );

  /** Expense categories that don't already have a budget at all - what the
   * "Add Budget" picker offers, so picking one can never create a second
   * `Budget` for the same category (`StateService.addBudget` itself
   * doesn't guard against that - see its doc comment). */
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

  /** "Today"/"Yesterday", "This Week"/"Previous Week", etc, matching
   * whichever tab is currently showing - the table's two spend-column
   * headers. */
  readonly columnLabels = computed<{ current: string; previous: string }>(() => {
    switch (this.tab()) {
      case 'daily':
        return { current: 'Today', previous: 'Yesterday' };
      case 'weekly':
        return { current: 'This Week', previous: 'Previous Week' };
      case 'monthly':
        return { current: 'This Month', previous: 'Previous Month' };
      case 'yearly':
        return { current: 'This Year', previous: 'Previous Year' };
    }
  });

  readonly emptyStateHint = computed<string>(
    () =>
      `Pick an Expense category and set a spending cap in whichever period is easiest - Daily, Weekly, Monthly, or ` +
      `Yearly. SparrowFi converts it automatically for every other view - you'll see how ${SPEND_PHRASE[this.tab()]} ` +
      `actual spending on it stacks up here.`,
  );

  /** One row per `Budget`, converted into the page's current `tab` period -
   * sorted by how close to (or past) its converted cap each one is, so
   * whatever needs attention floats to the top first, same "surface what's
   * urgent" idea the Recurring page's soonest-due-first sort uses. A budget
   * whose category was deleted is silently dropped rather than shown
   * against "Uncategorized" - deleting a category doesn't cascade-delete
   * its budget (same non-cascading choice `Transaction.recurringId`
   * documents for Recurring), so this is just where that leftover budget
   * stops being visible. */
  readonly rows = computed<BudgetRow[]>(() => {
    const s = this.state.state();
    if (!s) return [];
    const period = this.tab();
    const [curStart, curEnd] = periodRange(period, 0);
    const [prevStart, prevEnd] = periodRange(period, -1);

    const rows: BudgetRow[] = [];
    for (const b of s.budgets) {
      const category = s.categories.find((c) => c.id === b.categoryId);
      if (!category) continue;

      const rawPeriod = normalizeBudgetPeriod(b.period);
      const displayAmount = convertBudgetAmount(b.amount, rawPeriod, period);
      const currentSpent = expenseTotalForCategoryInRange(s.transactions, b.categoryId, curStart, curEnd);
      const previousSpent = expenseTotalForCategoryInRange(s.transactions, b.categoryId, prevStart, prevEnd);

      rows.push({
        id: b.id,
        categoryId: b.categoryId,
        categoryName: category.name,
        categoryColor: category.color,
        rawPeriod,
        rawAmount: b.amount,
        displayAmount,
        previousSpent,
        currentSpent,
        overBudget: currentSpent > displayAmount,
      });
    }

    return rows.sort((a, b) => {
      const aRatio = a.displayAmount > 0 ? a.currentSpent / a.displayAmount : 0;
      const bRatio = b.displayAmount > 0 ? b.currentSpent / b.displayAmount : 0;
      return bRatio - aRatio;
    });
  });

  openAdd(): void {
    this.editingId.set(null);
    this.form.set(blankForm(this.tab()));
    this.showModal.set(true);
  }

  /** Seeds the form from the budget exactly as stored (`row.rawPeriod`/
   * `rawAmount`), not the page's tab-converted `displayAmount` - opening
   * and re-saving without touching anything must reproduce the same
   * stored number, not silently replace it with a converted-then-rounded
   * one. */
  openEdit(row: BudgetRow): void {
    this.editingId.set(row.id);
    this.form.set({ categoryId: row.categoryId, amount: String(row.rawAmount), period: row.rawPeriod });
    this.showModal.set(true);
  }

  /** Switches which period the Add/Edit form's amount is entered in, and
   * live-converts whatever's already typed into that period's equivalent
   * (rounded to cents - see `roundMoney`) rather than leaving a now-stale
   * number sitting under the new period's label. Left as-is (not reset to
   * blank) so toggling between periods while filling the form doubles as a
   * quick "what would this look like as a yearly figure" preview - exactly
   * the automatic conversion the whole feature is about. */
  setFormPeriod(period: BudgetPeriod): void {
    this.form.update((f) => {
      const amount = Number(f.amount);
      const converted =
        Number.isFinite(amount) && amount > 0
          ? String(roundMoney(convertBudgetAmount(amount, f.period, period)))
          : f.amount;
      return { ...f, period, amount: converted };
    });
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
      this.state.updateBudget(id, { categoryId: f.categoryId, amount, period: f.period });
    } else {
      this.state.addBudget({ categoryId: f.categoryId, amount, period: f.period });
    }
    this.showModal.set(false);
  }

  remove(id: string): void {
    if (confirm('Delete this budget? This will not affect any recorded transactions.')) {
      this.state.removeBudget(id);
    }
  }
}
