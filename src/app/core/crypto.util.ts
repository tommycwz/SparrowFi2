/**
 * Low-level cryptographic helpers. These back two things: `CloudDataService`,
 * which encrypts/decrypts the account's data before it goes to/comes from
 * Supabase, and `SpwFormatService`'s legacy SPW3 (password-protected) file
 * format, kept only for the one-time "Import Legacy File" flow.
 *
 * Everything here runs through the browser's native Web Crypto API
 * (`crypto.subtle`). Nothing in this file ever performs network I/O -
 * keys, salts, IVs and derived material stay in memory only.
 */

const RECOVERY_KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const PBKDF2_ITERATIONS = 100_000;

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

/** Generates an 18-character recovery key (A-Z, 0-9) using rejection
 * sampling against `crypto.getRandomValues` so every character is drawn
 * from a uniform distribution over the 36-symbol alphabet. */
export function generateRecoveryKey(): string {
  const alphabetSize = RECOVERY_KEY_ALPHABET.length; // 36
  const limit = 256 - (256 % alphabetSize); // 252 - rejection threshold
  let raw = '';
  const buf = new Uint8Array(1);
  while (raw.length < 18) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) {
      raw += RECOVERY_KEY_ALPHABET[buf[0] % alphabetSize];
    }
  }
  return raw;
}

/** Formats an 18-char recovery key into `XXXXXX-XXXXXX-XXXXXX` for display. */
export function formatRecoveryKey(raw: string): string {
  return `${raw.slice(0, 6)}-${raw.slice(6, 12)}-${raw.slice(12, 18)}`;
}

/** Strips separators/whitespace and uppercases user-entered recovery keys
 * so `ABC123-DEF456-GHI789`, `abc123 def456 ghi789`, etc. all normalize to
 * the same raw 18-character key used for key derivation. */
export function normalizeRecoveryKey(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Derives a 256-bit AES-GCM key from a password/recovery-key string and a
 * salt using PBKDF2-SHA256 with 100,000 iterations, per the SPW3 spec. */
export async function deriveAesGcmKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const secretBytes = new TextEncoder().encode(secret);
  const baseKey = await crypto.subtle.importKey('raw', secretBytes, 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** AES-256-GCM encrypt. Returns ciphertext with the 16-byte auth tag
 * appended, matching the Web Crypto default and the SPW3 byte layout. */
export async function aesGcmEncrypt(
  key: CryptoKey,
  iv: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const result = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(plaintext),
  );
  return new Uint8Array(result);
}

/** AES-256-GCM decrypt. Throws (auth-tag verification failure) when the
 * key/password is wrong or the data has been tampered with. */
export async function aesGcmDecrypt(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const result = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ciphertext),
  );
  return new Uint8Array(result);
}

export async function importAesGcmRawKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', toArrayBuffer(raw), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

/** Encodes bytes as base64 in chunks, avoiding the call-stack blowup that
 * `String.fromCharCode(...bytes)` hits on large arrays. Used to carry
 * already-encrypted SPW3 file bytes as JSON-safe text (e.g. for cloud
 * backup, which stores this string as-is - it never sees plaintext). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // Guards against passing a Uint8Array backed by a larger/shared buffer.
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
