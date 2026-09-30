import { ChangeDetectionStrategy, Component, EventEmitter, Output, computed } from '@angular/core';
import { StateService } from '../core/state.service';
import { PendingChangeKind, groupPendingChanges } from '../core/pending-changes.util';
import { IconComponent } from './icon';
import { ModalComponent } from './modal';

const KIND_META: Record<PendingChangeKind, { icon: string; text: string }> = {
  added: { icon: 'plus', text: 'Added' },
  modified: { icon: 'edit', text: 'Edited' },
  deleted: { icon: 'trash', text: 'Deleted' },
};

/**
 * The "Unsaved items" popup opened from the topbar: every pending change
 * since the last save (see `StateService.pendingChanges`), grouped by
 * section, with Save and Discard actions. Closes itself once there's
 * nothing left to show (e.g. right after a save or discard).
 */
@Component({
  selector: 'sf-unsaved-changes',
  standalone: true,
  imports: [ModalComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sf-modal
      [title]="'Unsaved items (' + state.pendingChanges().length + ')'"
      (close)="close.emit()"
    >
      @if (groups().length === 0) {
        <p class="empty">Everything is saved.</p>
      } @else {
        <p class="intro">
          These changes aren’t in your account yet — they’ll be lost if you close this tab without
          saving.
        </p>
        @for (g of groups(); track g.section) {
          <section>
            <h3>
              {{ g.section }} <span class="count">{{ g.changes.length }}</span>
            </h3>
            <ul>
              @for (c of g.changes; track $index) {
                <li [class]="'kind-' + c.kind">
                  <span class="badge" [attr.title]="meta[c.kind].text">
                    <sf-icon [name]="meta[c.kind].icon" [size]="13" />
                  </span>
                  <div class="text">
                    <div class="label">
                      <span class="sr-only">{{ meta[c.kind].text }}: </span>{{ c.label }}
                    </div>
                    @if (c.detail) {
                      <div class="detail">{{ c.detail }}</div>
                    }
                    @if (c.fields?.length) {
                      <dl class="fields">
                        @for (f of c.fields; track f.field) {
                          <div>
                            <dt>{{ f.field }}</dt>
                            <dd>
                              <span class="before">{{ f.before }}</span>
                              <span class="arrow">→</span>
                              <span class="after">{{ f.after }}</span>
                            </dd>
                          </div>
                        }
                      </dl>
                    }
                  </div>
                </li>
              }
            </ul>
          </section>
        }
        <div class="actions">
          <button
            type="button"
            class="btn btn-secondary"
            [disabled]="state.busy()"
            (click)="discard()"
          >
            Discard all
          </button>
          <button
            type="button"
            class="btn btn-primary"
            [disabled]="state.busy()"
            (click)="save.emit()"
          >
            <sf-icon name="save" [size]="16" />
            {{ state.busy() ? 'Saving…' : 'Save now' }}
          </button>
        </div>
      }
    </sf-modal>
  `,
  styles: `
    .intro,
    .empty {
      margin: 0 0 0.9rem;
      color: var(--text-muted);
      font-size: 0.85rem;
    }
    section + section {
      margin-top: 1rem;
    }
    h3 {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin: 0 0 0.4rem;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .count {
      background: var(--surface-2);
      color: var(--text);
      border-radius: 999px;
      padding: 0 0.45rem;
      font-size: 0.7rem;
      letter-spacing: 0;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }
    li {
      display: flex;
      gap: 0.65rem;
      align-items: flex-start;
      padding: 0.6rem 0.75rem;
    }
    li + li {
      border-top: 1px solid var(--border);
    }
    .badge {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      margin-top: 1px;
      color: #fff;
    }
    .kind-added .badge {
      background: var(--success);
    }
    .kind-modified .badge {
      background: var(--warning);
    }
    .kind-deleted .badge {
      background: var(--danger);
    }
    .kind-deleted .label {
      text-decoration: line-through;
      color: var(--text-muted);
    }
    .text {
      min-width: 0;
      flex: 1;
    }
    .label {
      font-weight: 600;
      font-size: 0.88rem;
      overflow-wrap: anywhere;
    }
    .detail {
      color: var(--text-muted);
      font-size: 0.78rem;
      margin-top: 0.1rem;
      overflow-wrap: anywhere;
    }
    .fields {
      margin: 0.35rem 0 0;
      display: grid;
      gap: 0.15rem;
      font-size: 0.78rem;
    }
    .fields div {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }
    dt {
      color: var(--text-muted);
    }
    dt::after {
      content: ':';
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .before {
      color: var(--text-muted);
      text-decoration: line-through;
    }
    .arrow {
      color: var(--text-muted);
      margin: 0 0.25rem;
    }
    .after {
      font-weight: 600;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.6rem;
      margin-top: 1.2rem;
      position: sticky;
      bottom: -1.5rem;
      background: var(--surface);
      padding: 0.75rem 0 0.25rem;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  `,
})
export class UnsavedChangesComponent {
  readonly meta = KIND_META;
  readonly groups = computed(() => groupPendingChanges(this.state.pendingChanges()));

  @Output() close = new EventEmitter<void>();
  @Output() save = new EventEmitter<void>();

  constructor(readonly state: StateService) {}

  discard(): void {
    const n = this.state.pendingChanges().length;
    const ok = confirm(`Discard ${n} unsaved item${n === 1 ? '' : 's'}? This can't be undone.`);
    if (!ok) return;
    this.state.discardChanges();
    this.close.emit();
  }
}
