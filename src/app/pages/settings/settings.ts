import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../core/state.service';
import { AppState, CURRENCIES, Currency } from '../../core/models';
import { ThemePreference, ThemeService } from '../../core/theme.service';
import { CloudAuthService } from '../../core/cloud-auth.service';
import {
  SpwFormatService,
  UnlockCredential,
  WrongCredentialError,
  formatRecoveryKey,
} from '../../core/spw-format.service';
import { FileHandlerService, UserCancelledError } from '../../core/file-handler.service';
import { BUILD_INFO } from '../../core/build-info';
import { formatRelativeTime } from '../../core/format.util';
import { IconComponent } from '../../shared/icon';
import { ModalComponent } from '../../shared/modal';

type ImportCredentialKind = 'password' | 'recovery';
type ExportProtection = 'none' | 'password';

interface PendingImport {
  name: string;
  bytes: Uint8Array;
}

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

  // ----- Import Legacy File (.spw) ----------------------------------------
  readonly importBusy = signal(false);
  readonly importError = signal<string | null>(null);
  readonly importSuccess = signal<string | null>(null);
  readonly pendingImport = signal<PendingImport | null>(null);
  readonly importCredentialKind = signal<ImportCredentialKind>('password');
  readonly importCredentialValue = signal('');

  // ----- Export Backup (.spw) ----------------------------------------------
  readonly exportProtection = signal<ExportProtection>('none');
  readonly exportPassword = signal('');
  readonly exportPasswordConfirm = signal('');
  readonly exportBusy = signal(false);
  readonly exportError = signal<string | null>(null);
  /** Set right after a password-protected export succeeds so the "save
   * this now, it's shown only once" modal can display it - `encodeSpw3New`
   * generates a brand-new recovery key every time and never stores it, so
   * this is the one and only chance to show it to the user. */
  readonly exportRecoveryKey = signal<string | null>(null);
  readonly exportRecoveryKeyCopied = signal(false);

  // ----- Reset Account Data ------------------------------------------------
  readonly resetError = signal<string | null>(null);
  readonly resetSuccess = signal<string | null>(null);

  // ----- About --------------------------------------------------------------
  /** Regenerated on every `npm run build` (see `scripts/gen-build-info.js`)
   * - the whole point is answering "am I actually on the latest version"
   * without needing to remember to bump anything by hand. Computed once at
   * component construction rather than as a live-ticking clock: the
   * relative label is only meant to be glanced at, not second-accurate. */
  readonly buildVersion = BUILD_INFO.version;
  readonly buildTime = new Date(BUILD_INFO.builtAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  readonly buildAgo = formatRelativeTime(BUILD_INFO.builtAt);

  constructor(
    readonly state: StateService,
    readonly theme: ThemeService,
    readonly cloudAuth: CloudAuthService,
    private readonly spwFormat: SpwFormatService,
    private readonly fileHandler: FileHandlerService,
  ) {}

  setCurrency(currency: Currency): void {
    this.state.setCurrency(currency);
  }

  setTheme(pref: ThemePreference): void {
    this.theme.setPreference(pref);
  }

  // ----- Import Legacy File -----------------------------------------------

  async startImport(): Promise<void> {
    this.importError.set(null);
    this.importSuccess.set(null);
    let opened: { name: string; bytes: Uint8Array };
    try {
      opened = await this.fileHandler.pickAndOpen();
    } catch (err) {
      if (err instanceof UserCancelledError) return;
      this.importError.set(err instanceof Error ? err.message : 'Could not open that file.');
      return;
    }

    if (this.spwFormat.needsCredential(opened.bytes)) {
      this.importCredentialValue.set('');
      this.importCredentialKind.set('password');
      this.pendingImport.set(opened);
      return;
    }

    try {
      const decoded = await this.spwFormat.decode(opened.bytes);
      await this.applyImport(decoded.state);
    } catch (err) {
      this.importError.set(
        err instanceof Error ? err.message : 'That file could not be read as a SparrowFi file.',
      );
    }
  }

  cancelImportUnlock(): void {
    this.pendingImport.set(null);
    this.importCredentialValue.set('');
  }

  async submitImportCredential(): Promise<void> {
    const pending = this.pendingImport();
    const value = this.importCredentialValue().trim();
    if (!pending || !value) return;
    this.importBusy.set(true);
    this.importError.set(null);
    try {
      const credential: UnlockCredential = { kind: this.importCredentialKind(), value };
      const decoded = await this.spwFormat.decode(pending.bytes, credential);
      this.pendingImport.set(null);
      this.importCredentialValue.set('');
      await this.applyImport(decoded.state);
    } catch (err) {
      if (err instanceof WrongCredentialError) {
        this.importError.set(err.message);
      } else {
        this.importError.set(err instanceof Error ? err.message : 'Could not read that file.');
      }
    } finally {
      this.importBusy.set(false);
    }
  }

  // ----- Export Backup (.spw) -----------------------------------------------

  setExportProtection(protection: ExportProtection): void {
    this.exportProtection.set(protection);
    this.exportError.set(null);
  }

  async exportBackup(): Promise<void> {
    const s = this.state.state();
    if (!s) return;
    this.exportError.set(null);

    if (this.exportProtection() === 'none') {
      this.downloadSpwFile(this.spwFormat.encodeSpw2(s));
      return;
    }

    const password = this.exportPassword();
    if (!password) {
      this.exportError.set('Enter a password to protect this backup.');
      return;
    }
    if (password !== this.exportPasswordConfirm()) {
      this.exportError.set('Passwords do not match.');
      return;
    }

    this.exportBusy.set(true);
    try {
      const { bytes, recoveryKey } = await this.spwFormat.encodeSpw3New(s, password);
      this.downloadSpwFile(bytes);
      this.exportPassword.set('');
      this.exportPasswordConfirm.set('');
      // Shown once, right now - `encodeSpw3New` never stores this key
      // anywhere, so this modal is the user's only chance to save it.
      this.exportRecoveryKey.set(recoveryKey);
    } catch (err) {
      this.exportError.set(err instanceof Error ? err.message : 'Could not create the backup file.');
    } finally {
      this.exportBusy.set(false);
    }
  }

  closeRecoveryKeyModal(): void {
    this.exportRecoveryKey.set(null);
    this.exportRecoveryKeyCopied.set(false);
  }

  async copyRecoveryKey(): Promise<void> {
    const key = this.exportRecoveryKey();
    if (!key) return;
    try {
      await navigator.clipboard.writeText(formatRecoveryKey(key));
      this.exportRecoveryKeyCopied.set(true);
    } catch {
      // Clipboard access can be denied/unavailable (e.g. insecure context)
      // - the key is still fully visible on screen to copy by hand.
    }
  }

  formatRecoveryKey(raw: string): string {
    return formatRecoveryKey(raw);
  }

  private downloadSpwFile(bytes: Uint8Array): void {
    // `Blob`'s DOM typings want an `ArrayBuffer`-backed view specifically,
    // while `Uint8Array` is typed generically over `ArrayBufferLike` - copy
    // into a plain, unambiguously `ArrayBuffer`-backed array to satisfy it.
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SparrowFi-Backup-${new Date().toISOString().slice(0, 10)}.spw`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ----- Reset Account Data ------------------------------------------------

  async resetData(): Promise<void> {
    this.resetError.set(null);
    this.resetSuccess.set(null);
    const ok = confirm(
      'This permanently deletes everything in your account - banks, wallets, cards, ' +
        'transactions, fixed deposits, categories - and cannot be undone; there is no ' +
        'recovery key. Continue?',
    );
    if (!ok) return;
    try {
      await this.state.resetData();
      this.resetSuccess.set('Your account data has been reset.');
    } catch (err) {
      this.resetError.set(err instanceof Error ? err.message : 'Could not reset your data.');
    }
  }

  private async applyImport(imported: AppState): Promise<void> {
    const current = this.state.state();
    const hasExistingData =
      !!current &&
      (current.banks.length > 0 ||
        current.wallets.length > 0 ||
        current.cards.length > 0 ||
        current.transactions.length > 0 ||
        current.fixedDeposits.length > 0);
    if (hasExistingData) {
      const ok = confirm(
        'Importing will replace all data currently in your account. This cannot be undone. Continue?',
      );
      if (!ok) return;
    }

    this.importBusy.set(true);
    this.importError.set(null);
    try {
      this.state.replaceState(imported);
      await this.state.save();
      this.importSuccess.set('Imported and saved to your account.');
    } catch (err) {
      this.importError.set(
        err instanceof Error
          ? `Imported, but saving to your account failed: ${err.message}`
          : 'Imported, but saving to your account failed.',
      );
    } finally {
      this.importBusy.set(false);
    }
  }
}
