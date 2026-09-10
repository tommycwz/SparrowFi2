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
    it('gives each of the four transaction types its own accent color', () => {
      const colors = page.typeOptions.map((t) => page.typeColor(t));
      // All four must be distinct, so the picker actually tells them apart.
      expect(new Set(colors).size).toBe(4);
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
      expect(tabs.length).toBe(4);
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
});
