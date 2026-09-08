import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../core/state.service';
import { formatMoney } from '../../core/currency.util';
import { AccountType, Transaction, TransactionType } from '../../core/models';
import { IconComponent } from '../../shared/icon';
import { ModalComponent } from '../../shared/modal';

interface TxForm {
  date: string;
  time: string;
  autoCaptureTime: boolean;
  amount: string;
  type: TransactionType;
  accountType: AccountType;
  accountId: string;
  categoryId: string;
  notes: string;
}

function blankForm(): TxForm {
  return {
    date: new Date().toISOString().slice(0, 10),
    time: '',
    autoCaptureTime: true,
    amount: '',
    type: 'expense',
    accountType: 'bank',
    accountId: '',
    categoryId: '',
    notes: '',
  };
}

/** 'YYYY-MM' for a given date, used as the month-filter key. */
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Minimum horizontal drag (px) before a touch gesture counts as a swipe. */
const SWIPE_THRESHOLD = 45;

/** Current local time as 'HH:mm', matching the `time` field's display format. */
function currentTimeString(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [FormsModule, IconComponent, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transactions.html',
  styleUrl: './transactions.scss',
})
export class TransactionsPage {
  readonly filterAccount = signal<string>('all');
  /** 'all' shows every month; otherwise a 'YYYY-MM' key. Starts on the
   * current month so the list opens on something relevant rather than
   * a full, unfiltered history. */
  readonly selectedMonth = signal<string>(monthKey(new Date()));
  readonly showModal = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly form = signal<TxForm>(blankForm());

  private touchStartX = 0;
  private touchStartY = 0;

  constructor(readonly state: StateService) {}

  readonly categoriesForType = computed(() =>
    (this.state.state()?.categories ?? []).filter((c) => c.type === this.form().type),
  );

  readonly accountOptions = computed(() => {
    const s = this.state.state();
    if (!s) return [] as { id: string; name: string }[];
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

  readonly transactions = computed(() => {
    const s = this.state.state();
    if (!s) return [];
    const filter = this.filterAccount();
    const month = this.selectedMonth();
    let list = [...s.transactions];
    if (filter !== 'all') {
      const [kind, id] = filter.split(':');
      list = list.filter((t) => t.accountType === kind && t.accountId === id);
    }
    if (month !== 'all') {
      list = list.filter((t) => t.date.slice(0, 7) === month);
    }
    return list.sort((a, b) => (b.date + (b.time ?? '')).localeCompare(a.date + (a.time ?? '')));
  });

  readonly filterOptions = computed(() => {
    const s = this.state.state();
    if (!s) return [];
    return [
      ...s.banks.map((b) => ({ value: `bank:${b.id}`, label: b.name })),
      ...s.wallets.map((w) => ({ value: `wallet:${w.id}`, label: w.name })),
      ...s.cards.map((c) => ({ value: `card:${c.id}`, label: c.name })),
    ];
  });

  money(amount: number): string {
    return formatMoney(amount, this.state.state()!.settings.currency);
  }

  categoryName(id?: string): string {
    if (!id) return 'Uncategorized';
    return this.state.state()?.categories.find((c) => c.id === id)?.name ?? 'Uncategorized';
  }

  categoryColor(id?: string): string {
    return this.state.state()?.categories.find((c) => c.id === id)?.color ?? '#94A3B8';
  }

  accountLabel(t: Transaction): string {
    const s = this.state.state();
    if (!s) return '';
    if (t.accountType === 'cash') return 'Cash';
    if (t.accountType === 'others') return 'Others';
    const list = t.accountType === 'bank' ? s.banks : t.accountType === 'wallet' ? s.wallets : s.cards;
    return list.find((a) => a.id === t.accountId)?.name ?? '—';
  }

  /** Human label for the month nav bar, e.g. "September 2026" or "All Transactions". */
  monthLabel(): string {
    const m = this.selectedMonth();
    if (m === 'all') return 'All Transactions';
    const [y, mo] = m.split('-').map(Number);
    return new Date(y, mo - 1, 1).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });
  }

  shiftMonth(delta: number): void {
    const m = this.selectedMonth();
    const base = m === 'all' ? new Date() : (() => {
      const [y, mo] = m.split('-').map(Number);
      return new Date(y, mo - 1, 1);
    })();
    base.setMonth(base.getMonth() + delta);
    this.selectedMonth.set(monthKey(base));
  }

  toggleAllMonths(): void {
    this.selectedMonth.set(this.selectedMonth() === 'all' ? monthKey(new Date()) : 'all');
  }

  onTouchStart(event: TouchEvent): void {
    const t = event.touches[0];
    this.touchStartX = t.clientX;
    this.touchStartY = t.clientY;
  }

  onTouchEnd(event: TouchEvent): void {
    const t = event.changedTouches[0];
    const dx = t.clientX - this.touchStartX;
    const dy = t.clientY - this.touchStartY;
    // Ignore mostly-vertical drags so normal list scrolling isn't
    // mistaken for a month swipe.
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    // Swipe left (finger moving left, dx < 0) advances to the next
    // month, like turning a page forward; swipe right goes back.
    this.shiftMonth(dx < 0 ? 1 : -1);
  }

  openAdd(): void {
    this.editingId.set(null);
    this.form.set(blankForm());
    this.showModal.set(true);
  }

  openEdit(t: Transaction): void {
    this.editingId.set(t.id);
    this.form.set({
      date: t.date,
      time: t.time ?? '',
      // Editing shows the time that was actually recorded rather than
      // silently overwriting it with "now" on save; the user can flip
      // auto-capture back on if they do want to re-stamp it.
      autoCaptureTime: false,
      amount: String(t.amount),
      type: t.type,
      accountType: t.accountType,
      accountId: t.accountId ?? '',
      categoryId: t.categoryId ?? '',
      notes: t.notes ?? '',
    });
    this.showModal.set(true);
  }

  onTypeChange(type: TransactionType): void {
    this.form.update((f) => ({ ...f, type, categoryId: '' }));
  }

  onAccountTypeChange(accountType: AccountType): void {
    this.form.update((f) => ({ ...f, accountType, accountId: '' }));
  }

  save(): void {
    const f = this.form();
    const amount = parseFloat(f.amount);
    if (!f.date || isNaN(amount) || amount <= 0) return;
    const time = f.autoCaptureTime ? currentTimeString() : f.time || undefined;
    const payload: Omit<Transaction, 'id'> = {
      date: f.date,
      time,
      amount,
      type: f.type,
      accountType: f.accountType,
      accountId:
        f.accountType === 'cash' || f.accountType === 'others' ? undefined : f.accountId || undefined,
      categoryId: f.categoryId || undefined,
      notes: f.notes || undefined,
    };
    const id = this.editingId();
    if (id) {
      this.state.updateTransaction(id, payload);
    } else {
      this.state.addTransaction(payload);
    }
    this.showModal.set(false);
  }

  remove(id: string): void {
    if (confirm('Delete this transaction?')) {
      this.state.removeTransaction(id);
    }
  }
}
