import { Injectable } from '@angular/core';
import { CloudAuthService } from './cloud-auth.service';
import { AppState } from './models';
import { migrateState } from './migrate-state.util';
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  base64ToBytes,
  bytesToBase64,
  deriveAesGcmKey,
  randomBytes,
} from './crypto.util';

const SALT_LEN = 16;
const IV_LEN = 12;

interface UserDataRow {
  salt: string;
  iv: string;
  data: string;
}

/**
 * Loads and saves the signed-in account's ONE finance record directly
 * to/from Supabase (`data_load`/`data_save` in `supabase/schema.sql`) -
 * there is no local file anymore. The record is always encrypted in the
 * browser with a key derived (PBKDF2-SHA256, then AES-256-GCM) from the
 * account password before it ever leaves the browser, using a fresh
 * random salt and IV on every save - so Supabase only ever stores
 * ciphertext, never a plaintext balance or transaction. The same password
 * that signs you in is the only thing that can decrypt this; there is no
 * separate recovery mechanism, so losing it means losing access to this
 * data (a legacy `.spw` file's password/recovery key are unrelated to
 * this - see the Import Legacy File flow in Settings).
 */
@Injectable({ providedIn: 'root' })
export class CloudDataService {
  constructor(private readonly auth: CloudAuthService) {}

  /** Loads and decrypts the signed-in account's data. Returns `null` for a
   * brand-new account that has never saved anything yet. */
  async load(): Promise<AppState | null> {
    const { username, password } = this.auth.credentials();
    const client = await this.auth.getClient();
    const { data, error } = await client.rpc('data_load', {
      p_username: username,
      p_password: password,
    });
    if (error) throw new Error(error.message);
    const row = (data as UserDataRow[] | null)?.[0];
    if (!row) return null;

    const salt = base64ToBytes(row.salt);
    const iv = base64ToBytes(row.iv);
    const key = await deriveAesGcmKey(password, salt);
    let plaintext: Uint8Array;
    try {
      plaintext = await aesGcmDecrypt(key, iv, base64ToBytes(row.data));
    } catch {
      throw new Error('Could not decrypt your data - the saved record may be corrupted.');
    }
    const json = new TextDecoder().decode(plaintext);
    return migrateState(JSON.parse(json));
  }

  /** Encrypts and saves the given state as the signed-in account's one
   * record, replacing whatever was there before. */
  async save(state: AppState): Promise<void> {
    const { username, password } = this.auth.credentials();
    const salt = randomBytes(SALT_LEN);
    const iv = randomBytes(IV_LEN);
    const key = await deriveAesGcmKey(password, salt);
    const json = JSON.stringify(state);
    const ciphertext = await aesGcmEncrypt(key, iv, new TextEncoder().encode(json));

    const client = await this.auth.getClient();
    const { error } = await client.rpc('data_save', {
      p_username: username,
      p_password: password,
      p_salt: bytesToBase64(salt),
      p_iv: bytesToBase64(iv),
      p_data: bytesToBase64(ciphertext),
    });
    if (error) throw new Error(error.message);
  }

  /** Deletes the signed-in account's saved record from Supabase entirely -
   * the account (username/password) itself is untouched, only its data
   * row. There's no undo and no recovery key, so callers must get the
   * user's explicit confirmation before calling this. */
  async reset(): Promise<void> {
    const { username, password } = this.auth.credentials();
    const client = await this.auth.getClient();
    const { error } = await client.rpc('data_reset', {
      p_username: username,
      p_password: password,
    });
    if (error) throw new Error(error.message);
  }
}
