import { formatMoney } from './currency.util';
import {
  AppState,
  BUDGET_PERIOD_LABELS,
  CURRENCIES,
  RECURRING_FREQUENCY_LABELS,
  TRANSACTION_TYPE_LABELS,
} from './models';

/**
 * Works out what's changed since the last save by comparing the current
 * `AppState` against a snapshot of the last-saved one, item by item (matched
 * on `id`) - so the "Unsaved items" list can say *what* is pending, not just
 * *that* something is. Comparing snapshots (rather than logging each
 * mutation as it happens) means every `StateService` mutation is covered
 * automatically, including ones added later, and an edit that's put back
 * the way it was drops off the list again instead of lingering.
 *
 * Cheap even for large states: every mutation in `StateService` builds new
 * arrays/objects only for what it touches, so an untouched item is still the
 * *same object* as in the snapshot and is skipped by a reference check -
 * only items whose reference changed get a (key-order-insensitive) deep
 * comparison.
 */

export type PendingChangeKind = 'added' | 'modified' | 'deleted';

export interface PendingFieldChange {
  field: string;
  before: string;
  after: string;
}

export interface PendingChange {
  kind: PendingChangeKind;
  /** Section heading this change is grouped under - 'Transactions', 'Banks', ... */
  section: string;
  /** One-line description of the item, e.g. "2026-09-12 · Groceries · RM45.00". */
  label: string;
  /** Optional secondary line (account, notes, remarks...). */
  detail?: string;
  /** Field-by-field before/after, for `kind: 'modified'` only. */
  fields?: PendingFieldChange[];
}

export interface PendingChangeGroup {
  section: string;
  changes: PendingChange[];
}

type Entity = { id: string } & Record<string, unknown>;

interface Ctx {
  /** Current state first, then saved - so a name that was just renamed shows
   * its new name, and an item that's just been deleted can still be named. */
  states: AppState[];
  currency: AppState['settings']['currency'];
}

type CollectionKey = Exclude<keyof AppState, 'user' | 'settings'>;

interface CollectionSpec {
  key: CollectionKey;
  section: string;
  label: (item: any, ctx: Ctx) => string;
  detail?: (item: any, ctx: Ctx) => string | undefined;
}

/** Fields whose values are money amounts, formatted with the account currency. */
const MONEY_FIELDS = new Set(['amount', 'initialCapital', 'finalAmount']);

/** Fields never worth showing as a change (internal bookkeeping). */
const HIDDEN_FIELDS = new Set(['id', 'anchorDay']);

const FIELD_LABELS: Record<string, string> = {
  initialCapital: 'Initial balance',
  accountType: 'Account type',
  accountId: 'Account',
  categoryId: 'Category',
  bankId: 'From bank',
  toBankId: 'To bank',
  fromAccountId: 'From account',
  fromAccountType: 'From account type',
  toAccountId: 'To account',
  toAccountType: 'To account type',
  startDate: 'Start date',
  nextDate: 'Next date',
  completionDate: 'Completion date',
  finalAmount: 'Final amount',
  percentage: 'Rate (%)',
  fdId: 'Fixed deposit',
  investmentId: 'Investment',
  recurringId: 'Recurring item',
  locked: 'Locked',
};

// ----- Name lookups ------------------------------------------------------

function findIn<T extends { id: string }>(
  ctx: Ctx,
  pick: (s: AppState) => T[] | undefined,
  id: string | undefined,
): T | undefined {
  if (!id) return undefined;
  for (const s of ctx.states) {
    const hit = pick(s)?.find((x) => x.id === id);
    if (hit) return hit;
  }
  return undefined;
}

function categoryName(ctx: Ctx, id: string | undefined): string | undefined {
  return findIn(ctx, (s) => s.categories, id)?.name;
}

function accountName(
  ctx: Ctx,
  type: string | undefined,
  id: string | undefined,
): string | undefined {
  if (type === 'cash') return 'Cash';
  if (type === 'others') return 'Others';
  return (
    findIn(ctx, (s) => s.banks, id)?.name ??
    findIn(ctx, (s) => s.wallets, id)?.name ??
    findIn(ctx, (s) => s.cards, id)?.name
  );
}

function money(ctx: Ctx, n: unknown): string {
  return typeof n === 'number' ? formatMoney(n, ctx.currency) : '—';
}

function joinParts(...parts: (string | undefined | null | false)[]): string {
  return parts.filter((p): p is string => !!p).join(' · ');
}

// ----- Per-collection labels --------------------------------------------

const COLLECTIONS: CollectionSpec[] = [
  {
    key: 'transactions',
    section: 'Transactions',
    label: (t, ctx) =>
      joinParts(
        t.date,
        categoryName(ctx, t.categoryId) ??
          TRANSACTION_TYPE_LABELS[t.type as keyof typeof TRANSACTION_TYPE_LABELS],
        money(ctx, t.amount),
      ),
    detail: (t, ctx) =>
      joinParts(accountName(ctx, t.accountType, t.accountId), t.notes) || undefined,
  },
  { key: 'banks', section: 'Banks', label: (b) => b.name },
  { key: 'wallets', section: 'Wallets', label: (w) => w.name },
  { key: 'cards', section: 'Cards', label: (c) => c.name },
  {
    key: 'categories',
    section: 'Categories',
    label: (c) => c.name,
    detail: (c) => TRANSACTION_TYPE_LABELS[c.type as keyof typeof TRANSACTION_TYPE_LABELS],
  },
  {
    key: 'budgets',
    section: 'Budgets',
    label: (b, ctx) => `${categoryName(ctx, b.categoryId) ?? 'Budget'} · ${money(ctx, b.amount)}`,
    detail: (b) =>
      BUDGET_PERIOD_LABELS[(b.period ?? 'monthly') as keyof typeof BUDGET_PERIOD_LABELS],
  },
  {
    key: 'recurringTransactions',
    section: 'Recurring',
    label: (r) => r.name,
    detail: (r) =>
      joinParts(
        RECURRING_FREQUENCY_LABELS[r.frequency as keyof typeof RECURRING_FREQUENCY_LABELS],
        r.nextDate && `next ${r.nextDate}`,
      ),
  },
  {
    key: 'fixedDeposits',
    section: 'Fixed Deposits',
    label: (fd, ctx) =>
      joinParts(`FD ${money(ctx, fd.amount)}`, `${fd.percentage}%`, `${fd.months} mo`),
    detail: (fd, ctx) =>
      joinParts(findIn(ctx, (s) => s.banks, fd.bankId)?.name, fd.remarks) || undefined,
  },
  {
    key: 'investments',
    section: 'Investments',
    label: (inv, ctx) => `${inv.name} · ${money(ctx, inv.amount)}`,
    detail: (inv) => inv.remarks || undefined,
  },
];

// ----- Comparison helpers -----------------------------------------------

/** JSON with sorted keys, so two objects that differ only in key order (or
 * in an explicit `undefined` vs. a missing key) compare equal. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  return a === b || stableStringify(a) === stableStringify(b);
}

function humanizeField(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const spaced = field.replace(/([A-Z])/g, ' $1').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatFieldValue(field: string, value: unknown, owner: Entity, ctx: Ctx): string {
  if (value === undefined || value === null || value === '') return '—';
  if (MONEY_FIELDS.has(field)) return money(ctx, value);
  if (field === 'categoryId') return categoryName(ctx, value as string) ?? '(deleted category)';
  if (field === 'accountId')
    return accountName(ctx, owner['accountType'] as string, value as string) ?? '—';
  if (
    field === 'fromAccountId' ||
    field === 'toAccountId' ||
    field === 'bankId' ||
    field === 'toBankId'
  ) {
    return accountName(ctx, undefined, value as string) ?? '—';
  }
  if (field === 'type')
    return TRANSACTION_TYPE_LABELS[value as keyof typeof TRANSACTION_TYPE_LABELS] ?? String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value === 'object') return '(changed)';
  return String(value);
}

function fieldChanges(before: Entity, after: Entity, ctx: Ctx): PendingFieldChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: PendingFieldChange[] = [];
  for (const key of keys) {
    if (HIDDEN_FIELDS.has(key)) continue;
    if (sameValue(before[key], after[key])) continue;
    // A recurring item's lines are a nested list - comparing its length
    // alone would read "2 items -> 2 items" for an edited amount, so say
    // plainly that the lines changed instead.
    if (key === 'lines') {
      out.push({ field: 'Lines', before: 'previous', after: 'edited' });
      continue;
    }
    out.push({
      field: humanizeField(key),
      before: formatFieldValue(key, before[key], before, ctx),
      after: formatFieldValue(key, after[key], after, ctx),
    });
  }
  return out;
}

function diffCollection(
  spec: CollectionSpec,
  saved: Entity[],
  current: Entity[],
  ctx: Ctx,
): PendingChange[] {
  if (saved === current) return [];
  const savedById = new Map(saved.map((x) => [x.id, x]));
  const currentIds = new Set<string>();
  const changes: PendingChange[] = [];
  const make = (
    kind: PendingChangeKind,
    item: Entity,
    fields?: PendingFieldChange[],
  ): PendingChange => ({
    kind,
    section: spec.section,
    label: spec.label(item, ctx),
    detail: spec.detail?.(item, ctx),
    ...(fields ? { fields } : {}),
  });

  for (const item of current) {
    currentIds.add(item.id);
    const before = savedById.get(item.id);
    if (!before) {
      changes.push(make('added', item));
    } else if (before !== item && !sameValue(before, item)) {
      const fields = fieldChanges(before, item, ctx);
      if (fields.length) changes.push(make('modified', item, fields));
    }
  }
  for (const item of saved) {
    if (!currentIds.has(item.id)) changes.push(make('deleted', item));
  }
  return changes;
}

// ----- Public API -------------------------------------------------------

/** Everything that differs between `saved` (the last-saved snapshot) and
 * `current`. `user` is ignored on purpose - `save()` itself stamps
 * `user.lastExport`/`isNew`, which aren't edits anyone made. Returns `[]`
 * when either side is missing. */
export function diffStates(saved: AppState | null, current: AppState | null): PendingChange[] {
  if (!saved || !current || saved === current) return [];
  const ctx: Ctx = {
    states: [current, saved],
    currency: current.settings.currency,
  };
  const changes: PendingChange[] = [];

  if (saved.settings.currency !== current.settings.currency) {
    const label = (c: string) => CURRENCIES.find((x) => x.value === c)?.label ?? c.toUpperCase();
    changes.push({
      kind: 'modified',
      section: 'Settings',
      label: 'Currency',
      fields: [
        {
          field: 'Currency',
          before: label(saved.settings.currency),
          after: label(current.settings.currency),
        },
      ],
    });
  }

  for (const spec of COLLECTIONS) {
    changes.push(
      ...diffCollection(
        spec,
        (saved[spec.key] ?? []) as unknown as Entity[],
        (current[spec.key] ?? []) as unknown as Entity[],
        ctx,
      ),
    );
  }
  return changes;
}

/** Groups changes by section, keeping sections in the order they first
 * appear (Settings, Transactions, Banks, ...). */
export function groupPendingChanges(changes: PendingChange[]): PendingChangeGroup[] {
  const groups = new Map<string, PendingChange[]>();
  for (const c of changes) {
    const list = groups.get(c.section) ?? [];
    list.push(c);
    groups.set(c.section, list);
  }
  return [...groups].map(([section, list]) => ({ section, changes: list }));
}
