import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { DEFAULT_CATEGORY_COLORS } from '../core/models';

/**
 * A color picker: a grid of curated preset swatches plus a native
 * `<input type="color">` swatch for an unlimited custom choice. Two-way
 * bind `[(value)]` to a hex color string.
 */
@Component({
  selector: 'sf-color-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="swatch-row">
      @for (c of presets(); track c) {
        <button
          type="button"
          class="swatch"
          [class.selected]="value() === c"
          [style.background]="c"
          [attr.aria-label]="c"
          (click)="value.set(c)"
        ></button>
      }
      <label class="swatch custom-swatch" [class.selected]="isCustom()" [style.background]="value()">
        <input type="color" [value]="value()" (input)="onCustomInput($event)" />
      </label>
    </div>
  `,
  styles: `
    .swatch-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .swatch {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: 2px solid transparent;
      cursor: pointer;
      padding: 0;
    }
    .swatch.selected {
      border-color: var(--text);
      box-shadow: 0 0 0 2px var(--surface);
    }
    .custom-swatch {
      position: relative;
      overflow: hidden;
      display: inline-block;
      border: 2px dashed var(--border);
    }
    .custom-swatch.selected {
      border-style: solid;
      border-color: var(--text);
      box-shadow: 0 0 0 2px var(--surface);
    }
    .custom-swatch input {
      position: absolute;
      inset: -4px;
      width: calc(100% + 8px);
      height: calc(100% + 8px);
      opacity: 0;
      cursor: pointer;
      padding: 0;
      border: none;
    }
  `,
})
export class ColorPickerComponent {
  readonly presets = input<string[]>(DEFAULT_CATEGORY_COLORS);
  readonly value = model.required<string>();

  isCustom(): boolean {
    return !this.presets().includes(this.value());
  }

  onCustomInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.value.set(input.value);
  }
}
