import { Injectable, computed, signal } from '@angular/core';
import {
  AppState,
  Bank,
  Card,
  Category,
  FixedDeposit,
  Transaction,
  Wallet,
  createEmptyState,
} from './models';
import {
  DecodedSpw,
  Spw3Crypto,
  SpwFormatService,
  UnlockCredential,
  WrongCredentialError,
} from './spw-format.service';
import { FileHandlerService, OpenedFile, UserCancelledError } from './file-handler.service';
import { generateId } from './id.util';
import { createDefaultCategories } from './default-categories';

export interface AccountBalance {
  kind: 'bank' | 'wallet' | 'card' | 'bucket';
  id: string;
  name: string;
  color: string;
  balance: number;
}

export type SaveMethod = 'original' | 'save-as' | 'share' | 'download';

export interface PendingUnlock {
  name: string;
  bytes: Uint8Array;
  handle: FileSystemFileHandle | null;
}

const CASH_BUCKET_COLOR = '#14B8A6';
const OTHERS_BUCKET_COLOR = '#94A3B8';

/**
 * Single source of truth for the currently open SparrowFi file: the parsed
 * state, its dirty/loaded status, the crypto context for password-protected
 * files, and the file handle/name used for saving. All mutation methods
 * live here so every screen shares one signal graph. Nothing in this
 * service ever performs network I/O.
 */
@Injectable({ providedIn: 'root' })
export class StateService {
  private readonly _state = signal<AppState | null>(null);
  private readonly _fileName = signal<string>('MyFinance.spw');
  private readonly _fileHandle = signal<FileSystemFileHandle | null>(null);
  private readonly _crypto = signal<Spw3Crypto | null>(null);
  private readonly _dirty = signal(false);
  private readonly _pendingUnlock = signal<PendingUnlock | null>(null);
  private readonly _unlockError = signal<string | null>(null);
  private readonly _busy = signal(false);
  private readonly _lastSaveMethod = signal<SaveMethod | null>(null);

  readonly state = this._state.asReadonly();
  readonly fileName = this._fileName.asReadonly();
  readonly fileHandle = this._fileHandle.asReadonly();
  readonly dirty = this._dirty.asReadonly();
  readonly pendingUnlock = this._pendingUnlock.asReadonly();
  readonly unlockError = this._unlockError.asReadonly();
  readonly busy = this._busy.asReadonly();
  readonly lastSaveMethod = this._lastSaveMethod.asReadonly();

  readonly isLoaded = computed(() => this._state() !== null);
  readonly isPasswordProtected = computed(() => this._state()?.settings.passwordEnabled ?? false);

  readonly supportsFileSystemAccess: boolean;
  readonly supportsShareFiles: boolean;
  readonly canWriteToOriginal = computed(
    () => this.supportsFileSystemAccess && this._fileHandle() !== null,
  );

  readonly accountBalances = computed<AccountBalance[]>(() => {
    const s = this._state();
    if (!s) return [];
    const totals = new Map<string, number>();
    const bump = (key: string, delta: number) => totals.set(key, (totals.get(key) ?? 0) + delta);

    for (const t of s.transactions) {
      const signedAmount = t.type === 'income' || t.type === 'others-in' ? t.amount : -t.amount;
      if (t.accountType === 'cash') {
        bump('bucket:cash', signedAmount);
      } else if (t.accountType === 'others') {
        bump('bucket:others', signedAmount);
      } else if (t.accountId) {
        bump(`${t.accountType}:${t.accountId}`, signedAmount);
      }
    }

    const balances: AccountBalance[] = [];
    for (const b of s.banks) {
      balances.push({
        kind: 'bank',
        id: b.id,
        name: b.name,
        color: b.color,
        balance: b.initialCapital + (totals.get(`bank:${b.id}`) ?? 0),
      });
    }
    for (const w of s.wallets) {
      balances.push({
        kind: 'wallet',
        id: w.id,
        name: w.name,
        color: w.color,
        balance: w.initialCapital + (totals.get(`wallet:${w.id}`) ?? 0),
      });
    }
    for (const c of s.cards) {
      balances.push({
        kind: 'card',
        id: c.id,
        name: c.name,
        color: c.color,
        balance: totals.get(`card:${c.id}`) ?? 0,
      });
    }
    if (totals.has('bucket:cash')) {
      balances.push({
        kind: 'bucket',
        id: 'cash',
        name: 'Cash',
        color: CASH_BUCKET_COLOR,
        balance: totals.get('bucket:cash')!,
      });
    }
    if (totals.has('bucket:others')) {
      balances.push({
        kind: 'bucket',
        id: 'others',
        name: 'Others',
        color: OTHERS_BUCKET_COLOR,
        balance: totals.get('bucket:others')!,
      });
    }
    return balances;
  });

  readonly netWorth = computed(() =>
    this.accountBalances().reduce((sum, a) => sum + a.balance, 0),
  );

  constructor(
    private readonly spwFormat: SpwFormatService,
    private readonly fileHandler: FileHandlerService,
  ) {
    this.supportsFileSystemAccess = fileHandler.supportsFileSystemAccess;
    this.supportsShareFiles = fileHandler.supportsShareFiles;
  }

  // ----- Lifecycle: create / open / unlock -----------------------------

  createNew(fileName = 'MyFinance.spw'): void {
    this._state.set({ ...createEmptyState(), categories: createDefaultCategories() });
    this._fileName.set(this.ensureExtension(fileName));
    this._fileHandle.set(null);
    this._crypto.set(null);
    this._pendingUnlock.set(null);
    this._unlockError.set(null);
    this._lastSaveMethod.set(null);
    this._dirty.set(true);
  }

  /** Opens a file picker and either loads the file immediately (SPW1/SPW2)
   * or stages it in `pendingUnlock` for the UI to collect a password
   * (SPW3). Returns `false` if the user cancelled the picker. */
  async openFile(): Promise<boolean> {
    let opened: OpenedFile;
    try {
      opened = await this.fileHandler.pickAndOpen();
    } catch (err) {
      if (err instanceof UserCancelledError) return false;
      throw err;
    }
    this._unlockError.set(null);

    if (this.spwFormat.needsCredential(opened.bytes)) {
      this._pendingUnlock.set({ name: opened.name, bytes: opened.bytes, handle: opened.handle });
      return true;
    }

    const decoded = await this.spwFormat.decode(opened.bytes);
    this.applyDecoded(decoded, opened.name, opened.handle);
    return true;
  }

  cancelUnlock(): void {
    this._pendingUnlock.set(null);
    this._unlockError.set(null);
  }

  async unlock(credential: UnlockCredential): Promise<boolean> {
    const pending = this._pendingUnlock();
    if (!pending) return false;
    this._busy.set(true);
    this._unlockError.set(null);
    try {
      const decoded = await this.spwFormat.decode(pending.bytes, credential);
      this.applyDecoded(decoded, pending.name, pending.handle);
      this._pendingUnlock.set(null);
      return true;
    } catch (err) {
      if (err instanceof WrongCredentialError) {
        this._unlockError.set(err.message);
        return false;
      }
      throw err;
    } finally {
      this._busy.set(false);
    }
  }

  private applyDecoded(
    decoded: DecodedSpw,
    name: string,
    handle: FileSystemFileHandle | null,
  ): void {
    this._state.set(decoded.state);
    this._crypto.set(decoded.crypto);
    this._fileName.set(name);
    this._fileHandle.set(handle);
    this._dirty.set(false);
    this._lastSaveMethod.set(null);
  }

  closeFile(): void {
    this._state.set(null);
    this._fileHandle.set(null);
    this._crypto.set(null);
    this._pendingUnlock.set(null);
    this._unlockError.set(null);
    this._dirty.set(false);
    this._lastSaveMethod.set(null);
  }

  // ----- Password protection management ---------------------------------

  async enablePasswordProtection(password: string): Promise<string> {
    const s = this.requireState();
    const { recoveryKey, crypto } = await this.spwFormat.encodeSpw3New(s, password);
    this._crypto.set(crypto);
    this.updateState((st) => ({ ...st, settings: { ...st.settings, passwordEnabled: true } }));
    return recoveryKey;
  }

  async changePassword(newPassword: string): Promise<void> {
    const s = this.requireState();
    const crypto = this._crypto();
    if (!crypto) throw new Error('File is not password-protected.');
    const { crypto: nextCrypto } = await this.spwFormat.encodeSpw3ChangePassword(
      s,
      crypto,
      newPassword,
    );
    this._crypto.set(nextCrypto);
    this._dirty.set(true);
  }

  async regenerateRecoveryKey(): Promise<string> {
    const s = this.requireState();
    const crypto = this._crypto();
    if (!crypto) throw new Error('File is not password-protected.');
    const { recoveryKey, crypto: nextCrypto } = await this.spwFormat.encodeSpw3RegenerateRecovery(
      s,
      crypto,
    );
    this._crypto.set(nextCrypto);
    this._dirty.set(true);
    return recoveryKey;
  }

  disablePasswordProtection(): void {
    this._crypto.set(null);
    this.updateState((st) => ({ ...st, settings: { ...st.settings, passwordEnabled: false } }));
  }

  // ----- Saving -----------------------------------------------------------

  private async buildFileBytes(): Promise<Uint8Array> {
    const s = this.requireState();
    if (s.settings.passwordEnabled) {
      const crypto = this._crypto();
      if (!crypto) {
        throw new Error('Password protection is enabled but no key is available in memory.');
      }
      const { bytes } = await this.spwFormat.encodeSpw3Resave(s, crypto);
      return bytes;
    }
    return this.spwFormat.encodeSpw2(s);
  }

  /** Writes back to the original file on disk (File System Access API
   * only). Requires explicit permission from the browser - never silent. */
  async saveToOriginal(): Promise<void> {
    const handle = this._fileHandle();
    if (!handle) throw new Error('No writable file handle is available.');
    this._busy.set(true);
    try {
      const bytes = await this.buildFileBytes();
      await this.fileHandler.saveToHandle(handle, bytes);
      this.markSaved('original');
    } finally {
      this._busy.set(false);
    }
  }

  /** "Save As" using the File System Access API's native save dialog. */
  async saveAs(): Promise<boolean> {
    this._busy.set(true);
    try {
      const bytes = await this.buildFileBytes();
      const handle = await this.fileHandler.saveAsNewHandle(bytes, this._fileName());
      if (!handle) return false; // user cancelled
      this._fileHandle.set(handle);
      this.markSaved('save-as');
      return true;
    } finally {
      this._busy.set(false);
    }
  }

  /** Hands the file to the OS share sheet (Web Share API). Primary path on
   * iOS/iPadOS and many Android browsers when File System Access isn't
   * available. */
  async shareUpdated(): Promise<boolean> {
    this._busy.set(true);
    try {
      const bytes = await this.buildFileBytes();
      const shared = await this.fileHandler.shareFile(bytes, this._fileName());
      if (shared) this.markSaved('share');
      return shared;
    } finally {
      this._busy.set(false);
    }
  }

  /** Plain download fallback - always available. */
  async downloadUpdated(): Promise<void> {
    this._busy.set(true);
    try {
      const bytes = await this.buildFileBytes();
      this.fileHandler.downloadFile(bytes, this._fileName());
      this.markSaved('download');
    } finally {
      this._busy.set(false);
    }
  }

  private markSaved(method: SaveMethod): void {
    this._dirty.set(false);
    this._lastSaveMethod.set(method);
    this.updateState(
      (st) => ({
        ...st,
        user: { ...st.user, isNew: false, lastExport: new Date().toISOString() },
      }),
      false,
    );
  }

  // ----- Mutations ----------------------------------------------------

  updateState(fn: (state: AppState) => AppState, markDirty = true): void {
    const current = this._state();
    if (!current) return;
    this._state.set(fn(current));
    if (markDirty) this._dirty.set(true);
  }

  setCurrency(currency: AppState['settings']['currency']): void {
    this.updateState((s) => ({ ...s, settings: { ...s.settings, currency } }));
  }

  addBank(bank: Omit<Bank, 'id'>): void {
    this.updateState((s) => ({
      ...s,
      banks: [...s.banks, { ...bank, id: generateId(), initialCapital: 0 }],
    }));
  }
  updateBank(id: string, patch: Partial<Bank>): void {
    this.updateState((s) => ({
      ...s,
      banks: s.banks.map((b) => (b.id === id ? { ...b, ...patch, id } : b)),
    }));
  }
  removeBank(id: string): void {
    this.updateState((s) => ({
      ...s,
      banks: s.banks.filter((b) => b.id !== id),
      transactions: s.transactions.filter((t) => !(t.accountType === 'bank' && t.accountId === id)),
    }));
  }

  addWallet(wallet: Omit<Wallet, 'id'>): void {
    this.updateState((s) => ({
      ...s,
      wallets: [...s.wallets, { ...wallet, id: generateId(), initialCapital: 0 }],
    }));
  }
  updateWallet(id: string, patch: Partial<Wallet>): void {
    this.updateState((s) => ({
      ...s,
      wallets: s.wallets.map((w) => (w.id === id ? { ...w, ...patch, id } : w)),
    }));
  }
  removeWallet(id: string): void {
    this.updateState((s) => ({
      ...s,
      wallets: s.wallets.filter((w) => w.id !== id),
      transactions: s.transactions.filter(
        (t) => !(t.accountType === 'wallet' && t.accountId === id),
      ),
    }));
  }

  addCard(card: Omit<Card, 'id'>): void {
    this.updateState((s) => ({ ...s, cards: [...s.cards, { ...card, id: generateId() }] }));
  }
  updateCard(id: string, patch: Partial<Card>): void {
    this.updateState((s) => ({
      ...s,
      cards: s.cards.map((c) => (c.id === id ? { ...c, ...patch, id } : c)),
    }));
  }
  removeCard(id: string): void {
    this.updateState((s) => ({
      ...s,
      cards: s.cards.filter((c) => c.id !== id),
      transactions: s.transactions.filter((t) => !(t.accountType === 'card' && t.accountId === id)),
    }));
  }

  addCategory(category: Omit<Category, 'id'>): void {
    this.updateState((s) => ({
      ...s,
      categories: [...s.categories, { ...category, id: generateId() }],
    }));
  }
  updateCategory(id: string, patch: Partial<Category>): void {
    this.updateState((s) => ({
      ...s,
      categories: s.categories.map((c) => (c.id === id ? { ...c, ...patch, id } : c)),
    }));
  }
  removeCategory(id: string): void {
    this.updateState((s) => ({
      ...s,
      categories: s.categories.filter((c) => c.id !== id),
      transactions: s.transactions.map((t) =>
        t.categoryId === id ? { ...t, categoryId: undefined } : t,
      ),
    }));
  }

  addTransaction(t: Omit<Transaction, 'id'>): void {
    this.updateState((s) => ({
      ...s,
      transactions: [...s.transactions, { ...t, id: generateId() }],
    }));
  }
  updateTransaction(id: string, patch: Partial<Transaction>): void {
    this.updateState((s) => ({
      ...s,
      transactions: s.transactions.map((t) => (t.id === id ? { ...t, ...patch, id } : t)),
    }));
  }
  removeTransaction(id: string): void {
    this.updateState((s) => ({ ...s, transactions: s.transactions.filter((t) => t.id !== id) }));
  }

  addFixedDeposit(fd: Omit<FixedDeposit, 'id'>): void {
    this.updateState((s) => ({
      ...s,
      fixedDeposits: [...s.fixedDeposits, { ...fd, id: generateId() }],
    }));
  }
  updateFixedDeposit(id: string, patch: Partial<FixedDeposit>): void {
    this.updateState((s) => ({
      ...s,
      fixedDeposits: s.fixedDeposits.map((f) => (f.id === id ? { ...f, ...patch, id } : f)),
    }));
  }
  removeFixedDeposit(id: string): void {
    this.updateState((s) => ({
      ...s,
      fixedDeposits: s.fixedDeposits.filter((f) => f.id !== id),
    }));
  }

  private requireState(): AppState {
    const s = this._state();
    if (!s) throw new Error('No file is currently loaded.');
    return s;
  }

  private ensureExtension(name: string): string {
    return name.toLowerCase().endsWith('.spw') ? name : `${name}.spw`;
  }
}
