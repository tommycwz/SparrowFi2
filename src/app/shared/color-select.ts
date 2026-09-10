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

export interface ColorSelectOption {
  id: string;
  name: string;
  color?: string;
}

/**
 * A custom single-select dropdown that shows each option's colored dot
 * (matching the `.acc-dot`/`.breakdown-dot`/`.tx-dot` swatches used
 * elsewhere for accounts and categories) - something a native `<select>`
 * can't do reliably across browsers, since `<option>` background-color
 * styling is inconsistent (especially combined with the app's dark mode).
 *
 * Two-way bind `[(value)]` to the selected option's `id`, or `''` for
 * "none selected" (see `allowEmpty`/`emptyLabel`).
 */
@Component({
  selector: 'sf-color-select',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="color-select" [class.open]="open()">
      <button type="button" class="cs-trigger" (click)="toggle()" [attr.aria-expanded]="open()">
        @if (selected(); as sel) {
          @if (sel.color) {
            <span class="cs-dot" [style.background]="sel.color"></span>
          }
          <span class="cs-label">{{ sel.name }}</span>
        } @else {
          <span class="cs-label cs-placeholder">{{ placeholder() }}</span>
        }
        <sf-icon class="cs-chevron" name="chevron-down" [size]="16" />
      </button>
      @if (open()) {
        <div class="cs-panel" role="listbox">
          @if (allowEmpty()) {
            <button
              type="button"
              class="cs-option"
              [class.selected]="value() === ''"
              (click)="choose('')"
            >
              <span class="cs-label cs-placeholder">{{ emptyLabel() }}</span>
            </button>
          }
          @for (o of options(); track o.id) {
            <button
              type="button"
              class="cs-option"
              [class.selected]="value() === o.id"
              (click)="choose(o.id)"
            >
              @if (o.color) {
                <span class="cs-dot" [style.background]="o.color"></span>
              }
              <span class="cs-label">{{ o.name }}</span>
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .color-select {
      position: relative;
      width: 100%;
    }
    .cs-trigger {
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
    .color-select.open .cs-trigger {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }
    .cs-chevron {
      margin-left: auto;
      color: var(--text-muted);
      flex-shrink: 0;
    }
    .cs-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .cs-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 500;
    }
    .cs-placeholder {
      color: var(--text-muted);
      font-weight: 400;
    }
    .cs-panel {
      position: absolute;
      z-index: 20;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      max-height: 220px;
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
    .cs-option {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      width: 100%;
      background: none;
      border: none;
      border-radius: 8px;
      padding: 0.55rem 0.6rem;
      cursor: pointer;
      text-align: left;
      color: var(--text);
    }
    .cs-option:hover {
      background: var(--surface-2);
    }
    .cs-option.selected {
      background: var(--surface-2);
      font-weight: 700;
    }
  `,
})
export class ColorSelectComponent {
  private readonly elRef = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly options = input.required<ColorSelectOption[]>();
  readonly value = model.required<string>();
  readonly placeholder = input('Select…');
  /** Whether a "no selection" row (e.g. "Uncategorized") is offered. */
  readonly allowEmpty = input(false);
  readonly emptyLabel = input('None');

  readonly open = signal(false);

  readonly selected = computed(() => this.options().find((o) => o.id === this.value()));

  toggle(): void {
    this.open.update((v) => !v);
  }

  choose(id: string): void {
    this.value.set(id);
    this.open.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.elRef.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }
}
