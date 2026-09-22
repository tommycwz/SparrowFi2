import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../core/state.service';
import { formatMoney } from '../../core/currency.util';
import {
  AccountType,
  CURRENCIES,
  RecurringFrequency,
  RecurringLine,
  RecurringTransaction,
  TRANSACTION_TYPE_LABELS,
  TransactionType,
} from '../../core/models';
import { formatAmountNumber } from '../../core/format.util';
import { anchorDayOf, frequencyUnitLabel, recurrenceLabel } from '../../core/recurring.util';
import { IconComponent } from '../../shared/icon';
import { ModalComponent } from '../../shared/modal';

/** One editable line in the Add/Edit form - the same fields as
 * `RecurringLine` minus its `id` (assigned by `StateService` on save), as
 * plain strings matching how HTML form controls hand values back (parsed/
 * validated only at save time) - same convention the Transactions page's
 * Batch grid uses for its rows. */
interface RecurringLineForm {
  type: TransactionType;
  accountType: AccountType;
  accountId: string;
  categoryId: string;
  amount: string;
}

function blankLine(): RecurringLineForm {
  return { type: 'expense', accountType: 'bank', accountId: '', categoryId: '', amount: '' };
}

interface RecurringForm {
  name: string;
  frequency: RecurringFrequency;
  /** "Every N ___" count, as a plain string like every other numeric form
   * field here (see `RecurringLineForm.amount`) - parsed and validated only
   * at save time. Blank/zero/negative/non-integer is treated as 1 by
   * `unitLabel`/`recurrenceHint` while the form is open, and rejected by
   * `save()` outright rather than silently coerced, so a mistyped value
   * gets a chance to be noticed instead of quietly becoming "every 1". */
  interval: string;
  nextDate: string;
  notes: string;
  /** Always at least one - see `RecurringTransaction.lines`. */
  lines: RecurringLineForm[];
}

function blankForm(): RecurringForm {
  return {
    name: '',
    frequency: 'monthly',
    interval: '1',
    nextDate: new Date().toISOString().slice(0, 10),
    notes: '',
    lines: [blankLine()],
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

/** Column order the lines grid presents fields in, left to right - also the
 * order a multi-cell Excel/Sheets paste is fanned out across when it starts
 * partway through a row (e.g. pasting from the Account Type column still
 * lands Account/Category/Amount in the right places) - same convention the
 * Transactions page's Batch grid uses for its own columns
 * (`BATCH_FIELDS`). */
const RECURRING_LINE_FIELDS: (keyof RecurringLineForm)[] = [
  'type',
  'accountType',
  'accountId',
  'categoryId',
  'amount',
];

const TODAY = () => new Date().toISOString().slice(0, 10);

@Component({
  selector: 'app-recurring',
  standalone: true,
  imports: [FormsModule, IconComponent, ModalComponent],
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
  readonly frequencyOptions: RecurringFrequency[] = ['daily', 'weekly', 'monthly', 'yearly'];

  constructor(readonly state: StateService) {}

  /** "Every 2 Weeks", "Monthly", etc. - what a card's caption line shows in
   * place of the plain `frequencyLabels[r.frequency]` it used before
   * `interval` existed. */
  frequencyLabel(r: RecurringTransaction): string {
    return recurrenceLabel(r.frequency, r.interval);
  }

  /** Singular/plural unit name for one of the Add/Edit form's frequency
   * buttons ("Day"/"Days", etc.), matching whatever `interval` is currently
   * typed into the form - so the buttons read "2 [Weeks]" rather than
   * "2 [Week]" as soon as the count goes above one. */
  unitLabel(freq: RecurringFrequency): string {
    return frequencyUnitLabel(freq, Number(this.form().interval));
  }

  /** Live "Every N ___" preview shown under the form's frequency picker
   * once `interval` is anything other than 1 - purely a readability aid, so
   * "3" + "Months" reads back as "Every 3 months" before the item is even
   * saved. Hidden at `interval` 1 since the picker's own labels already say
   * "Monthly" etc. clearly enough on their own. */
  recurrenceHint(): string | null {
    const f = this.form();
    const interval = Number(f.interval);
    return Number.isInteger(interval) && interval > 1 ? recurrenceLabel(f.frequency, interval) : null;
  }

  /** Explains the day-of-month clamp (see `nextOccurrenceDate`'s doc
   * comment) right where it becomes relevant - a monthly/yearly item whose
   * Next Date falls on the 29th-31st, a day not every month/February has.
   * Null (and hidden) for every other combination - daily/weekly items
   * don't have a "day of month" to clamp, and a day of 28 or less always
   * exists no matter the month. */
  monthEndNote(): string | null {
    const f = this.form();
    if (f.frequency !== 'monthly' && f.frequency !== 'yearly') return null;
    const day = anchorDayOf(f.nextDate);
    if (day <= 28) return null;
    return `A month without day ${day} lands on its last day instead (the 30th, or the 28th/29th in February) — then back to day ${day} as soon as a month has it again.`;
  }

  /** Soonest-due first, so what needs attention floats to the top - there's
   * no separate "active/past" split like Fixed Deposits or Investments,
   * since a recurring item has no lifecycle of its own; it just sits here
   * until deleted. */
  readonly recurringList = computed(() =>
    [...(this.state.state()?.recurringTransactions ?? [])].sort((a, b) => a.nextDate.localeCompare(b.nextDate)),
  );

  /** Categories offered for a form line of the given type - one lookup per
   * line, since each line picks its own type independently (same pattern
   * the Transactions page's Batch grid uses for its rows). */
  categoriesForLineType(type: TransactionType): { id: string; name: string; color: string }[] {
    return (this.state.state()?.categories ?? []).filter((c) => c.type === type);
  }

  /** Same idea as `categoriesForLineType`, for a line's account type. */
  accountOptionsForLineType(accountType: AccountType): { id: string; name: string; color?: string }[] {
    const s = this.state.state();
    if (!s) return [];
    switch (accountType) {
      case 'bank':
        return s.banks;
      case 'wallet':
        return s.wallets;
      case 'card':
        return s.cards;
      default:
        return [];
    }
  }

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

  /** Account info now lives per-line (see `RecurringLine`), so this and
   * `accountColor` take one line rather than the whole template. */
  accountLabel(line: RecurringLine): string {
    const s = this.state.state();
    if (!s) return '';
    if (line.accountType === 'cash') return 'Cash';
    if (line.accountType === 'others') return 'Others';
    const list = line.accountType === 'bank' ? s.banks : line.accountType === 'wallet' ? s.wallets : s.cards;
    return list.find((a) => a.id === line.accountId)?.name ?? '—';
  }

  accountColor(line: RecurringLine): string {
    const s = this.state.state();
    if (!s) return '#94A3B8';
    if (line.accountType === 'cash' || line.accountType === 'others') return '#94A3B8';
    const list = line.accountType === 'bank' ? s.banks : line.accountType === 'wallet' ? s.wallets : s.cards;
    return list.find((a) => a.id === line.accountId)?.color ?? '#94A3B8';
  }

  isInflow(type: TransactionType): boolean {
    return type === 'income' || type === 'others-in';
  }

  /** Net effect of all of a template's lines together (inflows minus
   * outflows) - shown as the card's headline amount now that a template
   * can carry more than one line, possibly of more than one type, so
   * there's no longer a single type to color the old single-amount display
   * by. */
  netAmount(r: RecurringTransaction): number {
    return r.lines.reduce((sum, l) => sum + (this.isInflow(l.type) ? l.amount : -l.amount), 0);
  }

  netAmountAbs(r: RecurringTransaction): number {
    return Math.abs(this.netAmount(r));
  }

  /** Adds one more blank line to the form - "+ Add Line", for a template
   * that books more than one transaction together (see
   * `RecurringTransaction.lines`). */
  addLine(): void {
    this.form.update((f) => ({ ...f, lines: [...f.lines, blankLine()] }));
  }

  /** Removes one line from the form. Refuses to drop the last remaining
   * line - a template always needs at least one (see
   * `RecurringTransaction.lines`'s doc comment) - rather than silently
   * leaving the form with zero, which `save()` would then just reject
   * anyway. */
  removeLine(index: number): void {
    this.form.update((f) => (f.lines.length <= 1 ? f : { ...f, lines: f.lines.filter((_, i) => i !== index) }));
  }

  /** Generic single-field edit for a line, for every field except Type/
   * Account Type (which also reset a dependent field - see
   * `onLineTypeChange`/`onLineAccountTypeChange` below). */
  updateLineField(index: number, field: keyof RecurringLineForm, value: string): void {
    this.form.update((f) => ({
      ...f,
      lines: f.lines.map((l, i) => (i === index ? { ...l, [field]: value } : l)),
    }));
  }

  /** Changing a line's Type also clears its Category - the previous
   * selection belonged to the old type's category list and would
   * otherwise silently point at the wrong kind of category. */
  onLineTypeChange(index: number, type: TransactionType): void {
    this.form.update((f) => ({
      ...f,
      lines: f.lines.map((l, i) => (i === index ? { ...l, type, categoryId: '' } : l)),
    }));
  }

  /** Same idea as `onLineTypeChange`, for Account Type -> Account. */
  onLineAccountTypeChange(index: number, accountType: AccountType): void {
    this.form.update((f) => ({
      ...f,
      lines: f.lines.map((l, i) => (i === index ? { ...l, accountType, accountId: '' } : l)),
    }));
  }

  /** Detects a genuine multi-cell paste (more than one row, or more than
   * one tab-separated column on a single line) - copied straight out of
   * Excel/Google Sheets, that format is tab-between-columns,
   * newline-between-rows. A single pasted value (no tabs, one line) is left
   * alone entirely so the browser's own normal single-value paste still
   * happens on that cell. Same behavior as the Transactions page's own
   * `onBatchPaste`, adapted to a line's fields (no Date/Notes column here). */
  onLinePaste(event: ClipboardEvent, rowIndex: number, field: keyof RecurringLineForm): void {
    const text = event.clipboardData?.getData('text') ?? '';
    if (!text) return;
    const lines = text.replace(/\r/g, '').split('\n');
    // A trailing blank line is just the newline after the last real row of
    // a copied range, not a genuine empty row to paste.
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    const isMultiCell = lines.length > 1 || lines[0].includes('\t');
    if (!isMultiCell) return;

    event.preventDefault();
    const startCol = RECURRING_LINE_FIELDS.indexOf(field);

    this.form.update((f) => {
      const rows = [...f.lines];
      while (rows.length < rowIndex + lines.length) rows.push(blankLine());

      lines.forEach((line, r) => {
        const cells = line.split('\t');
        let target = { ...rows[rowIndex + r] };
        cells.forEach((raw, c) => {
          const col = startCol + c;
          if (col >= RECURRING_LINE_FIELDS.length) return; // extra columns past Amount are ignored
          target = this.applyLinePasteCell(target, RECURRING_LINE_FIELDS[col], raw.trim());
        });
        rows[rowIndex + r] = target;
      });

      return { ...f, lines: rows };
    });
  }

  /** Resolves one pasted cell's raw text into a `RecurringLineForm` field -
   * same matching rules as the Transactions page's own
   * `applyBatchPasteCell`: Type/Account Type match against their display
   * labels (case-insensitive); Account/Category match by name *within the
   * line's own (possibly just-pasted) Type/Account Type*, since a pasted
   * row's columns are read left to right in `RECURRING_LINE_FIELDS` order
   * and Type/Account Type always precede the fields that depend on them. An
   * unrecognized value is left as whatever the line already had, rather
   * than clearing it or blocking the rest of the paste - the user can
   * always fix one cell by hand afterward. */
  private applyLinePasteCell(
    line: RecurringLineForm,
    field: keyof RecurringLineForm,
    raw: string,
  ): RecurringLineForm {
    switch (field) {
      case 'type': {
        const type = TYPE_LABELS_REVERSE.get(raw.toLowerCase());
        return type ? { ...line, type, categoryId: '' } : line;
      }
      case 'accountType': {
        const accountType = ACCOUNT_TYPE_LABELS_REVERSE.get(raw.toLowerCase());
        return accountType ? { ...line, accountType, accountId: '' } : line;
      }
      case 'accountId': {
        if (!raw) return line;
        const match = this.accountOptionsForLineType(line.accountType).find(
          (a) => a.name.toLowerCase() === raw.toLowerCase(),
        );
        return match ? { ...line, accountId: match.id } : line;
      }
      case 'categoryId': {
        if (!raw) return line;
        const match = this.categoriesForLineType(line.type).find(
          (c) => c.name.toLowerCase() === raw.toLowerCase(),
        );
        return match ? { ...line, categoryId: match.id } : line;
      }
      case 'amount': {
        const amount = parseFloat(raw.replace(/,/g, ''));
        return isNaN(amount) ? line : { ...line, amount: String(amount) };
      }
      default:
        return line;
    }
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
      frequency: r.frequency,
      interval: String(r.interval ?? 1),
      nextDate: r.nextDate,
      notes: r.notes ?? '',
      lines: r.lines.map((l) => ({
        type: l.type,
        accountType: l.accountType,
        accountId: l.accountId ?? '',
        categoryId: l.categoryId ?? '',
        amount: String(l.amount),
      })),
    });
    this.showModal.set(true);
  }

  /** Every line must have a valid positive amount to save - same
   * all-or-nothing rule the Transactions page's Batch grid uses, rather
   * than silently dropping a bad line: this is manual entry, not an
   * unpredictable external file, so a clear "fix this line" beats a
   * transaction quietly vanishing. Same treatment for `interval` - it must
   * parse to a positive whole number, or the save is rejected outright
   * rather than silently falling back to 1. */
  save(): void {
    const f = this.form();
    if (!f.name.trim() || !f.nextDate || f.lines.length === 0) return;
    // `f.interval` comes back from a `type="number"` control, which Angular's
    // `NumberValueAccessor` already hands to `ngModelChange` as a real
    // number (or `null` when empty) despite the form field being typed as
    // `string` here (same convention `RecurringLineForm.amount` uses) -
    // `Number(...)` is a no-op in that case and just parses the rare
    // string value (e.g. a pasted "2.5") the same way.
    const interval = Number(f.interval);
    if (!Number.isInteger(interval) || interval < 1) return;
    const lines: Omit<RecurringLine, 'id'>[] = [];
    for (const l of f.lines) {
      const amount = parseFloat(l.amount);
      if (isNaN(amount) || amount <= 0) return;
      lines.push({
        amount,
        type: l.type,
        accountType: l.accountType,
        accountId: l.accountType === 'cash' || l.accountType === 'others' ? undefined : l.accountId || undefined,
        categoryId: l.categoryId || undefined,
      });
    }
    const payload = {
      name: f.name.trim(),
      frequency: f.frequency,
      interval,
      nextDate: f.nextDate,
      notes: f.notes.trim() || undefined,
      lines,
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
   * since it creates one transaction per active item's line, all at once.
   * A paused item is skipped entirely, none of its lines included (see
   * `RecurringTransaction.paused`), so the confirmation counts real
   * transactions (not just templates) and calls out how many items are
   * being skipped so it's not a surprise. */
  triggerAll(): void {
    const all = this.recurringList();
    if (all.length === 0) return;
    const active = all.filter((r) => !r.paused);
    const pausedCount = all.length - active.length;
    const txCount = active.reduce((sum, r) => sum + r.lines.length, 0);
    if (active.length === 0) {
      alert('Every recurring item is paused - nothing to add. Unpause an item first, or add it individually.');
      return;
    }
    const message =
      `Add ${txCount} transaction${txCount === 1 ? '' : 's'} from ${active.length} recurring item${active.length === 1 ? '' : 's'} to your Transactions now?` +
      (pausedCount > 0
        ? ` ${pausedCount} paused item${pausedCount === 1 ? '' : 's'} will be skipped (but will still move to its next date).`
        : '');
    if (!confirm(message)) return;
    this.state.triggerAllRecurring();
  }

  /** Toggles a template's paused state - see `RecurringTransaction.paused`. */
  togglePause(r: RecurringTransaction): void {
    this.state.togglePauseRecurring(r.id);
  }

  remove(id: string): void {
    if (confirm('Delete this recurring transaction? This will not remove any transactions it already created.')) {
      this.state.removeRecurring(id);
    }
  }
}
