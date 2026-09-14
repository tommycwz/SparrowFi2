import { Category } from './models';
import { generateId } from './id.util';
import { STARTER_CATEGORIES } from './default-categories';

/**
 * The pool offered as an opt-in top-up via the Categories page's "Load
 * Suggested Categories" button - the exact same curated list
 * `default-categories.ts` seeds a brand-new account with (`STARTER_CATEGORIES`),
 * so an older account (or one that deleted some of its starter categories)
 * can top up to match. Unlike `createDefaultCategories`, this is never
 * applied automatically: it only ever adds entries the account doesn't
 * already have (matched by name + type), so it's always safe to click
 * again later.
 */
export const SUGGESTED_CATEGORIES = STARTER_CATEGORIES;

/** Fresh `Category` objects (new ids) for every suggested entry the given
 * category list doesn't already have - matched by name and type,
 * case/whitespace-insensitively, so this is safe to call repeatedly without
 * ever creating a duplicate. Returns an empty array once everything's
 * already present. Carries `locked: true` through for the handful of
 * entries that need it (see `Category.locked`), same as
 * `createDefaultCategories`. */
export function missingSuggestedCategories(existing: Category[]): Category[] {
  const have = new Set(existing.map((c) => `${c.type}::${c.name.trim().toLowerCase()}`));
  return SUGGESTED_CATEGORIES.filter((s) => !have.has(`${s.type}::${s.name.trim().toLowerCase()}`)).map((s) => ({
    id: generateId(),
    name: s.name,
    type: s.type,
    color: s.color,
    locked: s.locked || undefined,
  }));
}
