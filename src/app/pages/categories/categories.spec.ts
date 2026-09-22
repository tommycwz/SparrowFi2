import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CategoriesPage } from './categories';
import { StateService } from '../../core/state.service';
import { createEmptyState } from '../../core/models';

describe('CategoriesPage', () => {
  let state: StateService;
  let page: CategoriesPage;
  let fixture: ComponentFixture<CategoriesPage>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CategoriesPage] });
    state = TestBed.inject(StateService);
    state.replaceState(createEmptyState());
    fixture = TestBed.createComponent(CategoriesPage);
    page = fixture.componentInstance;
  });

  it('has a tab for each transaction type, including Commitment', () => {
    expect(page.tabs).toEqual(['income', 'expense', 'commitment', 'others-in', 'others-out']);
  });

  describe('categories are pinned to a single tab/type', () => {
    beforeEach(() => {
      state.addCategory({ name: 'Transfer (Out)', color: '#0EA5E9', type: 'others-out' });
      state.addCategory({ name: 'Salary', color: '#16A34A', type: 'income' });
      state.addCategory({ name: 'Transfer (In)', color: '#0284C7', type: 'others-in' });
    });

    it('only shows a category under the one tab matching its type', () => {
      page.tab.set('others-in');
      expect(page.categories().map((c) => c.name)).toEqual(['Transfer (In)']);
      page.tab.set('others-out');
      expect(page.categories().map((c) => c.name)).toEqual(['Transfer (Out)']);
      page.tab.set('income');
      expect(page.categories().map((c) => c.name)).toEqual(['Salary']);
    });

    it('counts each category toward its own single type only', () => {
      const counts = page.tabCounts();
      expect(counts['others-in']).toBe(1);
      expect(counts['others-out']).toBe(1);
      expect(counts.income).toBe(1);
    });
  });

  describe('rendered DOM', () => {
    it('renders one segmented tab per transaction type', () => {
      fixture.detectChanges();
      const tabs = fixture.nativeElement.querySelectorAll('.segmented button');
      expect(tabs.length).toBe(5);
    });
  });

  describe('locked categories (Fixed Deposit/Investment-linked)', () => {
    it('hides the delete button and shows a "Locked" badge instead, but keeps the row reorderable', () => {
      state.addCategory({ name: 'Investment Profit', color: '#10B981', type: 'income', locked: true });
      state.addCategory({ name: 'Side Hustle', color: '#22C55E', type: 'income' });
      page.tab.set('income');
      fixture.detectChanges();

      const rows = Array.from(fixture.nativeElement.querySelectorAll('.row')) as HTMLElement[];
      const lockedRow = rows.find((r) => r.textContent?.includes('Investment Profit'))!;
      const customRow = rows.find((r) => r.textContent?.includes('Side Hustle'))!;

      expect(lockedRow.querySelector('[aria-label="Delete"]')).toBeNull();
      expect(lockedRow.querySelector('.badge-locked')?.textContent).toContain('Locked');
      expect(customRow.querySelector('[aria-label="Delete"]')).not.toBeNull();
      expect(customRow.querySelector('.badge-locked')).toBeNull();

      // Being locked only blocks deletion (see `Category.locked`) - it
      // doesn't affect display order, so the reorder buttons still show.
      expect(lockedRow.querySelector('.reorder-btns')).not.toBeNull();
    });

    it('remove() is a no-op for a locked category, even if called directly', () => {
      state.addCategory({ name: 'Investment Profit', color: '#10B981', type: 'income', locked: true });
      const id = state.state()!.categories[0].id;

      page.remove(id);

      expect(state.state()!.categories.length).toBe(1);
    });
  });

  describe('reordering', () => {
    beforeEach(() => {
      state.addCategory({ name: 'Groceries', color: '#F97316', type: 'expense' });
      state.addCategory({ name: 'Transport', color: '#D97706', type: 'expense' });
      state.addCategory({ name: 'Shopping', color: '#EC4899', type: 'expense' });
      page.tab.set('expense');
    });

    it('move() up/down swaps the category with its neighbor in the tab', () => {
      const [groceries, transport] = state.state()!.categories;

      page.move(transport.id, 'up');

      expect(page.categories().map((c) => c.name)).toEqual(['Transport', 'Groceries', 'Shopping']);

      page.move(groceries.id, 'down');
      // Groceries (now 2nd) swaps with Shopping (3rd).
      expect(page.categories().map((c) => c.name)).toEqual(['Transport', 'Shopping', 'Groceries']);
    });

    it('disables the Up button on the first row and the Down button on the last row', () => {
      fixture.detectChanges();
      const rows = Array.from(fixture.nativeElement.querySelectorAll('.row')) as HTMLElement[];

      const firstUp = rows[0].querySelector('[aria-label="Move up"]') as HTMLButtonElement;
      const firstDown = rows[0].querySelector('[aria-label="Move down"]') as HTMLButtonElement;
      const lastUp = rows[rows.length - 1].querySelector('[aria-label="Move up"]') as HTMLButtonElement;
      const lastDown = rows[rows.length - 1].querySelector('[aria-label="Move down"]') as HTMLButtonElement;

      expect(firstUp.disabled).toBe(true);
      expect(firstDown.disabled).toBe(false);
      expect(lastUp.disabled).toBe(false);
      expect(lastDown.disabled).toBe(true);
    });
  });
});
