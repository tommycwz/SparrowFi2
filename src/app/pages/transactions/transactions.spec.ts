import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TransactionsPage } from './transactions';
import { StateService } from '../../core/state.service';
import { createEmptyState } from '../../core/models';

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
});
