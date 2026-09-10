import { Injectable } from '@angular/core';

export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
}

export class UserCancelledError extends Error {
  constructor() {
    super('The user cancelled the file picker.');
    this.name = 'UserCancelledError';
  }
}

const SPW_PICKER_TYPES = [
  {
    description: 'SparrowFi file',
    accept: { 'application/octet-stream': ['.spw'] as `.${string}`[] },
  },
];

/**
 * Cross-platform, feature-detected picker for a legacy local `.spw` file.
 *
 * SparrowFi has no local-file mode anymore - your data lives in Supabase
 * and loads/saves automatically. The only remaining use for this service
 * is the one-time "Import Legacy File" flow in Settings, which reads an
 * old `.spw` file's bytes so `SpwFormatService` can decode it and hand the
 * result to `StateService.replaceState()`. Nothing here ever performs
 * network I/O - the file is read from local disk entirely through
 * browser-native APIs.
 */
@Injectable({ providedIn: 'root' })
export class FileHandlerService {
  private readonly supportsFileSystemAccess: boolean =
    typeof window !== 'undefined' && 'showOpenFilePicker' in window && window.isSecureContext;

  /** Opens a `.spw` file picker. Uses the File System Access picker when
   * available; otherwise falls back to a plain `<input type="file">`
   * picker, which works everywhere including iOS Safari's Files app. */
  async pickAndOpen(): Promise<OpenedFile> {
    if (this.supportsFileSystemAccess) {
      let handles: FileSystemFileHandle[];
      try {
        handles = await window.showOpenFilePicker!({
          types: SPW_PICKER_TYPES,
          excludeAcceptAllOption: false,
          multiple: false,
        });
      } catch {
        throw new UserCancelledError();
      }
      const file = await handles[0].getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      return { name: file.name, bytes };
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
            .then((buf) => resolve({ name: file.name, bytes: new Uint8Array(buf) }))
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
}
