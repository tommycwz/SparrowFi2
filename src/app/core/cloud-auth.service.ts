import { Injectable, signal } from '@angular/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_CONFIGURED, SUPABASE_URL } from './supabase.config';

export interface CloudUser {
  username: string;
}

const USERNAME_PATTERN = /^[a-z0-9_.-]+$/i;

/**
 * Thin wrapper around a handful of Postgres functions (see
 * `supabase/schema.sql`) that implement a small, self-contained username +
 * password login. This does NOT use Supabase Auth - no email address, no
 * confirmation links, none of that. Supabase Auth's own email sending
 * turned out to be a dead end for this app: it refuses fake/synthetic
 * domains outright, and even with a real address its shared email service
 * has a very low send-rate limit that testing kept tripping. A plain
 * username/password table checked by a database function sidesteps both
 * problems entirely, and it's what was asked for.
 *
 * There's no session token here. "Signed in" just means this service is
 * holding a username + password in memory that `account_login` has
 * already verified once; every backup/restore call re-sends both so the
 * database re-checks them itself each time (see `credentials()`) rather
 * than trusting a client-side flag. Nothing is written to disk or
 * localStorage, so signing in is a per-app-load thing - same as unlocking
 * a password-protected file locally, which is exactly the password this
 * reuses.
 *
 * `@supabase/supabase-js` is loaded via a dynamic `import()` the first
 * time `getClient()` runs (i.e. the first time someone opens the Cloud
 * Backup UI), not at app startup, so every other page never downloads it
 * and never makes a network request. `SupabaseClient` above is a
 * type-only import and is erased at build time.
 */
@Injectable({ providedIn: 'root' })
export class CloudAuthService {
  readonly configured = SUPABASE_CONFIGURED;

  /** Always true - kept only so the shared auth panel (written when a
   * real async session check happened at startup) doesn't need to change
   * its gating logic. */
  readonly ready = signal(true).asReadonly();

  private clientPromise: Promise<SupabaseClient> | null = null;
  private readonly _user = signal<CloudUser | null>(null);
  private password = '';

  readonly user = this._user.asReadonly();

  /** Loads `@supabase/supabase-js` (first call only) and creates the
   * client used to call the RPC functions. Safe to call repeatedly - later
   * calls reuse the same in-flight/completed promise. */
  async getClient(): Promise<SupabaseClient> {
    if (!this.configured) {
      throw new Error('Cloud Backup is not set up yet.');
    }
    if (!this.clientPromise) {
      this.clientPromise = this.initClient();
    }
    return this.clientPromise;
  }

  /** Fire-and-forget variant for UI that just wants to trigger the lazy
   * library load on first render, without awaiting or surfacing a
   * "not configured" error as a crash. */
  ensureInitialized(): void {
    if (this.configured) this.getClient().catch(() => {});
  }

  private async initClient(): Promise<SupabaseClient> {
    const { createClient } = await import('@supabase/supabase-js');
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  async signUp(username: string, password: string): Promise<void> {
    const name = this.normalizeUsername(username);
    this.checkPassword(password);
    const client = await this.getClient();
    const { error } = await client.rpc('account_create', {
      p_username: name,
      p_password: password,
    });
    if (error) throw new Error(this.friendlyError(error.message));
    this._user.set({ username: name });
    this.password = password;
  }

  async signIn(username: string, password: string): Promise<void> {
    const name = this.normalizeUsername(username);
    const client = await this.getClient();
    const { error } = await client.rpc('account_login', {
      p_username: name,
      p_password: password,
    });
    if (error) throw new Error(this.friendlyError(error.message));
    this._user.set({ username: name });
    this.password = password;
  }

  signOut(): void {
    this._user.set(null);
    this.password = '';
  }

  /** The username/password pair to send with a backup RPC call.
   * `CloudBackupService` uses this instead of reaching into private
   * state directly. Throws if not signed in. */
  credentials(): { username: string; password: string } {
    const user = this._user();
    if (!user) throw new Error('Sign in first.');
    return { username: user.username, password: this.password };
  }

  private normalizeUsername(username: string): string {
    const name = username.trim().toLowerCase();
    if (name.length < 3 || !USERNAME_PATTERN.test(name)) {
      throw new Error('Username must be at least 3 characters: letters, numbers, . _ - only.');
    }
    return name;
  }

  private checkPassword(password: string): void {
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }
  }

  private friendlyError(message: string): string {
    if (/wrong username or password/i.test(message)) return 'Wrong username or password.';
    if (/already taken/i.test(message)) return 'That username is already taken.';
    return message;
  }
}
