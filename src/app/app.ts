import { ChangeDetectionStrategy, Component, HostListener, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { StateService } from './core/state.service';
import { CloudAuthService } from './core/cloud-auth.service';
import { UpdateService } from './core/update.service';
import { BUILD_INFO } from './core/build-info';
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
  /** Shown small/muted in the sidebar footer so "am I on the latest build"
   * is answerable at a glance - see Settings' About section for the full
   * build time, and `BUILD_INFO`/`scripts/gen-build-info.js` for how this
   * is generated. */
  readonly buildVersion = BUILD_INFO.version;
  readonly mobileNavOpen = signal(false);
  readonly toast = signal<{ text: string; tone: 'success' | 'info' | 'danger' } | null>(null);
  /** Locally hides the "new version available" banner after the user
   * dismisses it without refreshing - `updates.updateReady` itself stays
   * true (the download is still there waiting), so reopening the app
   * later still offers it. */
  readonly updateBannerDismissed = signal(false);
  readonly refreshing = signal(false);

  private toastTimer?: ReturnType<typeof setTimeout>;

  constructor(
    readonly state: StateService,
    readonly cloudAuth: CloudAuthService,
    readonly updates: UpdateService,
  ) {}

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.state.dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  /** Closes the mobile nav drawer on any click outside it, without an
   * overlay click-catcher div (a full-screen element in its own stacking
   * context can end up covering the very menu it's meant to sit behind -
   * see the mobile-drawer backdrop, which is purely visual and
   * `pointer-events: none` for the same reason). */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
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

  async save(): Promise<void> {
    try {
      await this.state.save();
      this.showToast('Saved.', 'success');
    } catch (err) {
      this.showToast(err instanceof Error ? err.message : 'Could not save.', 'danger');
    }
  }

  /** Switches to the already-downloaded new version and reloads. Guarded
   * the same way `signOut()` is - reloading discards unsaved changes,
   * since this app has no autosave. */
  async refreshApp(): Promise<void> {
    if (this.state.dirty()) {
      const ok = confirm('You have unsaved changes. Refresh to update anyway?');
      if (!ok) return;
    }
    this.refreshing.set(true);
    try {
      await this.updates.activate();
    } catch {
      this.refreshing.set(false);
      this.showToast('Could not update - try refreshing the page manually.', 'danger');
    }
  }

  dismissUpdateBanner(): void {
    this.updateBannerDismissed.set(true);
  }

  signOut(): void {
    if (this.state.dirty()) {
      const ok = confirm('You have unsaved changes. Sign out anyway?');
      if (!ok) return;
    }
    this.mobileNavOpen.set(false);
    this.state.signOut();
    this.cloudAuth.signOut();
  }

  private showToast(text: string, tone: 'success' | 'info' | 'danger'): void {
    this.toast.set({ text, tone });
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 5000);
  }
}
