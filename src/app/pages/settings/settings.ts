import { ChangeDetectionStrategy, Component, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../core/state.service';
import { CURRENCIES, Currency } from '../../core/models';
import { formatRecoveryKey } from '../../core/spw-format.service';
import { ThemePreference, ThemeService } from '../../core/theme.service';
import { CloudAuthService } from '../../core/cloud-auth.service';
import { CloudBackupService } from '../../core/cloud-backup.service';
import { IconComponent } from '../../shared/icon';
import { ModalComponent } from '../../shared/modal';
import { CloudAuthPanelComponent } from '../../shared/cloud-auth-panel';

type PasswordDialog = 'enable' | 'change' | null;

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule, IconComponent, ModalComponent, CloudAuthPanelComponent],
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

  readonly cloudBusy = signal(false);
  readonly cloudError = signal<string | null>(null);
  readonly lastBackupLabel = signal<string | null>(null);

  constructor(
    readonly state: StateService,
    readonly theme: ThemeService,
    readonly cloudAuth: CloudAuthService,
    readonly cloudBackup: CloudBackupService,
  ) {
    // Whenever sign-in state (or the open file) changes, look up whether
    // this file already has a cloud backup on record, so "Last backed up"
    // is accurate even before the user clicks "Backup Now" this session.
    effect(() => {
      const user = this.cloudAuth.user();
      const filename = this.state.fileName();
      if (!user) {
        this.lastBackupLabel.set(null);
        return;
      }
      this.cloudBackup
        .listBackups()
        .then((backups) => {
          const match = backups.find((b) => b.filename === filename);
          this.lastBackupLabel.set(match ? new Date(match.updatedAt).toLocaleString() : null);
        })
        .catch(() => this.lastBackupLabel.set(null));
    });
  }

  async backupNow(): Promise<void> {
    this.cloudBusy.set(true);
    this.cloudError.set(null);
    try {
      await this.cloudBackup.backupNow();
      const at = this.cloudBackup.lastBackupAt();
      this.lastBackupLabel.set(at ? new Date(at).toLocaleString() : null);
    } catch (err) {
      this.cloudError.set(err instanceof Error ? err.message : 'Backup failed.');
    } finally {
      this.cloudBusy.set(false);
    }
  }

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
    if (pw.length < 6) {
      // 6 chars, not 4 - matches Supabase Auth's own minimum, so this same
      // password can double as the Cloud Backup sign-in password with no
      // separate rule to hit.
      this.passwordError.set('Use at least 6 characters.');
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
