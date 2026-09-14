import { ChangeDetectionStrategy, Component, HostListener, input, signal } from '@angular/core';
import { IconComponent } from './icon';

/**
 * Small "what does this mean" info button - sits inline right after a
 * metric's label. A click toggles a short explanatory popover anchored to
 * the button; clicking anywhere else, pressing Escape, or clicking the
 * button again closes it. Every usage supplies only `text` (the
 * explanation) and, for the accessible label, a short `label` naming the
 * metric - everything else (positioning, styling, dismiss behavior) is
 * handled once here so a new metric tile only ever adds one line.
 */
@Component({
  selector: 'sf-info-tip',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="info-tip">
      <button
        type="button"
        class="info-tip-btn"
        [attr.aria-expanded]="open()"
        [attr.aria-label]="'What does ' + label() + ' mean?'"
        (click)="toggle($event)"
      >
        <sf-icon name="info" [size]="13" />
      </button>
      @if (open()) {
        <div class="info-tip-pop" [class.align-end]="align() === 'end'" role="tooltip">{{ text() }}</div>
      }
    </span>
  `,
  styles: `
    .info-tip {
      position: relative;
      display: inline-flex;
      vertical-align: middle;
    }

    .info-tip-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      padding: 0;
      margin-left: 0.3rem;
      border: none;
      border-radius: 50%;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      flex-shrink: 0;
    }

    .info-tip-btn:hover,
    .info-tip-btn[aria-expanded='true'] {
      background: var(--surface-2);
      color: var(--accent);
    }

    /* Resets text-transform/letter-spacing/weight/color explicitly, since
       this button is usually nested inside an uppercase, tracked, muted
       label (.stat-label, .mini-label, ...) whose styling would otherwise
       bleed into the popover's own explanatory sentence. */
    .info-tip-pop {
      position: absolute;
      top: 140%;
      left: 0;
      z-index: 30;
      width: max-content;
      max-width: 220px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 0.55rem 0.7rem;
      font-size: 0.72rem;
      font-weight: 500;
      line-height: 1.45;
      color: var(--text);
      text-transform: none;
      letter-spacing: normal;
      box-shadow: 0 10px 26px rgb(0 0 0 / 16%);
    }

    .info-tip-pop.align-end {
      left: auto;
      right: 0;
    }
  `,
})
export class InfoTipComponent {
  readonly text = input.required<string>();
  /** Short metric name used only to build the button's accessible label
   * (e.g. "What does Cash Runway mean?"). Falls back to something generic
   * so a caller that forgets it doesn't end up with a broken aria-label. */
  readonly label = input<string>('this');
  /** Which edge the popover hangs from - 'end' for a button sitting near
   * the right edge of its row (the last tile in a grid), so the popover
   * opens leftward instead of running past the viewport edge. */
  readonly align = input<'start' | 'end'>('start');

  readonly open = signal(false);

  toggle(event: Event): void {
    event.stopPropagation();
    this.open.update((v) => !v);
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.open.set(false);
  }
}
