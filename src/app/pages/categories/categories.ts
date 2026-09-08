import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../core/state.service';
import { Category, DEFAULT_CATEGORY_COLORS, TransactionType } from '../../core/models';
import { IconComponent } from '../../shared/icon';
import { ModalComponent } from '../../shared/modal';
import { ColorPickerComponent } from '../../shared/color-picker';

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
  readonly showModal = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly name = signal('');
  readonly color = signal(this.colors[0]);
  readonly type = signal<TransactionType>('expense');

  constructor(readonly state: StateService) {}

  readonly categories = computed(() => this.state.state()?.categories ?? []);

  typeLabel(type: TransactionType): string {
    switch (type) {
      case 'income':
        return 'Income';
      case 'expense':
        return 'Expense';
      case 'others-in':
        return 'Others (In)';
      case 'others-out':
        return 'Others (Out)';
    }
  }

  openAdd(): void {
    this.editingId.set(null);
    this.name.set('');
    this.type.set('expense');
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

  remove(id: string): void {
    if (confirm('Delete this category? Transactions using it become uncategorized.')) {
      this.state.removeCategory(id);
    }
  }
}
