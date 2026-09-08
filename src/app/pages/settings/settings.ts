import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../core/state.service';
import { CURRENCIES, Currency } from '../../core/models';
import { formatRecoveryKey } from '../../core/spw-format.service';
import { ThemePreference, ThemeService } from '../../core/theme.service';
import { IconComponent } from '../../shared/icon';
import { ModalComponent } from '../../shared/modal';

type PasswordDialog = 'enable' | 'change' | null;

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule, IconComponent, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class SettingsPage {
  readonly currencies = CURRENCIES;
  readonly passwordDialog = signal<PasswordDialog>(null);
  readonly password = signal('');
  readonly confirmPassword = signal('');
  readonly passwordError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly recoveryKeyToShow = signal<string | null>(null);
  readonly recoveryWarningOpen = signal(false);

  constructor(
    readonly state: StateService,
    readonly theme: ThemeService,
  ) {}

  formatKey(raw: string): string {
    return formatRecoveryKey(raw);
  }

  setCurrency(currency: Currency): void {
    this.state.setCurrency(currency);
  }

  setTheme(pref: ThemePreference): void {
    this.theme.setPreference(pref);
  }

  openEnableDialog(): void {
    this.password.set('');
    this.confirmPassword.set('');
    this.passwordError.set(null);
    this.passwordDialog.set('enable');
  }

  openChangeDialog(): void {
    this.password.set('');
    this.confirmPassword.set('');
    this.passwordError.set(null);
    this.passwordDialog.set('change');
  }

  closePasswordDialog(): void {
    this.passwordDialog.set(null);
  }

  async submitPassword(): Promise<void> {
    const pw = this.password();
    if (pw.length < 4) {
      this.passwordError.set('Use at least 4 characters.');
      return;
    }
    if (pw !== this.confirmPassword()) {
      this.passwordError.set('Passwords do not match.');
      return;
    }
    this.busy.set(true);
    this.passwordError.set(null);
    try {
      if (this.passwordDialog() === 'enable') {
        const recoveryKey = await this.state.enablePasswordProtection(pw);
        this.recoveryKeyToShow.set(recoveryKey);
      } else {
        await this.state.changePassword(pw);
      }
      this.passwordDialog.set(null);
    } catch (err) {
      this.passwordError.set(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      this.busy.set(false);
    }
  }

  async regenerateRecoveryKey(): Promise<void> {
    this.recoveryWarningOpen.set(false);
    this.busy.set(true);
    try {
      const key = await this.state.regenerateRecoveryKey();
      this.recoveryKeyToShow.set(key);
    } finally {
      this.busy.set(false);
    }
  }

  disableProtection(): void {
    if (!confirm('Remove password protection? The file will be saved without encryption.')) return;
    this.state.disablePasswordProtection();
  }

  copyRecoveryKey(): void {
    const key = this.recoveryKeyToShow();
    if (!key) return;
    navigator.clipboard?.writeText(this.formatKey(key)).catch(() => {});
  }
}
