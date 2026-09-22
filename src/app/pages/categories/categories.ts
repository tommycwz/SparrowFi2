import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../core/state.service';
import { Category, DEFAULT_CATEGORY_COLORS, TRANSACTION_TYPE_LABELS, TransactionType } from '../../core/models';
import { IconComponent } from '../../shared/icon';
import { ModalComponent } from '../../shared/modal';
import { ColorPickerComponent } from '../../shared/color-picker';

/** Tab order for the Categories page - Income/Expense/Commitment first
 * (the "real" money-in/money-out types), then the two Others directions. */
const TABS: TransactionType[] = ['income', 'expense', 'commitment', 'others-in', 'others-out'];

@Component({
  selector: 'app-categories',
  standalone: true,
  imports: [FormsModule, IconComponent, ModalComponent, ColorPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './categories.html',
  styleUrl: './categories.scss',
})
export class CategoriesPage {
  readonly colors = DEFAULT_CATEGORY_COLORS;
  readonly tabs = TABS;
  readonly showModal = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly name = signal('');
  readonly color = signal(this.colors[0]);
  readonly type = signal<TransactionType>('expense');
  readonly tab = signal<TransactionType>('expense');

  constructor(readonly state: StateService) {}

  readonly allCategories = computed(() => this.state.state()?.categories ?? []);

  /** Categories for the active tab, in the order they're actually stored
   * (see `StateService.moveCategory`'s doc comment - there's no separate
   * "order" field, `AppState.categories`' array order *is* the display
   * order, both here and in every category `<select>` elsewhere in the
   * app). */
  readonly categories = computed(() => {
    const t = this.tab();
    return this.allCategories().filter((c) => c.type === t);
  });

  /** Per-tab counts so each tab can show how many categories it holds. */
  readonly tabCounts = computed(() => {
    const counts: Record<TransactionType, number> = {
      income: 0,
      expense: 0,
      commitment: 0,
      'others-in': 0,
      'others-out': 0,
    };
    for (const c of this.allCategories()) {
      counts[c.type]++;
    }
    return counts;
  });

  typeLabel(type: TransactionType): string {
    return TRANSACTION_TYPE_LABELS[type];
  }

  openAdd(): void {
    this.editingId.set(null);
    this.name.set('');
    this.type.set(this.tab());
    this.color.set(this.colors[Math.floor(Math.random() * this.colors.length)]);
    this.showModal.set(true);
  }

  openEdit(c: Category): void {
    this.editingId.set(c.id);
    this.name.set(c.name);
    this.color.set(c.color);
    this.type.set(c.type);
    this.showModal.set(true);
  }

  save(): void {
    const name = this.name().trim();
    if (!name) return;
    const payload = { name, color: this.color(), type: this.type() };
    const id = this.editingId();
    if (id) this.state.updateCategory(id, payload);
    else this.state.addCategory(payload);
    this.showModal.set(false);
  }

  /** No-ops for a `locked` category - the delete button is hidden for
   * those (see `Category.locked`), but this guards against calling it any
   * other way too. */
  remove(id: string): void {
    const category = this.allCategories().find((c) => c.id === id);
    if (!category || category.locked) return;
    if (confirm('Delete this category? Transactions using it become uncategorized.')) {
      this.state.removeCategory(id);
    }
  }

  /** Moves a category one place earlier/later within its own tab - a thin
   * pass-through to `StateService.moveCategory` (see its doc comment for
   * why this is just an array-position swap rather than a stored "order"
   * field). The template only calls this for a direction the row's
   * up/down button is actually showing (`$first`/`$last` in `categories.html`
   * hide the button that would otherwise be a no-op at either end of the
   * list), but `moveCategory` itself is a no-op too if called anyway. */
  move(id: string, direction: 'up' | 'down'): void {
    this.state.moveCategory(id, direction);
  }
}
