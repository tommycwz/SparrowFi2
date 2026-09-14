import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../core/state.service';
import { formatMoney } from '../../core/currency.util';
import { FixedDeposit } from '../../core/models';
import { fdGainValue, fdMaturityDate, fdMaturityValue } from '../../core/fixed-deposit.util';
import { IconComponent } from '../../shared/icon';
import { ModalComponent } from '../../shared/modal';

interface FdForm {
  bankId: string;
  toBankId: string;
  startDate: string;
  amount: string;
  percentage: string;
  months: string;
  remarks: string;
}

function blankForm(defaultBankId: string): FdForm {
  return {
    bankId: defaultBankId,
    toBankId: '',
    startDate: new Date().toISOString().slice(0, 10),
    amount: '',
    percentage: '',
    months: '12',
    remarks: '',
  };
}

export type FdTab = 'active' | 'past';

@Component({
  selector: 'app-fixed-deposits',
  standalone: true,
  imports: [FormsModule, IconComponent, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './fixed-deposits.html',
  styleUrl: './fixed-deposits.scss',
})
export class FixedDepositsPage {
  readonly showModal = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly form = signal<FdForm>(blankForm(''));
  readonly tab = signal<FdTab>('active');

  constructor(readonly state: StateService) {}

  readonly banks = computed(() => this.state.state()?.banks ?? []);
  readonly deposits = computed(() =>
    [...(this.state.state()?.fixedDeposits ?? [])].sort((a, b) =>
      b.startDate.localeCompare(a.startDate),
    ),
  );

  /** Still earning interest - the deposits you'd actually check in on. */
  readonly activeDeposits = computed(() => this.deposits().filter((fd) => fd.status === 'active'));
  /** Matured or withdrawn - kept as a record of what happened, but split
   * out from the active list so a long history doesn't bury the handful of
   * deposits that still need attention. */
  readonly pastDeposits = computed(() => this.deposits().filter((fd) => fd.status !== 'active'));
  /** Whichever of the two lists above the current tab is showing. */
  readonly visibleDeposits = computed(() =>
    this.tab() === 'active' ? this.activeDeposits() : this.pastDeposits(),
  );

  money(amount: number): string {
    return formatMoney(amount, this.state.state()!.settings.currency);
  }

  bankName(id: string | undefined): string {
    if (!id) return 'None (memo only)';
    return this.banks().find((b) => b.id === id)?.name ?? '—';
  }

  maturityDate(fd: FixedDeposit): string {
    return fdMaturityDate(fd);
  }

  maturityValue(fd: FixedDeposit): number {
    return fdMaturityValue(fd);
  }

  /** Interest/gains portion only, on top of the principal - shown
   * separately in the card since maturity now books it as its own Income
   * transaction rather than lumping it into the payout. */
  gainValue(fd: FixedDeposit): number {
    return fdGainValue(fd);
  }

  /** Handles the "Bank" select changing - also clears any previously-chosen
   * proceeds destination when the source bank is set back to "None (memo
   * only)", since a memo-only FD has no principal moving out of any
   * account, so there's nothing for a destination bank to receive either. */
  onBankChange(bankId: string): void {
    this.form.update((f) => ({ ...f, bankId, toBankId: bankId ? f.toBankId : '' }));
  }

  openAdd(): void {
    this.editingId.set(null);
    this.form.set(blankForm(this.banks()[0]?.id ?? ''));
    this.showModal.set(true);
  }

  openEdit(fd: FixedDeposit): void {
    this.editingId.set(fd.id);
    this.form.set({
      bankId: fd.bankId ?? '',
      toBankId: fd.bankId ? fd.toBankId ?? '' : '',
      startDate: fd.startDate,
      amount: String(fd.amount),
      percentage: String(fd.percentage),
      months: String(fd.months),
      remarks: fd.remarks ?? '',
    });
    this.showModal.set(true);
  }

  save(): void {
    const f = this.form();
    const amount = parseFloat(f.amount);
    const percentage = parseFloat(f.percentage);
    const months = parseInt(f.months, 10);
    if (isNaN(amount) || amount <= 0 || isNaN(percentage) || isNaN(months)) return;
    const payload = {
      bankId: f.bankId || undefined,
      toBankId: f.toBankId || undefined,
      startDate: f.startDate,
      amount,
      percentage,
      months,
      remarks: f.remarks.trim() || undefined,
    };
    const id = this.editingId();
    if (id) {
      this.state.updateFixedDeposit(id, payload);
    } else {
      this.state.addFixedDeposit({ ...payload, status: 'active' });
    }
    this.showModal.set(false);
  }

  markMatured(fd: FixedDeposit): void {
    this.state.updateFixedDeposit(fd.id, { status: 'matured' });
  }

  markWithdrawn(fd: FixedDeposit): void {
    this.state.updateFixedDeposit(fd.id, { status: 'withdrawn' });
  }

  remove(id: string): void {
    if (confirm('Delete this fixed deposit record?')) {
      this.state.removeFixedDeposit(id);
    }
  }
}
