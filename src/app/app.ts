import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { StateService } from './core/state.service';
import { FileHandlerService } from './core/file-handler.service';
import { IconComponent } from './shared/icon';
import { LauncherPage } from './pages/launcher/launcher';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: 'home' },
  { path: '/transactions', label: 'Transactions', icon: 'list' },
  { path: '/accounts', label: 'Accounts', icon: 'wallet' },
  { path: '/categories', label: 'Categories', icon: 'tag' },
  { path: '/fixed-deposits', label: 'Fixed Deposits', icon: 'layers' },
  { path: '/settings', label: 'Settings', icon: 'settings' },
];

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent, LauncherPage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  readonly navItems = NAV_ITEMS;
  readonly showSaveMenu = signal(false);
  readonly mobileNavOpen = signal(false);
  readonly toast = signal<{ text: string; tone: 'success' | 'info' | 'danger' } | null>(null);
  readonly isIOS: boolean;

  readonly primaryLabel = computed(() => {
    if (this.state.canWriteToOriginal()) return 'Save';
    if (this.state.supportsFileSystemAccess) return 'Save As…';
    if (this.state.supportsShareFiles) return 'Save / Share';
    return 'Download';
  });

  readonly primaryIcon = computed(() => {
    if (this.state.canWriteToOriginal()) return 'save';
    if (this.state.supportsFileSystemAccess) return 'save';
    if (this.state.supportsShareFiles) return 'share';
    return 'download';
  });

  private toastTimer?: ReturnType<typeof setTimeout>;

  constructor(
    readonly state: StateService,
    private readonly fileHandler: FileHandlerService,
  ) {
    this.isIOS = fileHandler.isLikelyIOS();
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.state.dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  /** Closes the save-options menu and/or the mobile nav drawer on any click
   * outside them, without an overlay click-catcher div (a full-screen
   * element in its own stacking context can end up covering the very menu
   * it's meant to sit behind - see the mobile-drawer backdrop, which is
   * purely visual and `pointer-events: none` for the same reason). */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (this.showSaveMenu() && !target.closest('.save-group')) {
      this.showSaveMenu.set(false);
    }
    if (this.mobileNavOpen() && !target.closest('.mobile-drawer, .hamburger-btn')) {
      this.mobileNavOpen.set(false);
    }
  }

  toggleMobileNav(): void {
    this.mobileNavOpen.set(!this.mobileNavOpen());
  }

  closeMobileNav(): void {
    this.mobileNavOpen.set(false);
  }

  async runPrimarySave(): Promise<void> {
    if (this.state.canWriteToOriginal()) {
      await this.saveToOriginal();
    } else if (this.state.supportsFileSystemAccess) {
      await this.saveAs();
    } else if (this.state.supportsShareFiles) {
      await this.share();
    } else {
      await this.download();
    }
  }

  async saveToOriginal(): Promise<void> {
    this.showSaveMenu.set(false);
    try {
      await this.state.saveToOriginal();
      this.showToast(`Saved to ${this.state.fileName()}.`, 'success');
    } catch (err) {
      this.showToast(err instanceof Error ? err.message : 'Could not save the file.', 'danger');
    }
  }

  async saveAs(): Promise<void> {
    this.showSaveMenu.set(false);
    const ok = await this.state.saveAs();
    if (ok) this.showToast(`Saved as ${this.state.fileName()}.`, 'success');
  }

  async share(): Promise<void> {
    this.showSaveMenu.set(false);
    const ok = await this.state.shareUpdated();
    if (ok) {
      this.showToast(
        this.isIOS
          ? 'Shared. Choose "Save to Files" and pick the original file to replace it.'
          : 'Shared successfully.',
        'success',
      );
    }
  }

  async download(): Promise<void> {
    this.showSaveMenu.set(false);
    await this.state.downloadUpdated();
    this.showToast(
      this.isIOS
        ? `Downloaded ${this.state.fileName()}. Open the Files app to replace your original file.`
        : `Downloaded ${this.state.fileName()}.`,
      'success',
    );
  }

  closeFile(): void {
    if (this.state.dirty()) {
      const ok = confirm('You have unsaved changes. Close this file anyway?');
      if (!ok) return;
    }
    this.mobileNavOpen.set(false);
    this.state.closeFile();
  }

  private showToast(text: string, tone: 'success' | 'info' | 'danger'): void {
    this.toast.set({ text, tone });
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 5000);
  }
}
