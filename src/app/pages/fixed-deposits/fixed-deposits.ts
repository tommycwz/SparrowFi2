import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../core/state.service';
import { formatMoney } from '../../core/currency.util';
import { FixedDeposit } from '../../core/models';
import { fdMaturityDate, fdMaturityValue } from '../../core/fixed-deposit.util';
import { IconComponent } from '../../shared/icon';
import { ModalComponent } from '../../shared/modal';

interface FdForm {
  bankId: string;
  toBankId: string;
  startDate: string;
  amount: string;
  percentage: string;
  months: string;
}

function blankForm(defaultBankId: string): FdForm {
  return {
    bankId: defaultBankId,
    toBankId: '',
    startDate: new Date().toISOString().slice(0, 10),
    amount: '',
    percentage: '',
    months: '12',
  };
}

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

  constructor(readonly state: StateService) {}

  readonly banks = computed(() => this.state.state()?.banks ?? []);
  readonly deposits = computed(() =>
    [...(this.state.state()?.fixedDeposits ?? [])].sort((a, b) =>
      b.startDate.localeCompare(a.startDate),
    ),
  );

  money(amount: number): string {
    return formatMoney(amount, this.state.state()!.settings.currency);
  }

  bankName(id: string): string {
    return this.banks().find((b) => b.id === id)?.name ?? '—';
  }

  maturityDate(fd: FixedDeposit): string {
    return fdMaturityDate(fd);
  }

  maturityValue(fd: FixedDeposit): number {
    return fdMaturityValue(fd);
  }

  openAdd(): void {
    this.editingId.set(null);
    this.form.set(blankForm(this.banks()[0]?.id ?? ''));
    this.showModal.set(true);
  }

  openEdit(fd: FixedDeposit): void {
    this.editingId.set(fd.id);
    this.form.set({
      bankId: fd.bankId,
      toBankId: fd.toBankId ?? '',
      startDate: fd.startDate,
      amount: String(fd.amount),
      percentage: String(fd.percentage),
      months: String(fd.months),
    });
    this.showModal.set(true);
  }

  save(): void {
    const f = this.form();
    const amount = parseFloat(f.amount);
    const percentage = parseFloat(f.percentage);
    const months = parseInt(f.months, 10);
    if (!f.bankId || isNaN(amount) || amount <= 0 || isNaN(percentage) || isNaN(months)) return;
    const payload = {
      bankId: f.bankId,
      toBankId: f.toBankId || undefined,
      startDate: f.startDate,
      amount,
      percentage,
      months,
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
