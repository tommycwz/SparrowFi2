import { Injectable } from '@angular/core';

export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
  /** Present only when the File System Access API was used to open the
   * file - lets a later save write straight back to the same file. */
  handle: FileSystemFileHandle | null;
}

export class UserCancelledError extends Error {
  constructor() {
    super('The user cancelled the file picker.');
    this.name = 'UserCancelledError';
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const SPW_PICKER_TYPES = [
  {
    description: 'SparrowFi file',
    accept: { 'application/octet-stream': ['.spw'] as `.${string}`[] },
  },
];

/**
 * Cross-platform, feature-detected file I/O for `.spw` files.
 *
 * No method here ever performs network I/O - files are read from and
 * written to local disk (or handed to the OS share sheet / download
 * mechanism) entirely through browser-native APIs. Capability checks are
 * all feature detection (does `showOpenFilePicker` exist? does
 * `navigator.canShare` accept files?) rather than browser/UA sniffing, so
 * behavior degrades gracefully on any engine that adds or lacks these APIs.
 */
@Injectable({ providedIn: 'root' })
export class FileHandlerService {
  /** Desktop Chrome/Edge and other Chromium browsers: lets us open AND
   * write back to the original file on disk after explicit permission. */
  readonly supportsFileSystemAccess: boolean =
    typeof window !== 'undefined' &&
    'showOpenFilePicker' in window &&
    'showSaveFilePicker' in window &&
    window.isSecureContext;

  /** Safari (incl. iOS/iPadOS) and many Android browsers: lets us hand the
   * generated file to the native share sheet, where "Save to Files" can
   * overwrite the original if the user picks the same location/name. */
  readonly supportsShareFiles: boolean = this.detectShareSupport();

  private detectShareSupport(): boolean {
    try {
      if (typeof navigator === 'undefined' || !navigator.canShare || !navigator.share) {
        return false;
      }
      const probe = new File(['x'], 'probe.spw', { type: 'application/octet-stream' });
      return navigator.canShare({ files: [probe] });
    } catch {
      return false;
    }
  }

  /** Opens a `.spw` file. Uses the File System Access picker when available
   * (so the returned handle can later be written back to directly);
   * otherwise falls back to a plain `<input type="file">` picker, which
   * works everywhere including iOS Safari's Files app integration. */
  async pickAndOpen(): Promise<OpenedFile> {
    if (this.supportsFileSystemAccess) {
      let handles: FileSystemFileHandle[];
      try {
        handles = await window.showOpenFilePicker!({
          types: SPW_PICKER_TYPES,
          excludeAcceptAllOption: false,
          multiple: false,
        });
      } catch (err) {
        throw new UserCancelledError();
      }
      const handle = handles[0];
      const file = await handle.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      return { name: file.name, bytes, handle };
    }

    return this.pickViaInput();
  }

  private pickViaInput(): Promise<OpenedFile> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.spw';
      input.style.position = 'fixed';
      input.style.top = '-1000px';
      input.addEventListener(
        'change',
        () => {
          const file = input.files?.[0];
          document.body.removeChild(input);
          if (!file) {
            reject(new UserCancelledError());
            return;
          }
          file
            .arrayBuffer()
            .then((buf) => resolve({ name: file.name, bytes: new Uint8Array(buf), handle: null }))
            .catch(reject);
        },
        { once: true },
      );
      // Some browsers only fire `change`; if the user dismisses the dialog
      // without choosing a file there is no reliable cancel event, so we
      // simply leave the (invisible) input in the DOM in that edge case -
      // it is inert and harmless.
      document.body.appendChild(input);
      input.click();
    });
  }

  /** Writes back to the original file the user opened. Always requires an
   * explicit user gesture to have triggered this call, and will prompt the
   * browser's native permission dialog if read-write access was not
   * already granted for this handle - it never overwrites silently. */
  async saveToHandle(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
    const opts = { mode: 'readwrite' as const };
    let permission = await handle.queryPermission(opts);
    if (permission !== 'granted') {
      permission = await handle.requestPermission(opts);
    }
    if (permission !== 'granted') {
      throw new Error('Permission to write to the original file was not granted.');
    }
    const writable = await handle.createWritable();
    await writable.write(toArrayBuffer(bytes));
    await writable.close();
  }

  /** Opens a native "Save As" dialog and writes the new file, returning the
   * handle so subsequent saves can go straight back to it. */
  async saveAsNewHandle(
    bytes: Uint8Array,
    suggestedName: string,
  ): Promise<FileSystemFileHandle | null> {
    let handle: FileSystemFileHandle;
    try {
      handle = await window.showSaveFilePicker!({
        suggestedName,
        types: SPW_PICKER_TYPES,
      });
    } catch {
      return null; // user cancelled
    }
    const writable = await handle.createWritable();
    await writable.write(toArrayBuffer(bytes));
    await writable.close();
    return handle;
  }

  /** Hands the file to the OS share sheet (Web Share API Level 2). On iOS
   * this is what exposes "Save to Files", which can replace the original
   * when the user picks the same name/location. Returns `false` if the
   * user cancelled the share sheet (not treated as an error). */
  async shareFile(bytes: Uint8Array, filename: string): Promise<boolean> {
    const file = new File([toArrayBuffer(bytes)], filename, { type: 'application/octet-stream' });
    if (!navigator.canShare?.({ files: [file] })) {
      return false;
    }
    try {
      await navigator.share({ files: [file], title: filename });
      return true;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return false; // user cancelled - not an error
      }
      throw err;
    }
  }

  /** Plain download fallback: works in every browser, but on iOS Safari it
   * typically lands the file in "Downloads" rather than letting the user
   * choose a location, which is why we prefer Share/File-System-Access
   * first when they're available. */
  downloadFile(bytes: Uint8Array, filename: string): void {
    const blob = new Blob([toArrayBuffer(bytes)], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /** Best-effort, display-copy-only platform hint. Never used to change
   * which file APIs are attempted - only to tailor the guidance text the
   * UI shows (e.g. "iOS may ask you to choose where to save"). */
  isLikelyIOS(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const isIPadOrPhone = /iPad|iPhone|iPod/.test(ua);
    const isIPadOS13Plus = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return isIPadOrPhone || isIPadOS13Plus;
  }
}
