import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../core/state.service';
import { formatMoney } from '../../core/currency.util';
import {
  AccountType,
  CURRENCIES,
  RECURRING_FREQUENCY_LABELS,
  RecurringFrequency,
  RecurringTransaction,
  TRANSACTION_TYPE_LABELS,
  TransactionType,
} from '../../core/models';
import { formatAmountNumber } from '../../core/format.util';
import { IconComponent } from '../../shared/icon';
import { ModalComponent } from '../../shared/modal';
import { ColorSelectComponent } from '../../shared/color-select';

interface RecurringForm {
  name: string;
  amount: string;
  type: TransactionType;
  accountType: AccountType;
  accountId: string;
  categoryId: string;
  frequency: RecurringFrequency;
  nextDate: string;
  notes: string;
}

function blankForm(): RecurringForm {
  return {
    name: '',
    amount: '',
    type: 'expense',
    accountType: 'bank',
    accountId: '',
    categoryId: '',
    frequency: 'monthly',
    nextDate: new Date().toISOString().slice(0, 10),
    notes: '',
  };
}

const TYPE_LABELS = TRANSACTION_TYPE_LABELS;

/** Same accent-per-type convention as the Transactions page's Type picker -
 * reusing the app's existing design tokens rather than inventing new ones,
 * so a recurring item's type reads the same way everywhere it appears. */
const TYPE_COLORS: Record<TransactionType, string> = {
  income: 'var(--success)',
  expense: 'var(--danger)',
  commitment: 'var(--commitment)',
  'others-in': 'var(--accent)',
  'others-out': 'var(--warning)',
};

const TODAY = () => new Date().toISOString().slice(0, 10);

@Component({
  selector: 'app-recurring',
  standalone: true,
  imports: [FormsModule, IconComponent, ModalComponent, ColorSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './recurring.html',
  styleUrl: './recurring.scss',
})
export class RecurringPage {
  readonly showModal = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly form = signal<RecurringForm>(blankForm());

  readonly typeLabels = TYPE_LABELS;
  readonly typeOptions: TransactionType[] = ['income', 'expense', 'commitment', 'others-in', 'others-out'];
  readonly frequencyLabels = RECURRING_FREQUENCY_LABELS;
  readonly frequencyOptions: RecurringFrequency[] = ['daily', 'weekly', 'monthly', 'yearly'];

  constructor(readonly state: StateService) {}

  /** Soonest-due first, so what needs attention floats to the top - there's
   * no separate "active/past" split like Fixed Deposits or Investments,
   * since a recurring item has no lifecycle of its own; it just sits here
   * until deleted. */
  readonly recurringList = computed(() =>
    [...(this.state.state()?.recurringTransactions ?? [])].sort((a, b) => a.nextDate.localeCompare(b.nextDate)),
  );

  /** Categories offered for the form's current type - same rule as the
   * Transactions page's Add/Edit modal. */
  readonly categoriesForType = computed(() => {
    const type = this.form().type;
    return (this.state.state()?.categories ?? []).filter((c) => c.type === type);
  });

  readonly accountOptions = computed(() => {
    const s = this.state.state();
    if (!s) return [] as { id: string; name: string; color?: string }[];
    switch (this.form().accountType) {
      case 'bank':
        return s.banks;
      case 'wallet':
        return s.wallets;
      case 'card':
        return s.cards;
      default:
        return [];
    }
  });

  readonly currencySymbol = computed(() => {
    const currency = this.state.state()?.settings.currency;
    return CURRENCIES.find((c) => c.value === currency)?.symbol ?? '';
  });

  money(amount: number): string {
    return formatMoney(amount, this.state.state()!.settings.currency);
  }

  numberPart(amount: number): string {
    return formatAmountNumber(amount);
  }

  typeColor(type: TransactionType): string {
    return TYPE_COLORS[type];
  }

  /** A recurring item is "due" once its next date has arrived (today or
   * earlier) - purely a visual nudge (a badge on the card), not a filter:
   * both "Add to Transactions" and "Add All" work on an item regardless of
   * whether it's actually due yet, since the user is the one deciding when
   * to book it. */
  isDue(r: RecurringTransaction): boolean {
    return r.nextDate <= TODAY();
  }

  categoryName(id?: string): string {
    if (!id) return 'Uncategorized';
    return this.state.state()?.categories.find((c) => c.id === id)?.name ?? 'Uncategorized';
  }

  categoryColor(id?: string): string {
    return this.state.state()?.categories.find((c) => c.id === id)?.color ?? '#94A3B8';
  }

  accountLabel(r: RecurringTransaction): string {
    const s = this.state.state();
    if (!s) return '';
    if (r.accountType === 'cash') return 'Cash';
    if (r.accountType === 'others') return 'Others';
    const list = r.accountType === 'bank' ? s.banks : r.accountType === 'wallet' ? s.wallets : s.cards;
    return list.find((a) => a.id === r.accountId)?.name ?? '—';
  }

  accountColor(r: RecurringTransaction): string {
    const s = this.state.state();
    if (!s) return '#94A3B8';
    if (r.accountType === 'cash' || r.accountType === 'others') return '#94A3B8';
    const list = r.accountType === 'bank' ? s.banks : r.accountType === 'wallet' ? s.wallets : s.cards;
    return list.find((a) => a.id === r.accountId)?.color ?? '#94A3B8';
  }

  onTypeChange(type: TransactionType): void {
    this.form.update((f) => ({ ...f, type, categoryId: '' }));
  }

  onAccountTypeChange(accountType: AccountType): void {
    this.form.update((f) => ({ ...f, accountType, accountId: '' }));
  }

  openAdd(): void {
    this.editingId.set(null);
    this.form.set(blankForm());
    this.showModal.set(true);
  }

  openEdit(r: RecurringTransaction): void {
    this.editingId.set(r.id);
    this.form.set({
      name: r.name,
      amount: String(r.amount),
      type: r.type,
      accountType: r.accountType,
      accountId: r.accountId ?? '',
      categoryId: r.categoryId ?? '',
      frequency: r.frequency,
      nextDate: r.nextDate,
      notes: r.notes ?? '',
    });
    this.showModal.set(true);
  }

  save(): void {
    const f = this.form();
    const amount = parseFloat(f.amount);
    if (!f.name.trim() || !f.nextDate || isNaN(amount) || amount <= 0) return;
    const payload = {
      name: f.name.trim(),
      amount,
      type: f.type,
      accountType: f.accountType,
      accountId: f.accountType === 'cash' || f.accountType === 'others' ? undefined : f.accountId || undefined,
      categoryId: f.categoryId || undefined,
      frequency: f.frequency,
      nextDate: f.nextDate,
      notes: f.notes.trim() || undefined,
    };
    const id = this.editingId();
    if (id) {
      this.state.updateRecurring(id, payload);
    } else {
      this.state.addRecurring(payload);
    }
    this.showModal.set(false);
  }

  /** Books this one recurring item to Transactions now, dated on its
   * current `nextDate`, and advances that date to the following
   * occurrence. */
  triggerOne(r: RecurringTransaction): void {
    this.state.triggerRecurring(r.id);
  }

  /** Books every recurring item to Transactions in one go - asks first
   * since it creates one transaction per item all at once. */
  triggerAll(): void {
    const count = this.recurringList().length;
    if (count === 0) return;
    const ok = confirm(
      `Add ${count} recurring transaction${count === 1 ? '' : 's'} to your Transactions now?`,
    );
    if (!ok) return;
    this.state.triggerAllRecurring();
  }

  remove(id: string): void {
    if (confirm('Delete this recurring transaction? This will not remove any transactions it already created.')) {
      this.state.removeRecurring(id);
    }
  }
}
