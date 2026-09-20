import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TransactionsPage } from './transactions';
import { StateService } from '../../core/state.service';
import { createEmptyState } from '../../core/models';

const TODAY = new Date().toISOString().slice(0, 10);

/** Builds a minimal fake `ClipboardEvent` good enough for `onBatchPaste` -
 * jsdom's real `ClipboardEvent`/`DataTransfer` support is too limited to
 * construct one properly, and all `onBatchPaste` actually reads off the
 * event is `clipboardData.getData('text')` plus whether `preventDefault`
 * was called (tracked here with a plain flag rather than a test-framework
 * spy, so this doesn't depend on whichever one the project runs under). */
interface FakePasteEvent {
  clipboardData: { getData: () => string };
  preventDefault: () => void;
  defaultPrevented: boolean;
}

function pasteEvent(text: string): FakePasteEvent {
  const event: FakePasteEvent = {
    clipboardData: { getData: () => text },
    preventDefault: () => {
      event.defaultPrevented = true;
    },
    defaultPrevented: false,
  };
  return event;
}

describe('TransactionsPage', () => {
  let state: StateService;
  let page: TransactionsPage;
  let fixture: ComponentFixture<TransactionsPage>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TransactionsPage] });
    state = TestBed.inject(StateService);
    state.replaceState(createEmptyState());
    fixture = TestBed.createComponent(TransactionsPage);
    page = fixture.componentInstance;
  });

  describe('typeColor', () => {
    it('gives each transaction type its own accent color', () => {
      const colors = page.typeOptions.map((t) => page.typeColor(t));
      // All must be distinct, so the picker actually tells them apart.
      expect(new Set(colors).size).toBe(page.typeOptions.length);
    });

    it('keeps the existing green/red convention for income and expense', () => {
      expect(page.typeColor('income')).toBe('var(--success)');
      expect(page.typeColor('expense')).toBe('var(--danger)');
    });
  });

  describe('Type tabs (rendered DOM)', () => {
    it('opens the Add Transaction modal with one tab per type and the current type marked active', () => {
      page.openAdd();
      fixture.detectChanges();

      const tabs = fixture.nativeElement.querySelectorAll('.type-tab') as NodeListOf<HTMLElement>;
      expect(tabs.length).toBe(page.typeOptions.length);
      // blankForm() defaults to 'expense'.
      const active = fixture.nativeElement.querySelector('.type-tab.active') as HTMLElement;
      expect(active.textContent?.trim()).toBe('Expense');
    });

    it('clicking a tab switches the form type and moves the active state', () => {
      page.openAdd();
      fixture.detectChanges();

      const tabs = Array.from(
        fixture.nativeElement.querySelectorAll('.type-tab') as NodeListOf<HTMLElement>,
      );
      const incomeTab = tabs.find((t) => t.textContent?.trim() === 'Income')!;
      incomeTab.click();
      fixture.detectChanges();

      expect(page.form().type).toBe('income');
      expect(incomeTab.classList.contains('active')).toBe(true);
      expect(
        (fixture.nativeElement.querySelector('.type-tab.active') as HTMLElement).textContent?.trim(),
      ).toBe('Income');
    });
  });

  describe('accountColor', () => {
    it("shows the specific bank's own color next to its name in the list, not a generic dot", () => {
      state.addBank({ name: 'Maybank', color: '#2563EB', initialCapital: 1000 });
      const bank = state.state()!.banks[0];
      fixture.detectChanges();

      const row = fixture.nativeElement.querySelector('.tx-row') as HTMLElement;
      const dots = row.querySelectorAll('.tx-dot');
      // First dot is the category's, second is the account's.
      expect((dots[1] as HTMLElement).style.background).toBe('rgb(37, 99, 235)');
      expect(row.querySelector('.tx-account')?.textContent).toContain('Maybank');
      expect(page.accountColor(state.state()!.transactions[0])).toBe(bank.color);
    });

    it('falls back to a neutral gray for Cash/Others, which have no color of their own', () => {
      state.addTransaction({ date: '2026-01-01', amount: 20, type: 'expense', accountType: 'cash' });
      const t = state.state()!.transactions[0];
      expect(page.accountColor(t)).toBe('#94A3B8');
    });
  });

  describe('categoriesForType', () => {
    beforeEach(() => {
      state.addCategory({ name: 'Transfer (Out)', color: '#0EA5E9', type: 'others-out' });
      state.addCategory({ name: 'Transfer (In)', color: '#0284C7', type: 'others-in' });
    });

    it('only offers categories matching the form\'s current type', () => {
      page.openAdd();
      page.onTypeChange('others-in');
      expect(page.categoriesForType().map((c) => c.name)).toEqual(['Transfer (In)']);
      page.onTypeChange('others-out');
      expect(page.categoriesForType().map((c) => c.name)).toEqual(['Transfer (Out)']);
    });

    it('does not offer Others categories under Income/Expense/Commitment', () => {
      page.openAdd();
      page.onTypeChange('expense');
      expect(page.categoriesForType().map((c) => c.name)).not.toContain('Transfer (Out)');
    });

    it('keeps each category under its own single optgroup in the filter dropdown', () => {
      const groups = page.categoryFilterGroups();
      const inGroup = groups.find((g) => g.type === 'others-in')!;
      const outGroup = groups.find((g) => g.type === 'others-out')!;
      expect(inGroup.categories.map((c) => c.name)).toEqual(['Transfer (In)']);
      expect(outGroup.categories.map((c) => c.name)).toEqual(['Transfer (Out)']);
    });
  });

  describe('monthlyStats', () => {
    it('breaks Commitment out from Expense, but still subtracts it from Net Balance', () => {
      state.addTransaction({ date: '2026-01-01', amount: 5000, type: 'income', accountType: 'cash' });
      state.addTransaction({ date: '2026-01-01', amount: 800, type: 'expense', accountType: 'cash' });
      state.addTransaction({ date: '2026-01-01', amount: 1200, type: 'commitment', accountType: 'cash' });
      page.toggleAllMonths(); // so the fixed 2026-01-01 dates above are in view regardless of today's date

      const stats = page.monthlyStats();
      expect(stats.income).toBe(5000);
      expect(stats.expense).toBe(800);
      expect(stats.commitment).toBe(1200);
      expect(stats.net).toBe(5000 - 800 - 1200);
    });
  });

  describe('openBatch / addBatchRow / removeBatchRow', () => {
    it('opens with a fixed number of blank rows', () => {
      page.openBatch();
      expect(page.batchRows().length).toBe(8);
      expect(page.batchRows().every((r) => r.date === '' && r.amount === '')).toBe(true);
    });

    it('addBatchRow appends one more blank row', () => {
      page.openBatch();
      const before = page.batchRows().length;
      page.addBatchRow();
      expect(page.batchRows().length).toBe(before + 1);
    });

    it('removeBatchRow drops only the targeted row', () => {
      page.openBatch();
      page.updateBatchCell(1, 'notes', 'keep me');
      page.removeBatchRow(0);
      expect(page.batchRows().length).toBe(7);
      expect(page.batchRows()[0].notes).toBe('keep me');
    });

    it('cancelBatch clears the grid so reopening starts fresh', () => {
      page.openBatch();
      page.updateBatchCell(0, 'notes', 'scratch');
      page.cancelBatch();
      expect(page.showBatchModal()).toBe(false);
      expect(page.batchRows()).toEqual([]);
    });
  });

  describe('batchResults / batchCanSave', () => {
    it('leaves an untouched row (no date, no amount) out entirely - not valid, not an error', () => {
      page.openBatch();
      const results = page.batchResults();
      expect(results.every((r) => r.blank)).toBe(true);
      expect(page.batchValidCount()).toBe(0);
      expect(page.batchErrorCount()).toBe(0);
      // Nothing to save yet, but that's not the same as "has errors".
      expect(page.batchCanSave()).toBe(false);
    });

    it('flags a row with an amount but no date', () => {
      page.openBatch();
      page.updateBatchCell(0, 'amount', '50');
      expect(page.batchResults()[0].error).toContain('Date');
      expect(page.batchCanSave()).toBe(false);
    });

    it('flags a row with a date but a zero/invalid amount', () => {
      page.openBatch();
      page.updateBatchCell(0, 'date', TODAY);
      page.updateBatchCell(0, 'amount', '0');
      expect(page.batchResults()[0].error).toContain('Amount');
    });

    it('produces a ready-to-save payload for a row with just a date and a positive amount', () => {
      page.openBatch();
      page.updateBatchCell(0, 'date', TODAY);
      page.updateBatchCell(0, 'amount', '120');
      const result = page.batchResults()[0];
      expect(result.error).toBeUndefined();
      expect(result.payload).toEqual({
        date: TODAY,
        amount: 120,
        type: 'expense',
        accountType: 'bank',
        accountId: undefined,
        categoryId: undefined,
        notes: undefined,
      });
    });

    it('batchCanSave is false while ANY non-blank row still has an error, even if others are valid', () => {
      page.openBatch();
      page.updateBatchCell(0, 'date', TODAY);
      page.updateBatchCell(0, 'amount', '100'); // valid
      page.updateBatchCell(1, 'amount', '50'); // invalid: no date
      expect(page.batchValidCount()).toBe(1);
      expect(page.batchErrorCount()).toBe(1);
      expect(page.batchCanSave()).toBe(false);
    });
  });

  describe('onBatchTypeChange / onBatchAccountTypeChange', () => {
    it("changing a row's Type clears its Category, same as the single Add form", () => {
      page.openBatch();
      page.updateBatchCell(0, 'categoryId', 'some-id');
      page.onBatchTypeChange(0, 'income');
      expect(page.batchRows()[0].type).toBe('income');
      expect(page.batchRows()[0].categoryId).toBe('');
    });

    it("changing a row's Account Type clears its Account", () => {
      page.openBatch();
      page.updateBatchCell(0, 'accountId', 'some-id');
      page.onBatchAccountTypeChange(0, 'wallet');
      expect(page.batchRows()[0].accountType).toBe('wallet');
      expect(page.batchRows()[0].accountId).toBe('');
    });

    it('only touches the targeted row, leaving other rows alone', () => {
      page.openBatch();
      page.onBatchTypeChange(2, 'income');
      expect(page.batchRows()[0].type).toBe('expense');
      expect(page.batchRows()[2].type).toBe('income');
    });
  });

  describe('saveBatch', () => {
    it('adds every valid, non-blank row as a transaction and closes the grid', () => {
      page.openBatch();
      page.updateBatchCell(0, 'date', TODAY);
      page.updateBatchCell(0, 'amount', '75');
      page.updateBatchCell(0, 'notes', 'Groceries run');

      page.saveBatch();

      expect(state.state()!.transactions.length).toBe(1);
      expect(state.state()!.transactions[0].amount).toBe(75);
      expect(state.state()!.transactions[0].notes).toBe('Groceries run');
      expect(page.showBatchModal()).toBe(false);
    });

    it('does nothing when batchCanSave is false (e.g. an error row present)', () => {
      page.openBatch();
      page.updateBatchCell(0, 'amount', '50'); // no date -> error
      page.saveBatch();
      expect(state.state()!.transactions.length).toBe(0);
      // The grid stays open so the user can fix the error row.
      expect(page.showBatchModal()).toBe(true);
    });

    it('skips blank rows silently rather than saving them as empty transactions', () => {
      page.openBatch(); // 8 blank rows
      page.updateBatchCell(3, 'date', TODAY);
      page.updateBatchCell(3, 'amount', '10');
      page.saveBatch();
      expect(state.state()!.transactions.length).toBe(1);
    });
  });

  describe('onBatchPaste - single value', () => {
    it('does not intercept a plain single-cell paste, leaving the native paste to happen', () => {
      page.openBatch();
      const event = pasteEvent('120');
      page.onBatchPaste(event as unknown as ClipboardEvent, 0, 'amount');
      expect(event.defaultPrevented).toBe(false);
      // Nothing was written by onBatchPaste itself - the browser's default
      // paste behavior (not exercised in this unit test) is what would
      // actually place "120" into the input.
      expect(page.batchRows()[0].amount).toBe('');
    });
  });

  describe('onBatchPaste - multi-cell (Excel-style)', () => {
    beforeEach(() => {
      state.addBank({ name: 'Maybank', color: '#2563EB', initialCapital: 0 });
      state.addCategory({ name: 'Groceries', color: '#EF4444', type: 'expense' });
    });

    it('fans a single pasted row of tab-separated values across the columns starting at the pasted cell', () => {
      page.openBatch();
      const event = pasteEvent('2026-01-05\tExpense\tBank\tMaybank\tGroceries\t45.50\tWeekly shop');
      page.onBatchPaste(event as unknown as ClipboardEvent, 0, 'date');

      expect(event.defaultPrevented).toBe(true);
      const row = page.batchRows()[0];
      expect(row.date).toBe('2026-01-05');
      expect(row.type).toBe('expense');
      expect(row.accountType).toBe('bank');
      expect(row.accountId).toBe(state.state()!.banks[0].id);
      expect(row.categoryId).toBe(state.state()!.categories[0].id);
      expect(row.amount).toBe('45.5');
      expect(row.notes).toBe('Weekly shop');
    });

    it('fans multiple pasted rows down into subsequent grid rows, growing the grid if needed', () => {
      page.openBatch();
      const text = ['2026-01-01\t10', '2026-01-02\t20', '2026-01-03\t30'].join('\n');
      page.onBatchPaste(pasteEvent(text) as unknown as ClipboardEvent, 6, 'date'); // pasted starting at the 7th of 8 rows

      expect(page.batchRows().length).toBeGreaterThanOrEqual(9);
      expect(page.batchRows()[6].date).toBe('2026-01-01');
      expect(page.batchRows()[6].amount).toBe('10');
      expect(page.batchRows()[7].date).toBe('2026-01-02');
      expect(page.batchRows()[8].date).toBe('2026-01-03');
    });

    it('starts fanning from the column of the cell that was pasted into, not always column 0', () => {
      page.openBatch();
      // Pasted starting at the Amount column - only Amount and Notes should
      // be affected on this row.
      const event = pasteEvent('99.99\tPasted note');
      page.onBatchPaste(event as unknown as ClipboardEvent, 0, 'amount');

      const row = page.batchRows()[0];
      expect(row.amount).toBe('99.99');
      expect(row.notes).toBe('Pasted note');
      expect(row.date).toBe(''); // untouched
    });

    it('ignores an unrecognized Type/Account/Category value rather than clearing the row or throwing', () => {
      page.openBatch();
      const event = pasteEvent('2026-01-05\tNotAType\tBank\tNoSuchBank\tNoSuchCategory\t10\tnote');
      page.onBatchPaste(event as unknown as ClipboardEvent, 0, 'date');

      const row = page.batchRows()[0];
      expect(row.date).toBe('2026-01-05');
      expect(row.type).toBe('expense'); // default kept, unrecognized label ignored
      expect(row.accountType).toBe('bank');
      expect(row.accountId).toBe(''); // no match found, left unset
      expect(row.categoryId).toBe(''); // no match found, left unset
      expect(row.amount).toBe('10');
    });

    it('ignores extra pasted columns past Notes instead of throwing', () => {
      page.openBatch();
      const event = pasteEvent('2026-01-05\tExpense\tCash\t\t\t10\tnote\tEXTRA\tEXTRA2');
      expect(() => page.onBatchPaste(event as unknown as ClipboardEvent, 0, 'date')).not.toThrow();
      expect(page.batchRows()[0].notes).toBe('note');
    });
  });
});
