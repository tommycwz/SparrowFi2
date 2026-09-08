import { ChangeDetectionStrategy, Component, EventEmitter, Output, input } from '@angular/core';
import { IconComponent } from './icon';

@Component({
  selector: 'sf-modal',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="onBackdropClick()">
      <div class="panel" role="dialog" aria-modal="true" [attr.aria-label]="title()" (click)="$event.stopPropagation()">
        <header>
          <h2>{{ title() }}</h2>
          @if (dismissible()) {
            <button type="button" class="icon-btn" (click)="close.emit()" aria-label="Close">
              <sf-icon name="x" [size]="18" />
            </button>
          }
        </header>
        <div class="body">
          <ng-content />
        </div>
      </div>
    </div>
  `,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      background: rgb(15 23 42 / 55%);
      display: flex;
      align-items: flex-end;
      justify-content: center;
      z-index: 100;
      backdrop-filter: blur(2px);
    }
    .panel {
      background: var(--surface);
      color: var(--text);
      width: min(480px, 100%);
      max-height: 88vh;
      overflow-y: auto;
      border-radius: 20px 20px 0 0;
      box-shadow: 0 -8px 30px rgb(0 0 0 / 25%);
      animation: rise 0.18s ease-out;
    }
    @media (min-width: 640px) {
      .backdrop {
        align-items: center;
      }
      .panel {
        border-radius: 20px;
        margin-bottom: 4vh;
      }
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.1rem 1.25rem 0.5rem;
    }
    h2 {
      font-size: 1.1rem;
      font-weight: 700;
      margin: 0;
    }
    .icon-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 0.35rem;
      border-radius: 8px;
      display: flex;
    }
    .icon-btn:hover {
      background: var(--surface-2);
      color: var(--text);
    }
    .body {
      padding: 0.5rem 1.25rem 1.5rem;
    }
    @keyframes rise {
      from {
        transform: translateY(16px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }
  `,
})
export class ModalComponent {
  readonly title = input('');
  readonly dismissible = input(true);
  @Output() close = new EventEmitter<void>();

  onBackdropClick(): void {
    if (this.dismissible()) this.close.emit();
  }
}
