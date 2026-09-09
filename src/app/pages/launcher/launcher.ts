import { ChangeDetectionStrategy, Component, computed, effect, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../core/state.service';
import { CloudAuthService } from '../../core/cloud-auth.service';
import { CloudBackupService, CloudBackupSummary } from '../../core/cloud-backup.service';
import { IconComponent } from '../../shared/icon';
import { ModalComponent } from '../../shared/modal';
import { CloudAuthPanelComponent } from '../../shared/cloud-auth-panel';

type CredentialKind = 'password' | 'recovery';

@Component({
  selector: 'app-launcher',
  standalone: true,
  imports: [FormsModule, DatePipe, IconComponent, ModalComponent, CloudAuthPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './launcher.html',
  styleUrl: './launcher.scss',
})
export class LauncherPage {
  readonly credentialKind = signal<CredentialKind>('password');
  readonly credentialValue = signal('');
  readonly newFileName = signal('MyFinance');
  readonly showNewFileModal = signal(false);
  readonly showCloudModal = signal(false);
  readonly opening = signal(false);
  readonly openError = signal<string | null>(null);

  readonly cloudBackups = signal<CloudBackupSummary[]>([]);
  readonly cloudBusy = signal(false);
  readonly cloudError = signal<string | null>(null);
  readonly restoringFilename = signal<string | null>(null);

  readonly signedIn = computed(() => this.cloudAuth.user() !== null);

  constructor(
    readonly state: StateService,
    readonly cloudAuth: CloudAuthService,
    private readonly cloudBackup: CloudBackupService,
  ) {
    effect(() => {
      if (!this.showCloudModal() || !this.signedIn()) return;
      this.refreshCloudBackups();
    });
  }

  openCloudModal(): void {
    this.cloudError.set(null);
    this.showCloudModal.set(true);
  }

  closeCloudModal(): void {
    this.showCloudModal.set(false);
  }

  async refreshCloudBackups(): Promise<void> {
    this.cloudBusy.set(true);
    this.cloudError.set(null);
    try {
      this.cloudBackups.set(await this.cloudBackup.listBackups());
    } catch (err) {
      this.cloudError.set(err instanceof Error ? err.message : 'Could not load backups.');
    } finally {
      this.cloudBusy.set(false);
    }
  }

  async restoreBackup(filename: string): Promise<void> {
    this.restoringFilename.set(filename);
    this.cloudError.set(null);
    try {
      await this.cloudBackup.restore(filename);
      this.showCloudModal.set(false);
    } catch (err) {
      this.cloudError.set(err instanceof Error ? err.message : 'Could not restore that backup.');
    } finally {
      this.restoringFilename.set(null);
    }
  }

  async openFile(): Promise<void> {
    this.openError.set(null);
    this.opening.set(true);
    try {
      await this.state.openFile();
    } catch (err) {
      this.openError.set(err instanceof Error ? err.message : 'Could not open that file.');
    } finally {
      this.opening.set(false);
    }
  }

  createNew(): void {
    const name = this.newFileName().trim() || 'MyFinance';
    this.state.createNew(name);
    this.showNewFileModal.set(false);
  }

  cancelUnlock(): void {
    this.credentialValue.set('');
    this.state.cancelUnlock();
  }

  async submitCredential(): Promise<void> {
    const value = this.credentialValue().trim();
    if (!value) return;
    const ok = await this.state.unlock({ kind: this.credentialKind(), value });
    if (ok) this.credentialValue.set('');
  }
}
