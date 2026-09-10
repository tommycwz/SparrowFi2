import { ChangeDetectionStrategy, Component, effect, signal } from '@angular/core';
import { StateService } from '../../core/state.service';
import { CloudAuthService } from '../../core/cloud-auth.service';
import { IconComponent } from '../../shared/icon';
import { CloudAuthPanelComponent } from '../../shared/cloud-auth-panel';

/**
 * The whole front door to SparrowFi: sign in or create an account, then
 * automatically load that account's data. There is no local-file picker
 * here anymore - `app.html` only renders this page while
 * `StateService.isLoaded()` is false, and this page's only job is to make
 * that become true.
 */
@Component({
  selector: 'app-launcher',
  standalone: true,
  imports: [IconComponent, CloudAuthPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './launcher.html',
  styleUrl: './launcher.scss',
})
export class LauncherPage {
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);

  private loadStarted = false;

  constructor(
    readonly state: StateService,
    readonly cloudAuth: CloudAuthService,
  ) {
    // As soon as sign-in succeeds (auth.user() becomes non-null), load this
    // account's data automatically - there's no separate "restore" step to
    // click through. `loadStarted` (a plain flag, not a signal) guards
    // against re-firing while the load is in flight without adding it to
    // this effect's own reactive dependencies.
    effect(() => {
      if (this.cloudAuth.user() && !this.state.isLoaded() && !this.loadStarted) {
        this.loadStarted = true;
        this.loadData();
      }
    });
  }

  retryLoad(): void {
    this.loadStarted = true;
    this.loadData();
  }

  private async loadData(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      await this.state.load();
    } catch (err) {
      this.loadError.set(err instanceof Error ? err.message : 'Could not load your data.');
    } finally {
      this.loading.set(false);
    }
  }
}
