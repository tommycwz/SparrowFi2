import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StateService } from '../../core/state.service';
import { formatMoney } from '../../core/currency.util';
import { IconComponent } from '../../shared/icon';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class DashboardPage {
  constructor(readonly state: StateService) {}

  readonly netWorthLabel = computed(() =>
    formatMoney(this.state.netWorth(), this.state.state()!.settings.currency),
  );

  readonly recentTransactions = computed(() =>
    [...(this.state.state()?.transactions ?? [])]
      .sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')))
      .reverse()
      .slice(0, 6),
  );

  money(amount: number): string {
    return formatMoney(amount, this.state.state()!.settings.currency);
  }

  categoryName(id?: string): string {
    if (!id) return 'Uncategorized';
    return this.state.state()?.categories.find((c) => c.id === id)?.name ?? 'Uncategorized';
  }

  categoryColor(id?: string): string {
    return this.state.state()?.categories.find((c) => c.id === id)?.color ?? '#94A3B8';
  }
}
