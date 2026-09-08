/**
 * Minimal ambient typings for the File System Access API surface this app
 * uses (`showOpenFilePicker`, `showSaveFilePicker`, and the permission
 * methods on `FileSystemFileHandle`). TypeScript's bundled DOM lib already
 * declares `FileSystemFileHandle` itself; this file only fills in the
 * pieces it's missing so the app compiles without pulling in a third-party
 * `@types` package. All calls remain purely local (disk-file access) - no
 * network is involved.
 */
export {};

declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite';
  }

  interface FileSystemFileHandle {
    queryPermission(
      descriptor?: FileSystemHandlePermissionDescriptor,
    ): Promise<PermissionState>;
    requestPermission(
      descriptor?: FileSystemHandlePermissionDescriptor,
    ): Promise<PermissionState>;
  }

  interface FilePickerAcceptType {
    description?: string;
    accept: Record<string, string[]>;
  }

  interface OpenFilePickerOptions {
    types?: FilePickerAcceptType[];
    excludeAcceptAllOption?: boolean;
    multiple?: boolean;
  }

  interface SaveFilePickerOptions {
    types?: FilePickerAcceptType[];
    suggestedName?: string;
    excludeAcceptAllOption?: boolean;
  }

  interface Window {
    showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
  }
}
