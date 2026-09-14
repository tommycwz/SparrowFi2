/**
 * RETIRED - this file backed the old "Load Suggested Categories" button on
 * the Categories page. That feature was removed; `ensureRequiredCategories`
 * in `default-categories.ts` replaced it with an automatic backfill that
 * runs on every load, so nothing needs to import this module anymore.
 *
 * This file (and its spec) should simply be deleted. It's kept as an inert
 * placeholder for now only because the sync path used to update this repo
 * can write files but can't delete them - please `git rm` this file and
 * `suggested-categories.spec.ts` next time you're working in the repo
 * directly, then commit/push.
 */
export {};
