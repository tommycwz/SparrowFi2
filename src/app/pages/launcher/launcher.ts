import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../core/state.service';
import { IconComponent } from '../../shared/icon';
import { ModalComponent } from '../../shared/modal';

type CredentialKind = 'password' | 'recovery';

@Component({
  selector: 'app-launcher',
  standalone: true,
  imports: [FormsModule, IconComponent, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './launcher.html',
  styleUrl: './launcher.scss',
})
export class LauncherPage {
  readonly credentialKind = signal<CredentialKind>('password');
  readonly credentialValue = signal('');
  readonly newFileName = signal('MyFinance');
  readonly showNewFileModal = signal(false);
  readonly opening = signal(false);
  readonly openError = signal<string | null>(null);

  constructor(readonly state: StateService) {}

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
