import { Injectable, computed, signal } from '@angular/core';
import { CloudAuthService } from './cloud-auth.service';
import { StateService } from './state.service';
import { base64ToBytes, bytesToBase64 } from './crypto.util';

export interface CloudBackupSummary {
  filename: string;
  sizeBytes: number;
  updatedAt: string;
}

interface BackupListRow {
  filename: string;
  size_bytes: number;
  updated_at: string;
}

/**
 * Manual cloud backup/restore for the currently open `.spw` file, via the
 * `backup_upsert` / `backup_list` / `backup_restore` functions in
 * `supabase/schema.sql` - there is no direct table access (see that file
 * for why), so every call here goes through one of those instead of
 * `.from('spw_backups')`. Each call re-sends the signed-in username +
 * password (from `CloudAuthService.credentials()`) so the database can
 * re-verify them itself before touching any row.
 *
 * The `data` column is nothing but the same SPW3-encrypted bytes
 * `StateService` would otherwise write to local disk - this service never
 * encrypts or decrypts anything itself, it only moves already-encrypted
 * bytes to and from the database.
 */
@Injectable({ providedIn: 'root' })
export class CloudBackupService {
  private readonly _busy = signal(false);
  private readonly _lastBackupAt = signal<string | null>(null);

  readonly busy = this._busy.asReadonly();
  readonly lastBackupAt = this._lastBackupAt.asReadonly();

  constructor(
    private readonly auth: CloudAuthService,
    private readonly state: StateService,
  ) {}

  /** Whether "Backup Now" can be used right now: signed in, a file is
   * open, and that file already has password protection turned on. */
  readonly canBackup = computed(
    () => this.auth.user() !== null && this.state.isPasswordProtected(),
  );

  async backupNow(): Promise<void> {
    const { username, password } = this.auth.credentials();
    const bytes = await this.state.exportEncryptedBytes();
    const filename = this.state.fileName();

    this._busy.set(true);
    try {
      const client = await this.auth.getClient();
      const { error } = await client.rpc('backup_upsert', {
        p_username: username,
        p_password: password,
        p_filename: filename,
        p_data: bytesToBase64(bytes),
        p_size: bytes.length,
      });
      if (error) throw new Error(error.message);
      this._lastBackupAt.set(new Date().toISOString());
    } finally {
      this._busy.set(false);
    }
  }

  async listBackups(): Promise<CloudBackupSummary[]> {
    if (!this.auth.user()) return [];
    const { username, password } = this.auth.credentials();
    const client = await this.auth.getClient();
    const { data, error } = await client.rpc('backup_list', {
      p_username: username,
      p_password: password,
    });
    if (error) throw new Error(error.message);
    return ((data as BackupListRow[] | null) ?? []).map((row) => ({
      filename: row.filename,
      sizeBytes: row.size_bytes,
      updatedAt: row.updated_at,
    }));
  }

  /** Downloads one backup and stages it for unlocking through the exact
   * same password/recovery-key modal used for local SPW3 files - this
   * service never sees or asks for the file password itself beyond what
   * it already needed to sign in. */
  async restore(filename: string): Promise<void> {
    const { username, password } = this.auth.credentials();
    const client = await this.auth.getClient();
    const { data, error } = await client.rpc('backup_restore', {
      p_username: username,
      p_password: password,
      p_filename: filename,
    });
    if (error) throw new Error(error.message);
    const bytes = base64ToBytes(data as string);
    await this.state.openFromBytes(filename, bytes);
  }
}
