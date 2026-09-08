import { Injectable, signal } from '@angular/core';

/**
 * Appearance preference for the app shell.
 *
 * 'system' (the default) lets `prefers-color-scheme` decide, same as
 * before this service existed. 'light'/'dark' force a specific palette
 * regardless of the OS/browser setting - some mobile browsers and PWA
 * host contexts don't reliably report `prefers-color-scheme`, so an
 * explicit override is the only way to guarantee dark mode actually
 * shows up when the user asks for it.
 *
 * This is a pure UI preference stored in `localStorage` on this device
 * only - it never touches the `.spw` file contents and is never sent
 * anywhere, consistent with the rest of the app's privacy model.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'sparrowfi-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _preference = signal<ThemePreference>(readStored());
  readonly preference = this._preference.asReadonly();

  constructor() {
    // Re-apply on construction too (harmless if the inline bootstrap
    // script in index.html already set it) so the attribute is correct
    // even if this service is first injected well after startup.
    apply(this._preference());
  }

  setPreference(pref: ThemePreference): void {
    this._preference.set(pref);
    apply(pref);
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      /* Storage disabled (private browsing, etc.) - preference just
         won't survive a reload; the app still works fine. */
    }
  }
}

function readStored(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* ignore */
  }
  return 'system';
}

function apply(pref: ThemePreference): void {
  const root = document.documentElement;
  if (pref === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', pref);
  }
}
