import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../core/state.service';
import { formatMoney } from '../../core/currency.util';
import { AccountType, CURRENCIES, Transaction, TransactionType } from '../../core/models';
import { formatAmountNumber, formatDateBadge, formatTimeBadge, monthKeyOf } from '../../core/format.util';
import { IconComponent } from '../../shared/icon';
import { ModalComponent } from '../../shared/modal';
import { ColorSelectComponent } from '../../shared/color-select';

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

/** Minimum horizontal drag (px) before a touch gesture counts as a swipe. */
const SWIPE_THRESHOLD = 45;

/** Current local time as 'HH:mm', matching the `time` field's display format. */
function currentTimeString(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const TYPE_LABELS: Record<TransactionType, string> = {
  income: 'Income',
  expense: 'Expense',
  'others-in': 'Others (In)',
  'others-out': 'Others (Out)',
};

/** One distinct accent color per transaction type - reusing the app's
 * existing design tokens rather than inventing new ones - so the four
 * options in the Type picker are told apart at a glance instead of all
 * looking the same until read. Income/expense keep the green/red
 * convention used everywhere else in the app (positive/negative amounts);
 * the two "Others" variants get their own accent/warning hues rather than
 * reusing green/red, since collapsing them onto the same colors as
 * Income/Expense would defeat the point of telling all four apart. */
const TYPE_COLORS: Record<TransactionType, string> = {
  income: 'var(--success)',
  expense: 'var(--danger)',
  'others-in': 'var(--accent)',
  'others-out': 'var(--warning)',
};

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: 'Bank',
  wallet: 'Wallet',
  card: 'Card',
  cash: 'Cash',
  others: 'Others',
};

const TYPE_LABELS_REVERSE = new Map(
  Object.entries(TYPE_LABELS).map(([k, v]) => [v.toLowerCase(), k as TransactionType]),
);
const ACCOUNT_TYPE_LABELS_REVERSE = new Map(
  Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => [v.toLowerCase(), k as AccountType]),
);

const CSV_HEADER = ['Date', 'Time', 'Type', 'Account Type', 'Account', 'Category', 'Amount', 'Notes'];

/** Wraps a CSV field in quotes (doubling internal quotes) only when it needs it. */
function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Minimal RFC4180-ish CSV parser: handles quoted fields, embedded commas/
 * newlines inside quotes, and doubled-quote escaping. Good enough for a
 * file this app itself exported (or a spreadsheet export of it). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      // handled on the following \n
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

interface ImportPreview {
  toImport: Omit<Transaction, 'id'>[];
  errors: string[];
  totalRows: number;
}

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [FormsModule, IconComponent, ModalComponent, ColorSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transactions.html',
  styleUrl: './transactions.scss',
})
export class TransactionsPage {
  readonly filterAccount = signal<string>('all');
  readonly filterType = signal<'all' | TransactionType>('all');
  /** 'all' | categoryId | '__uncategorized__'. */
  readonly filterCategory = signal<string>('all');
  readonly searchQuery = signal('');
  /** 'all' shows every month; otherwise a 'YYYY-MM' key. Starts on the
   * current month so the list opens on something relevant rather than
   * a full, unfiltered history. */
  readonly selectedMonth = signal<string>(monthKeyOf());
  readonly showModal = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly form = signal<TxForm>(blankForm());

  readonly showImportModal = signal(false);
  readonly importPreview = signal<ImportPreview | null>(null);

  readonly typeLabels = TYPE_LABELS;
  readonly typeOptions: TransactionType[] = ['income', 'expense', 'others-in', 'others-out'];

  private touchStartX = 0;
  private touchStartY = 0;

  constructor(readonly state: StateService) {}

  readonly categoriesForType = computed(() =>
    (this.state.state()?.categories ?? []).filter((c) => c.type === this.form().type),
  );

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

  /** Categories for the filter dropdown, grouped by type for an <optgroup> layout. */
  readonly categoryFilterGroups = computed(() => {
    const cats = this.state.state()?.categories ?? [];
    return this.typeOptions.map((type) => ({
      type,
      label: TYPE_LABELS[type],
      categories: cats.filter((c) => c.type === type),
    }));
  });

  readonly transactions = computed(() => {
    const s = this.state.state();
    if (!s) return [];
    const accountFilter = this.filterAccount();
    const month = this.selectedMonth();
    const type = this.filterType();
    const category = this.filterCategory();
    const query = this.searchQuery().trim().toLowerCase();

    let list = [...s.transactions];
    if (accountFilter !== 'all') {
      const [kind, id] = accountFilter.split(':');
      list = list.filter((t) => t.accountType === kind && t.accountId === id);
    }
    if (month !== 'all') {
      list = list.filter((t) => t.date.slice(0, 7) === month);
    }
    if (type !== 'all') {
      list = list.filter((t) => t.type === type);
    }
    if (category === '__uncategorized__') {
      list = list.filter((t) => !t.categoryId);
    } else if (category !== 'all') {
      list = list.filter((t) => t.categoryId === category);
    }
    if (query) {
      list = list.filter((t) => (t.notes ?? '').toLowerCase().includes(query));
    }
    return list.sort((a, b) => (b.date + (b.time ?? '')).localeCompare(a.date + (a.time ?? '')));
  });

  /** Summary stats for whatever is currently visible in `transactions()`,
   * so the numbers at the top always match the list below them. */
  readonly monthlyStats = computed(() => {
    let income = 0;
    let expense = 0;
    for (const t of this.transactions()) {
      if (t.type === 'income') income += t.amount;
      else if (t.type === 'expense') expense += t.amount;
    }
    return { income, expense, net: income - expense };
  });

  readonly statsPeriodLabel = computed(() => (this.selectedMonth() === 'all' ? 'All-Time' : 'Monthly'));

  /** "Net Balance" stat value - sign-then-symbol-then-magnitude, so a
   * negative net renders "-{{symbol}}500.00" rather than
   * "{{symbol}}-500.00" (the minus sign `formatAmountNumber` itself
   * produces sandwiched after the symbol instead of before it - the same
   * defect class `formatMoney` was fixed for). */
  readonly netStatLabel = computed(() => {
    const net = this.monthlyStats().net;
    const sign = net < 0 ? '-' : '';
    return `${sign}${this.currencySymbol()}${formatAmountNumber(Math.abs(net))}`;
  });

  readonly currencySymbol = computed(() => {
    const currency = this.state.state()?.settings.currency;
    return CURRENCIES.find((c) => c.value === currency)?.symbol ?? '';
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

  /** Number part only (e.g. "1,234.50"), for the split-currency-symbol amount styling. */
  numberPart(amount: number): string {
    return formatAmountNumber(amount);
  }

  categoryName(id?: string): string {
    if (!id) return 'Uncategorized';
    return this.state.state()?.categories.find((c) => c.id === id)?.name ?? 'Uncategorized';
  }

  categoryColor(id?: string): string {
    return this.state.state()?.categories.find((c) => c.id === id)?.color ?? '#94A3B8';
  }

  typeColor(type: TransactionType): string {
    return TYPE_COLORS[type];
  }

  accountLabel(t: Transaction): string {
    const s = this.state.state();
    if (!s) return '';
    if (t.accountType === 'cash') return 'Cash';
    if (t.accountType === 'others') return 'Others';
    const list = t.accountType === 'bank' ? s.banks : t.accountType === 'wallet' ? s.wallets : s.cards;
    return list.find((a) => a.id === t.accountId)?.name ?? '—';
  }

  /** The specific bank/wallet/card's own color (set in Accounts), so the
   * account name next to a transaction gets a dot just like the category
   * name does - Cash/Others fall back to a neutral gray since they have no
   * color of their own in the data model. */
  accountColor(t: Transaction): string {
    const s = this.state.state();
    if (!s) return '#94A3B8';
    if (t.accountType === 'cash' || t.accountType === 'others') return '#94A3B8';
    const list = t.accountType === 'bank' ? s.banks : t.accountType === 'wallet' ? s.wallets : s.cards;
    return list.find((a) => a.id === t.accountId)?.color ?? '#94A3B8';
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

  /** Short day/month for the stacked date badge, e.g. { day: '13', month: 'JUL' }. */
  dateBadge(dateStr: string): { day: string; month: string } {
    return formatDateBadge(dateStr);
  }

  /** '13:05' -> '1:05 PM', matching the pill time badge in the design. */
  timeBadge(time?: string): string | null {
    return formatTimeBadge(time);
  }

  shiftMonth(delta: number): void {
    const m = this.selectedMonth();
    const base = m === 'all' ? new Date() : (() => {
      const [y, mo] = m.split('-').map(Number);
      return new Date(y, mo - 1, 1);
    })();
    base.setMonth(base.getMonth() + delta);
    this.selectedMonth.set(monthKeyOf(base));
  }

  toggleAllMonths(): void {
    this.selectedMonth.set(this.selectedMonth() === 'all' ? monthKeyOf() : 'all');
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

  // ----- Export ---------------------------------------------------------

  exportCsv(): void {
    const s = this.state.state();
    if (!s) return;
    const rows = this.transactions();
    const lines = [CSV_HEADER.map(csvField).join(',')];
    for (const t of rows) {
      const accName =
        t.accountType === 'bank'
          ? s.banks.find((b) => b.id === t.accountId)?.name
          : t.accountType === 'wallet'
            ? s.wallets.find((w) => w.id === t.accountId)?.name
            : t.accountType === 'card'
              ? s.cards.find((c) => c.id === t.accountId)?.name
              : t.accountType === 'cash'
                ? 'Cash'
                : 'Others';
      const catName = t.categoryId ? (s.categories.find((c) => c.id === t.categoryId)?.name ?? '') : '';
      const cols = [
        t.date,
        t.time ?? '',
        TYPE_LABELS[t.type],
        ACCOUNT_TYPE_LABELS[t.accountType],
        accName ?? '',
        catName,
        t.amount.toFixed(2),
        t.notes ?? '',
      ];
      lines.push(cols.map(csvField).join(','));
    }
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const suffix = this.selectedMonth() === 'all' ? 'All' : this.selectedMonth();
    a.download = `SparrowFi-Transactions-${suffix}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ----- Import -----------------------------------------------------------

  onImportFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => this.parseImportFile(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  private parseImportFile(text: string): void {
    const s = this.state.state();
    const rows = parseCsv(text);
    if (!s || rows.length === 0) {
      this.importPreview.set({ toImport: [], errors: ['That file has no rows to import.'], totalRows: 0 });
      this.showImportModal.set(true);
      return;
    }

    const [, ...dataRows] = rows;
    const toImport: Omit<Transaction, 'id'>[] = [];
    const errors: string[] = [];

    dataRows.forEach((cols, i) => {
      const rowNum = i + 2; // +1 for header row, +1 for 1-indexing
      try {
        const [dateStr, timeStr, typeLabel, accTypeLabel, accName, catName, amountStr, notes] = cols;

        const type = TYPE_LABELS_REVERSE.get((typeLabel ?? '').trim().toLowerCase());
        if (!type) throw new Error(`unrecognized Type "${typeLabel ?? ''}"`);

        if (!/^\d{4}-\d{2}-\d{2}$/.test((dateStr ?? '').trim())) {
          throw new Error(`invalid Date "${dateStr ?? ''}" (expected YYYY-MM-DD)`);
        }

        const amount = parseFloat(amountStr);
        if (isNaN(amount) || amount <= 0) throw new Error(`invalid Amount "${amountStr ?? ''}"`);

        const accountType =
          ACCOUNT_TYPE_LABELS_REVERSE.get((accTypeLabel ?? '').trim().toLowerCase()) ?? 'others';

        let accountId: string | undefined;
        if (accountType === 'bank' || accountType === 'wallet' || accountType === 'card') {
          const list = accountType === 'bank' ? s.banks : accountType === 'wallet' ? s.wallets : s.cards;
          accountId = list.find((a) => a.name.toLowerCase() === (accName ?? '').trim().toLowerCase())?.id;
        }

        let categoryId: string | undefined;
        const trimmedCat = (catName ?? '').trim();
        if (trimmedCat) {
          categoryId = s.categories.find(
            (c) => c.type === type && c.name.toLowerCase() === trimmedCat.toLowerCase(),
          )?.id;
        }

        toImport.push({
          date: dateStr.trim(),
          time: (timeStr ?? '').trim() || undefined,
          amount,
          type,
          accountType,
          accountId,
          categoryId,
          notes: (notes ?? '').trim() || undefined,
        });
      } catch (err) {
        errors.push(`Row ${rowNum}: ${err instanceof Error ? err.message : 'could not be read'}.`);
      }
    });

    this.importPreview.set({ toImport, errors, totalRows: dataRows.length });
    this.showImportModal.set(true);
  }

  confirmImport(): void {
    const preview = this.importPreview();
    if (!preview || preview.toImport.length === 0) return;
    this.state.addTransactions(preview.toImport);
    this.cancelImport();
  }

  cancelImport(): void {
    this.showImportModal.set(false);
    this.importPreview.set(null);
  }
}
