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
} from '../../core/spw-format.service';
import { FileHandlerService, UserCancelledError } from '../../core/file-handler.service';
import { IconComponent } from '../../shared/icon';
import { ModalComponent } from '../../shared/modal';

type ImportCredentialKind = 'password' | 'recovery';

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

  // ----- Reset Account Data ------------------------------------------------
  readonly resetError = signal<string | null>(null);
  readonly resetSuccess = signal<string | null>(null);

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
