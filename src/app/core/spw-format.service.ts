import { Injectable } from '@angular/core';
import { AppState } from './models';
import { migrateState } from './migrate-state.util';
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  deriveAesGcmKey,
  formatRecoveryKey,
  generateRecoveryKey,
  importAesGcmRawKey,
  normalizeRecoveryKey,
  randomBytes,
} from './crypto.util';

export type SpwVersion = 'SPW1' | 'SPW2' | 'SPW3';

/** In-memory-only crypto context for an unlocked SPW3 file. Holding this
 * lets a later "Save" re-encrypt without re-prompting for the password,
 * while keeping the unchanged header sections byte-identical rather than
 * re-deriving them. Never persisted, never logged. */
export interface Spw3Crypto {
  masterKey: Uint8Array;
  passwordSalt: Uint8Array;
  passwordIv: Uint8Array;
  wrappedPasswordKey: Uint8Array;
  recoverySalt: Uint8Array;
  recoveryIv: Uint8Array;
  wrappedRecoveryKey: Uint8Array;
}

export interface DecodedSpw {
  state: AppState;
  version: SpwVersion;
  crypto: Spw3Crypto | null;
}

export type UnlockCredential = { kind: 'password' | 'recovery'; value: string };

export class WrongCredentialError extends Error {
  constructor() {
    super('The password or recovery key is incorrect.');
    this.name = 'WrongCredentialError';
  }
}

export class UnsupportedFormatError extends Error {
  constructor() {
    super('This file is not a recognized .spw file.');
    this.name = 'UnsupportedFormatError';
  }
}

const XOR_KEY = 0x53;

// SPW3 fixed header layout (see Sparrow.md).
const OFF_MAGIC = 0;
const OFF_PASSWORD_SALT = 4;
const OFF_PASSWORD_IV = 20;
const OFF_RECOVERY_SALT = 32;
const OFF_RECOVERY_IV = 48;
const OFF_WRAPPED_PASSWORD_KEY = 60;
const OFF_WRAPPED_RECOVERY_KEY = 108;
const OFF_DATA_IV = 156;
const HEADER_LEN = 168;

const LEN_SALT = 16;
const LEN_IV = 12;
const LEN_WRAPPED_KEY = 48; // 32-byte key + 16-byte GCM tag
const LEN_MASTER_KEY = 32;

@Injectable({ providedIn: 'root' })
export class SpwFormatService {
  /** Reads the 4-byte magic header without touching the rest of the file. */
  detectVersion(bytes: Uint8Array): SpwVersion | null {
    if (bytes.length < 4) return null;
    const magic = new TextDecoder().decode(bytes.subarray(0, 4));
    if (magic === 'SPW1' || magic === 'SPW2' || magic === 'SPW3') {
      return magic;
    }
    return null;
  }

  needsCredential(bytes: Uint8Array): boolean {
    return this.detectVersion(bytes) === 'SPW3';
  }

  async decode(bytes: Uint8Array, credential?: UnlockCredential): Promise<DecodedSpw> {
    const version = this.detectVersion(bytes);
    if (!version) {
      throw new UnsupportedFormatError();
    }

    if (version === 'SPW1') {
      const json = new TextDecoder().decode(bytes.subarray(4));
      return { state: migrateState(JSON.parse(json)), version, crypto: null };
    }

    if (version === 'SPW2') {
      const payload = bytes.subarray(4);
      const decoded = new Uint8Array(payload.length);
      for (let i = 0; i < payload.length; i++) {
        decoded[i] = payload[i] ^ XOR_KEY;
      }
      const json = new TextDecoder().decode(decoded);
      return { state: migrateState(JSON.parse(json)), version, crypto: null };
    }

    // SPW3
    if (!credential) {
      throw new Error('SPW3 files require a password or recovery key to decode.');
    }
    if (bytes.length < HEADER_LEN) {
      throw new UnsupportedFormatError();
    }

    const passwordSalt = bytes.slice(OFF_PASSWORD_SALT, OFF_PASSWORD_SALT + LEN_SALT);
    const passwordIv = bytes.slice(OFF_PASSWORD_IV, OFF_PASSWORD_IV + LEN_IV);
    const recoverySalt = bytes.slice(OFF_RECOVERY_SALT, OFF_RECOVERY_SALT + LEN_SALT);
    const recoveryIv = bytes.slice(OFF_RECOVERY_IV, OFF_RECOVERY_IV + LEN_IV);
    const wrappedPasswordKey = bytes.slice(
      OFF_WRAPPED_PASSWORD_KEY,
      OFF_WRAPPED_PASSWORD_KEY + LEN_WRAPPED_KEY,
    );
    const wrappedRecoveryKey = bytes.slice(
      OFF_WRAPPED_RECOVERY_KEY,
      OFF_WRAPPED_RECOVERY_KEY + LEN_WRAPPED_KEY,
    );
    const dataIv = bytes.slice(OFF_DATA_IV, OFF_DATA_IV + LEN_IV);
    const payload = bytes.slice(HEADER_LEN);

    const salt = credential.kind === 'password' ? passwordSalt : recoverySalt;
    const iv = credential.kind === 'password' ? passwordIv : recoveryIv;
    const wrapped = credential.kind === 'password' ? wrappedPasswordKey : wrappedRecoveryKey;
    const secret =
      credential.kind === 'password' ? credential.value : normalizeRecoveryKey(credential.value);

    let masterKey: Uint8Array;
    try {
      const wrappingKey = await deriveAesGcmKey(secret, salt);
      masterKey = await aesGcmDecrypt(wrappingKey, iv, wrapped);
      if (masterKey.length !== LEN_MASTER_KEY) {
        throw new Error('unexpected master key length');
      }
    } catch {
      throw new WrongCredentialError();
    }

    let plaintext: Uint8Array;
    try {
      const dataKey = await importAesGcmRawKey(masterKey);
      plaintext = await aesGcmDecrypt(dataKey, dataIv, payload);
    } catch {
      // Master key unwrapped fine but the payload didn't decrypt - treat as
      // corruption rather than a wrong-credential (the credential check
      // above already authenticated the master key).
      throw new UnsupportedFormatError();
    }

    const json = new TextDecoder().decode(plaintext);
    const crypto: Spw3Crypto = {
      masterKey,
      passwordSalt,
      passwordIv,
      wrappedPasswordKey,
      recoverySalt,
      recoveryIv,
      wrappedRecoveryKey,
    };
    return { state: migrateState(JSON.parse(json)), version, crypto };
  }

  /** Encodes to the unencrypted, obfuscated SPW2 format. */
  encodeSpw2(state: AppState): Uint8Array {
    const json = JSON.stringify(state);
    const jsonBytes = new TextEncoder().encode(json);
    const out = new Uint8Array(4 + jsonBytes.length);
    out.set(new TextEncoder().encode('SPW2'), 0);
    for (let i = 0; i < jsonBytes.length; i++) {
      out[4 + i] = jsonBytes[i] ^ XOR_KEY;
    }
    return out;
  }

  /** Creates a brand-new SPW3 file: fresh master key, fresh password wrap,
   * and a freshly generated recovery key (returned once, in the clear, for
   * the caller to display - it is never stored anywhere). */
  async encodeSpw3New(
    state: AppState,
    password: string,
  ): Promise<{ bytes: Uint8Array; recoveryKey: string; crypto: Spw3Crypto }> {
    const masterKey = randomBytes(LEN_MASTER_KEY);
    const recoveryKeyRaw = generateRecoveryKey();
    const crypto = await this.wrapMasterKey(masterKey, password, recoveryKeyRaw);
    const bytes = await this.assemble(state, crypto);
    return { bytes, recoveryKey: recoveryKeyRaw, crypto };
  }

  /** Re-saves an already-unlocked SPW3 file: reuses the same master key and
   * the same password/recovery wrapping bytes untouched, only re-encrypting
   * the (changed) JSON payload under a fresh IV. No password re-entry
   * needed for the common "just save my edits" case. */
  async encodeSpw3Resave(state: AppState, crypto: Spw3Crypto): Promise<{ bytes: Uint8Array }> {
    const bytes = await this.assemble(state, crypto);
    return { bytes };
  }

  /** Changes the password while keeping the same master key and recovery
   * key valid (only the password-wrap section is regenerated). */
  async encodeSpw3ChangePassword(
    state: AppState,
    crypto: Spw3Crypto,
    newPassword: string,
  ): Promise<{ bytes: Uint8Array; crypto: Spw3Crypto }> {
    const passwordSalt = randomBytes(LEN_SALT);
    const passwordIv = randomBytes(LEN_IV);
    const passwordKey = await deriveAesGcmKey(newPassword, passwordSalt);
    const wrappedPasswordKey = await aesGcmEncrypt(passwordKey, passwordIv, crypto.masterKey);
    const nextCrypto: Spw3Crypto = {
      ...crypto,
      passwordSalt,
      passwordIv,
      wrappedPasswordKey,
    };
    const bytes = await this.assemble(state, nextCrypto);
    return { bytes, crypto: nextCrypto };
  }

  /** Generates a brand-new recovery key, invalidating the previous one.
   * The master key and password wrap are left untouched. */
  async encodeSpw3RegenerateRecovery(
    state: AppState,
    crypto: Spw3Crypto,
  ): Promise<{ bytes: Uint8Array; recoveryKey: string; crypto: Spw3Crypto }> {
    const recoverySalt = randomBytes(LEN_SALT);
    const recoveryIv = randomBytes(LEN_IV);
    const recoveryKeyRaw = generateRecoveryKey();
    const recoveryWrapKey = await deriveAesGcmKey(recoveryKeyRaw, recoverySalt);
    const wrappedRecoveryKey = await aesGcmEncrypt(recoveryWrapKey, recoveryIv, crypto.masterKey);
    const nextCrypto: Spw3Crypto = {
      ...crypto,
      recoverySalt,
      recoveryIv,
      wrappedRecoveryKey,
    };
    const bytes = await this.assemble(state, nextCrypto);
    return { bytes, recoveryKey: recoveryKeyRaw, crypto: nextCrypto };
  }

  private async wrapMasterKey(
    masterKey: Uint8Array,
    password: string,
    recoveryKeyRaw: string,
  ): Promise<Spw3Crypto> {
    const passwordSalt = randomBytes(LEN_SALT);
    const passwordIv = randomBytes(LEN_IV);
    const passwordKey = await deriveAesGcmKey(password, passwordSalt);
    const wrappedPasswordKey = await aesGcmEncrypt(passwordKey, passwordIv, masterKey);

    const recoverySalt = randomBytes(LEN_SALT);
    const recoveryIv = randomBytes(LEN_IV);
    const recoveryKey = await deriveAesGcmKey(recoveryKeyRaw, recoverySalt);
    const wrappedRecoveryKey = await aesGcmEncrypt(recoveryKey, recoveryIv, masterKey);

    return {
      masterKey,
      passwordSalt,
      passwordIv,
      wrappedPasswordKey,
      recoverySalt,
      recoveryIv,
      wrappedRecoveryKey,
    };
  }

  private async assemble(state: AppState, crypto: Spw3Crypto): Promise<Uint8Array> {
    const dataIv = randomBytes(LEN_IV);
    const dataKey = await importAesGcmRawKey(crypto.masterKey);
    const json = JSON.stringify(state);
    const payload = await aesGcmEncrypt(dataKey, dataIv, new TextEncoder().encode(json));

    const out = new Uint8Array(HEADER_LEN + payload.length);
    out.set(new TextEncoder().encode('SPW3'), OFF_MAGIC);
    out.set(crypto.passwordSalt, OFF_PASSWORD_SALT);
    out.set(crypto.passwordIv, OFF_PASSWORD_IV);
    out.set(crypto.recoverySalt, OFF_RECOVERY_SALT);
    out.set(crypto.recoveryIv, OFF_RECOVERY_IV);
    out.set(crypto.wrappedPasswordKey, OFF_WRAPPED_PASSWORD_KEY);
    out.set(crypto.wrappedRecoveryKey, OFF_WRAPPED_RECOVERY_KEY);
    out.set(dataIv, OFF_DATA_IV);
    out.set(payload, HEADER_LEN);
    return out;
  }
}

export { formatRecoveryKey, normalizeRecoveryKey };
