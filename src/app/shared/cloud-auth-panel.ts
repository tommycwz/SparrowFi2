import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CloudAuthService } from '../core/cloud-auth.service';
import { IconComponent } from './icon';

type Mode = 'sign-in' | 'sign-up';

/**
 * Sign in / sign up / signed-in-as display for Cloud Backup, shared
 * between the Settings page (backup) and the Launcher page (restore) so
 * both talk to the same `CloudAuthService` session through one UI. Renders
 * a "not set up yet" note instead of a form when the Supabase project
 * hasn't been configured (see `supabase.config.ts`).
 */
@Component({
  selector: 'sf-cloud-auth-panel',
  standalone: true,
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!auth.configured) {
      <div class="banner banner-info">
        <sf-icon name="info" [size]="16" />
        <span>Cloud Backup isn't set up yet.</span>
      </div>
    } @else if (!auth.ready()) {
      <p class="muted">Checking sign-in status…</p>
    } @else if (auth.user(); as user) {
      <div class="signed-in-row">
        <sf-icon name="cloud" [size]="18" />
        <span>Signed in as <strong>{{ user.username }}</strong></span>
        <button type="button" class="btn-link" (click)="signOut()" [disabled]="busy()">
          <sf-icon name="log-out" [size]="14" /> Sign out
        </button>
      </div>
    } @else {
      <div class="segmented">
        <button type="button" [class.active]="mode() === 'sign-in'" (click)="setMode('sign-in')">
          Sign In
        </button>
        <button type="button" [class.active]="mode() === 'sign-up'" (click)="setMode('sign-up')">
          Sign Up
        </button>
      </div>

      <div class="field-row" style="margin-top: 0.75rem">
        <label>
          Username
          <input
            type="text"
            [ngModel]="username()"
            (ngModelChange)="username.set($event)"
            (keydown.enter)="submit()"
            autocomplete="username"
            placeholder="Pick a username"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            [ngModel]="password()"
            (ngModelChange)="password.set($event)"
            (keydown.enter)="submit()"
            [autocomplete]="mode() === 'sign-up' ? 'new-password' : 'current-password'"
            placeholder="Same password that protects this file"
          />
        </label>
      </div>
      <p class="muted hint">
        Use the same password you use to protect your .spw file - no need for a second one. No
        email required; this account only exists to keep your backups apart from anyone else's.
      </p>

      @if (error()) {
        <div class="banner banner-danger">
          <sf-icon name="alert-triangle" [size]="16" />
          <span>{{ error() }}</span>
        </div>
      }

      @if (info()) {
        <div class="banner banner-info">
          <sf-icon name="info" [size]="16" />
          <span>{{ info() }}</span>
        </div>
      }

      <button
        type="button"
        class="btn btn-primary btn-block"
        (click)="submit()"
        [disabled]="busy() || !username().trim() || !password()"
      >
        {{ busy() ? 'Please wait…' : mode() === 'sign-in' ? 'Sign In' : 'Create Account' }}
      </button>
    }
  `,
  styles: `
    .signed-in-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.9rem;
    }

    .signed-in-row strong {
      font-weight: 700;
    }

    .btn-link {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      margin-left: auto;
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 600;
      padding: 0.2rem 0.4rem;
    }

    .btn-link:hover:not(:disabled) {
      color: var(--danger);
    }

    .segmented {
      display: flex;
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
    }

    .segmented button {
      flex: 1;
      padding: 0.5rem;
      background: var(--surface-2);
      border: none;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.85rem;
      color: var(--text-muted);
    }

    .segmented button.active {
      background: var(--accent);
      color: var(--accent-contrast);
    }

    .hint {
      font-size: 0.78rem;
      margin-top: 0.4rem;
    }
  `,
})
export class CloudAuthPanelComponent {
  readonly mode = signal<Mode>('sign-in');
  readonly username = signal('');
  readonly password = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly info = signal<string | null>(null);

  constructor(readonly auth: CloudAuthService) {
    // Kicks off the (dynamically-imported) Supabase client the first time
    // this panel is actually rendered, rather than at app startup - see
    // CloudAuthService for why.
    auth.ensureInitialized();
  }

  setMode(mode: Mode): void {
    this.mode.set(mode);
    this.error.set(null);
    this.info.set(null);
  }

  async submit(): Promise<void> {
    const username = this.username().trim();
    const password = this.password();
    if (!username || !password) return;
    this.busy.set(true);
    this.error.set(null);
    this.info.set(null);
    try {
      if (this.mode() === 'sign-in') {
        await this.auth.signIn(username, password);
      } else {
        await this.auth.signUp(username, password);
        this.info.set('Account created and signed in.');
      }
      this.password.set('');
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      this.busy.set(false);
    }
  }

  signOut(): void {
    this.auth.signOut();
    this.username.set('');
    this.password.set('');
  }
}
