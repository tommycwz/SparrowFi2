import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { IconComponent } from './icon';

export interface MultiSelectOption {
  id: string;
  name: string;
  color?: string;
  /** Optional group heading - consecutive options sharing a `group` are
   * listed under one heading (the multi-select equivalent of `<optgroup>`). */
  group?: string;
}

/**
 * A checkbox dropdown for filters that can match several values at once.
 * Same look as `sf-color-select` (trigger + floating panel, colored dots),
 * but the panel stays open while ticking options.
 *
 * Two-way bind `[(values)]` to the selected ids. An **empty array means
 * "no filter" (everything)** - so the default state needs no setup, and
 * clearing every tick goes back to "All ..." rather than matching nothing.
 */
@Component({
  selector: 'sf-multi-select',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="multi-select" [class.open]="open()">
      <button
        type="button"
        class="ms-trigger"
        [class.active]="values().length > 0"
        (click)="toggle()"
        [attr.aria-expanded]="open()"
      >
        <span class="ms-label">{{ triggerLabel() }}</span>
        @if (values().length > 1) {
          <span class="ms-count">{{ values().length }}</span>
        }
        <sf-icon class="ms-chevron" name="chevron-down" [size]="16" />
      </button>
      @if (open()) {
        <div class="ms-panel" role="listbox" aria-multiselectable="true">
          <div class="ms-actions">
            <button type="button" class="ms-link" (click)="selectAll()">Select all</button>
            <button type="button" class="ms-link" [disabled]="values().length === 0" (click)="clear()">
              Clear
            </button>
          </div>
          @for (o of options(); track o.id; let i = $index) {
            @if (o.group && o.group !== options()[i - 1]?.group) {
              <div class="ms-group">{{ o.group }}</div>
            }
            <button
              type="button"
              class="ms-option"
              role="option"
              [class.selected]="isSelected(o.id)"
              [attr.aria-selected]="isSelected(o.id)"
              (click)="toggleOption(o.id)"
            >
              <span class="ms-box">
                @if (isSelected(o.id)) {
                  <sf-icon name="check" [size]="12" />
                }
              </span>
              @if (o.color) {
                <span class="ms-dot" [style.background]="o.color"></span>
              }
              <span class="ms-name">{{ o.name }}</span>
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .multi-select {
      position: relative;
      width: 100%;
    }
    .ms-trigger {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      width: 100%;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 0.6rem 0.75rem;
      cursor: pointer;
      text-align: left;
      color: var(--text);
    }
    .ms-trigger.active {
      border-color: var(--accent);
    }
    .multi-select.open .ms-trigger {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }
    .ms-label,
    .ms-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 500;
    }
    .ms-count {
      flex-shrink: 0;
      min-width: 1.3rem;
      padding: 0 0.35rem;
      border-radius: 999px;
      background: var(--accent);
      color: #fff;
      font-size: 0.7rem;
      font-weight: 700;
      text-align: center;
      line-height: 1.3rem;
    }
    .ms-chevron {
      margin-left: auto;
      color: var(--text-muted);
      flex-shrink: 0;
    }
    .ms-panel {
      position: absolute;
      z-index: 20;
      top: calc(100% + 4px);
      left: 0;
      min-width: 100%;
      width: max-content;
      max-width: min(320px, 90vw);
      max-height: 300px;
      overflow-y: auto;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      box-shadow: 0 8px 24px rgb(0 0 0 / 20%);
      padding: 0.3rem;
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
    }
    .ms-actions {
      display: flex;
      justify-content: space-between;
      padding: 0.25rem 0.4rem 0.4rem;
      border-bottom: 1px solid var(--border);
      margin-bottom: 0.2rem;
    }
    .ms-link {
      background: none;
      border: none;
      color: var(--accent);
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
      padding: 0.15rem 0.2rem;
    }
    .ms-link:disabled {
      color: var(--text-muted);
      cursor: default;
    }
    .ms-group {
      padding: 0.45rem 0.6rem 0.15rem;
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
    }
    .ms-option {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      width: 100%;
      background: none;
      border: none;
      border-radius: 8px;
      padding: 0.5rem 0.6rem;
      cursor: pointer;
      text-align: left;
      color: var(--text);
    }
    .ms-option:hover {
      background: var(--surface-2);
    }
    .ms-box {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      border: 1.5px solid var(--text-muted);
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
    }
    .ms-option.selected .ms-box {
      background: var(--accent);
      border-color: var(--accent);
    }
    .ms-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }
  `,
})
export class MultiSelectComponent {
  private readonly elRef = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly options = input.required<MultiSelectOption[]>();
  /** Selected ids; `[]` = nothing ticked = "All" (no filtering). */
  readonly values = model<string[]>([]);
  /** Trigger text when nothing is ticked, e.g. "All Categories". */
  readonly allLabel = input('All');
  /** Trigger text when several are ticked, e.g. "categories" -> "3 categories". */
  readonly pluralNoun = input('selected');

  readonly open = signal(false);

  readonly triggerLabel = computed(() => {
    const vals = this.values();
    if (vals.length === 0) return this.allLabel();
    if (vals.length === 1) return this.options().find((o) => o.id === vals[0])?.name ?? this.allLabel();
    return `${vals.length} ${this.pluralNoun()}`;
  });

  isSelected(id: string): boolean {
    return this.values().includes(id);
  }

  toggle(): void {
    this.open.update((v) => !v);
  }

  toggleOption(id: string): void {
    this.values.update((vals) => (vals.includes(id) ? vals.filter((v) => v !== id) : [...vals, id]));
  }

  selectAll(): void {
    this.values.set(this.options().map((o) => o.id));
  }

  clear(): void {
    this.values.set([]);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.elRef.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.open.set(false);
  }
}
