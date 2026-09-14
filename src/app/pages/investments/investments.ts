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

  readonly completingId = signal<string | null>(null);
  readonly completeForm = signal<CompleteForm>({
    completionDate: new Date().toISOString().slice(0, 10),
    finalAmount: '',
  });

  constructor(readonly state: StateService) {}

  readonly banks = computed(() => this.state.state()?.banks ?? []);
  readonly wallets = computed(() => this.state.state()?.wallets ?? []);
  readonly hasFunds = computed(() => this.banks().length > 0 || this.wallets().length > 0);

  readonly investments = computed(() =>
    [...(this.state.state()?.investments ?? [])].sort((a, b) => b.date.localeCompare(a.date)),
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

  openComplete(inv: Investment): void {
    this.completingId.set(inv.id);
    this.completeForm.set({
      completionDate: new Date().toISOString().slice(0, 10),
      finalAmount: String(inv.amount),
    });
  }

  saveComplete(): void {
    const id = this.completingId();
    if (!id) return;
    const f = this.completeForm();
    const finalAmount = parseFloat(f.finalAmount);
    if (!f.completionDate || isNaN(finalAmount) || finalAmount < 0) return;
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
