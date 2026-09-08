import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StateService, AccountBalance } from '../../core/state.service';
import { formatMoney } from '../../core/currency.util';
import { DEFAULT_CATEGORY_COLORS } from '../../core/models';
import { IconComponent } from '../../shared/icon';
import { ModalComponent } from '../../shared/modal';
import { ColorPickerComponent } from '../../shared/color-picker';

type Tab = 'bank' | 'wallet' | 'card';

@Component({
  selector: 'app-accounts',
  standalone: true,
  imports: [FormsModule, IconComponent, ModalComponent, ColorPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './accounts.html',
  styleUrl: './accounts.scss',
})
export class AccountsPage {
  readonly colors = DEFAULT_CATEGORY_COLORS;
  readonly tab = signal<Tab>('bank');
  readonly showModal = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly name = signal('');
  readonly color = signal(this.colors[0]);

  constructor(readonly state: StateService) {}

  readonly items = computed<AccountBalance[]>(() =>
    this.state.accountBalances().filter((a) => a.kind === this.tab()),
  );

  money(amount: number): string {
    return formatMoney(amount, this.state.state()!.settings.currency);
  }

  openAdd(): void {
    this.editingId.set(null);
    this.name.set('');
    this.color.set(this.colors[Math.floor(Math.random() * this.colors.length)]);
    this.showModal.set(true);
  }

  openEdit(item: AccountBalance): void {
    this.editingId.set(item.id);
    this.name.set(item.name);
    this.color.set(item.color);
    this.showModal.set(true);
  }

  save(): void {
    const name = this.name().trim();
    if (!name) return;
    const id = this.editingId();
    const tab = this.tab();
    if (id) {
      if (tab === 'bank') this.state.updateBank(id, { name, color: this.color() });
      else if (tab === 'wallet') this.state.updateWallet(id, { name, color: this.color() });
      else this.state.updateCard(id, { name, color: this.color() });
    } else {
      if (tab === 'bank') this.state.addBank({ name, color: this.color(), initialCapital: 0 });
      else if (tab === 'wallet')
        this.state.addWallet({ name, color: this.color(), initialCapital: 0 });
      else this.state.addCard({ name, color: this.color() });
    }
    this.showModal.set(false);
  }

  remove(id: string): void {
    if (!confirm('Delete this account? Its transactions will also be removed.')) return;
    const tab = this.tab();
    if (tab === 'bank') this.state.removeBank(id);
    else if (tab === 'wallet') this.state.removeWallet(id);
    else this.state.removeCard(id);
  }
}
