import { Injectable, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';

/** How often to proactively ask the service worker to check for a new
 * version, for anyone who leaves a tab open for a long time. Angular's own
 * service worker only checks automatically on app startup, so without
 * this a long-lived tab could sit on a stale version indefinitely. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * SparrowFi is installed as a PWA (see `ngsw-config.json` / `app.config.ts`),
 * which is exactly what makes "I published a new version but some people
 * still see the old one" possible: the Angular service worker caches the
 * whole app shell offline-first and, by design, keeps serving whatever
 * version it already has active - a freshly-fetched version sits
 * downloaded-but-inactive in the background until something tells the
 * service worker to switch over. A hard refresh alone doesn't fix this
 * (the service worker intercepts that request too); the fix has to go
 * through `SwUpdate`.
 *
 * This service listens for the service worker announcing a new version is
 * ready, and exposes `updateReady` so `App` can show a banner - refreshing
 * is a deliberate, user-triggered action (not automatic) because reloading
 * loses any unsaved changes (`StateService.dirty()`), and this app has no
 * autosave.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  readonly updateReady = signal(false);

  constructor(private readonly swUpdate: SwUpdate) {
    if (!this.swUpdate.isEnabled) return;

    this.swUpdate.versionUpdates
      .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
      .subscribe(() => this.updateReady.set(true));

    setInterval(() => this.swUpdate.checkForUpdate(), CHECK_INTERVAL_MS);
  }

  /** Switches the service worker over to the already-downloaded new
   * version, then reloads so the browser actually requests it. Call this
   * only in response to the user choosing to refresh. */
  async activate(): Promise<void> {
    await this.swUpdate.activateUpdate();
    document.location.reload();
  }
}
