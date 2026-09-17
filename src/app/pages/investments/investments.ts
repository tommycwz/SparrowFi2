import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../core/state.service';
import { formatMoney } from '../../core/currency.util';
import { Investment } from '../../core/models';
import { investmentDelta } from '../../core/investment.util';
import { IconComponent } from '../../shared/icon';
import { ModalComponent } from '../../shared/modal';

type FundType = 'bank' | 'wallet';

/** A "fund" (bank or wallet) picker collapses type+id into one string for
 * a single `<select>`, same trick as encoding two dimensions into one HTML
 * form control - `''` means "none", valid for both "from fund" and
 * "to fund" (an investment can touch neither, either, or both accounts). */
function encodeFund(type: FundType | undefined, id: string | undefined): string {
  return type && id ? `${type}:${id}` : '';
}
function decodeFund(value: string): { type: FundType; id: string } | undefined {
  const [type, id] = value.split(':') as [FundType, string];
  return type && id ? { type, id } : undefined;
}

interface InvestmentForm {
  name: string;
  fromFund: string;
  toFund: string;
  amount: string;
  date: string;
  remarks: string;
}

interface CompleteForm {
  completionDate: string;
  finalAmount: string;
  toFund: string;
}

function blankForm(): InvestmentForm {
  return {
    name: '',
    fromFund: '',
    toFund: '',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
    remarks: '',
  };
}

export type InvestmentTab = 'active' | 'past';

@Component({
  selector: 'app-investments',
  standalone: true,
  imports: [FormsModule, IconComponent, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './investments.html',
  styleUrl: './investments.scss',
})
export class InvestmentsPage {
  readonly showModal = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly form = signal<InvestmentForm>(blankForm());
  readonly tab = signal<InvestmentTab>('active');
  /** Sort direction per tab, independently toggleable by the user - each
   * defaults to what reads most naturally for that tab (active: oldest
   * first, so a long-running investment isn't buried under new ones; past:
   * most recently completed first), but either can be flipped. */
  readonly activeSortDesc = signal(false);
  readonly pastSortDesc = signal(true);

  readonly completingId = signal<string | null>(null);
  readonly completeForm = signal<CompleteForm>({
    completionDate: new Date().toISOString().slice(0, 10),
    finalAmount: '',
    toFund: '',
  });
  /** The investment the Complete/Edit Completion modal is open for - drives
   * whether that modal reads "Complete Investment" (still active) or "Edit
   * Completion" (already completed, being corrected). */
  readonly completingInvestment = computed(() =>
    this.investments().find((i) => i.id === this.completingId()),
  );

  constructor(readonly state: StateService) {}

  readonly banks = computed(() => this.state.state()?.banks ?? []);
  readonly wallets = computed(() => this.state.state()?.wallets ?? []);
  readonly hasFunds = computed(() => this.banks().length > 0 || this.wallets().length > 0);

  /** Unsorted base list - `activeInvestments`/`pastInvestments` each apply
   * their own order below, so this is only for lookups where order doesn't
   * matter (e.g. finding one by id) and for the top-level empty-state
   * check. */
  readonly investments = computed(() => this.state.state()?.investments ?? []);

  /** Still open - the investments you'd actually check in on. Sorted by
   * investment date; direction follows `activeSortDesc` (defaults to
   * oldest first, so a longer-running investment doesn't get buried under
   * ones just started). */
  readonly activeInvestments = computed(() => {
    const dir = this.activeSortDesc() ? -1 : 1;
    return this.investments()
      .filter((i) => i.status === 'active')
      .sort((a, b) => dir * a.date.localeCompare(b.date));
  });
  /** Completed - kept as a record of what happened, split out from the
   * active list so a long history doesn't bury the ones still in play.
   * Sorted by *completion* date (not the original investment date);
   * direction follows `pastSortDesc` (defaults to most recently completed
   * first, so a correction via "Edit Completion" naturally surfaces near
   * the top). */
  readonly pastInvestments = computed(() => {
    const dir = this.pastSortDesc() ? -1 : 1;
    return this.investments()
      .filter((i) => i.status === 'completed')
      .sort((a, b) => dir * (a.completionDate ?? '').localeCompare(b.completionDate ?? ''));
  });

  /** Whichever tab is showing, whether its list is currently sorted
   * descending - drives the toggle button's icon/label. */
  readonly sortDesc = computed(() => (this.tab() === 'active' ? this.activeSortDesc() : this.pastSortDesc()));

  /** Toggles the current tab's sort direction. */
  toggleSort(): void {
    if (this.tab() === 'active') {
      this.activeSortDesc.update((v) => !v);
    } else {
      this.pastSortDesc.update((v) => !v);
    }
  }
  /** Whichever of the two lists above the current tab is showing. */
  readonly visibleInvestments = computed(() =>
    this.tab() === 'active' ? this.activeInvestments() : this.pastInvestments(),
  );

  money(amount: number): string {
    return formatMoney(amount, this.state.state()!.settings.currency);
  }

  fundName(type: FundType | undefined, id: string | undefined): string {
    if (!type || !id) return '—';
    const list = type === 'bank' ? this.banks() : this.wallets();
    return list.find((a) => a.id === id)?.name ?? '—';
  }

  delta(inv: Investment): number | undefined {
    return investmentDelta(inv);
  }

  /** Handles the "From fund" select changing. "From fund" and "To fund"
   * are independent - money can come from outside SparrowFi (no From fund)
   * and still pay back into a tracked account on completion, or vice
   * versa - so this no longer clears "To fund" the way it used to. That
   * old coupling was the bug behind investments completing with no
   * "Investment (In)"/"Investment Profit" transactions: any investment
   * added with "From fund" left as "None" could never have a "To fund"
   * selected either, since the field was hidden until "From fund" was set. */
  onFromFundChange(fromFund: string): void {
    this.form.update((f) => ({ ...f, fromFund }));
  }

  openAdd(): void {
    this.editingId.set(null);
    this.form.set(blankForm());
    this.showModal.set(true);
  }

  openEdit(inv: Investment): void {
    this.editingId.set(inv.id);
    this.form.set({
      name: inv.name,
      fromFund: encodeFund(inv.fromAccountType, inv.fromAccountId),
      toFund: encodeFund(inv.toAccountType, inv.toAccountId),
      amount: String(inv.amount),
      date: inv.date,
      remarks: inv.remarks ?? '',
    });
    this.showModal.set(true);
  }

  save(): void {
    const f = this.form();
    const amount = parseFloat(f.amount);
    if (!f.name.trim() || isNaN(amount) || amount <= 0) return;
    const from = decodeFund(f.fromFund);
    const to = decodeFund(f.toFund);
    const payload = {
      name: f.name.trim(),
      fromAccountId: from?.id,
      fromAccountType: from?.type,
      toAccountId: to?.id,
      toAccountType: to?.type,
      amount,
      date: f.date,
      remarks: f.remarks.trim() || undefined,
    };
    const id = this.editingId();
    if (id) {
      this.state.updateInvestment(id, payload);
    } else {
      this.state.addInvestment(payload);
    }
    this.showModal.set(false);
  }

  /** Opens the Complete/Edit Completion modal. For a still-active
   * investment this defaults to today's date and the invested amount (a
   * gain/loss of zero to start from); for an already-completed one, it
   * prefills with what was actually recorded, so reopening it is a
   * correction rather than a reset. */
  openComplete(inv: Investment): void {
    this.completingId.set(inv.id);
    const alreadyCompleted = inv.status === 'completed';
    this.completeForm.set({
      completionDate: alreadyCompleted ? (inv.completionDate ?? inv.date) : new Date().toISOString().slice(0, 10),
      finalAmount: String(alreadyCompleted ? (inv.finalAmount ?? inv.amount) : inv.amount),
      toFund: encodeFund(inv.toAccountType, inv.toAccountId),
    });
  }

  /** Patches the investment's "To fund" (if it was changed here, in the
   * Complete modal, rather than back on the Edit form) and then books the
   * completion. The two are separate calls because `completeInvestment`
   * only ever reads the investment's *already-saved* toAccountId/Type -
   * see its doc comment - so a fund picked in this same dialog has to land
   * on the investment record first. */
  saveComplete(): void {
    const id = this.completingId();
    if (!id) return;
    const f = this.completeForm();
    const finalAmount = parseFloat(f.finalAmount);
    if (!f.completionDate || isNaN(finalAmount) || finalAmount < 0) return;
    const to = decodeFund(f.toFund);
    this.state.updateInvestment(id, { toAccountId: to?.id, toAccountType: to?.type });
    this.state.completeInvestment(id, f.completionDate, finalAmount);
    this.completingId.set(null);
  }

  cancelComplete(): void {
    this.completingId.set(null);
  }

  remove(id: string): void {
    if (confirm('Delete this investment record?')) {
      this.state.removeInvestment(id);
    }
  }
}
