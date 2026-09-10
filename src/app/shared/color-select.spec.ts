import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ColorSelectComponent, ColorSelectOption } from './color-select';

@Component({
  standalone: true,
  imports: [ColorSelectComponent],
  template: `
    <sf-color-select
      [options]="options"
      [value]="value"
      (valueChange)="value = $event"
      [allowEmpty]="allowEmpty"
      emptyLabel="Uncategorized"
      placeholder="Select…"
    />
  `,
})
class HostComponent {
  options: ColorSelectOption[] = [
    { id: 'a', name: 'Groceries', color: '#EF4444' },
    { id: 'b', name: 'Transport', color: '#3B82F6' },
  ];
  value = '';
  allowEmpty = false;
}

describe('ColorSelectComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  it('shows the placeholder (not a colored dot) when nothing is selected', () => {
    expect(el.querySelector('.cs-trigger .cs-dot')).toBeNull();
    expect(el.querySelector('.cs-trigger .cs-placeholder')?.textContent).toContain('Select…');
  });

  it('opens a panel listing every option with its colored dot', () => {
    expect(el.querySelector('.cs-panel')).toBeNull();

    el.querySelector<HTMLButtonElement>('.cs-trigger')!.click();
    fixture.detectChanges();

    const options = el.querySelectorAll('.cs-panel .cs-option');
    expect(options.length).toBe(2);
    const firstDot = options[0].querySelector('.cs-dot') as HTMLElement;
    expect(firstDot.style.background).toBe('rgb(239, 68, 68)');
  });

  it('picking an option updates the value and shows its dot on the trigger, then closes the panel', () => {
    el.querySelector<HTMLButtonElement>('.cs-trigger')!.click();
    fixture.detectChanges();

    const options = el.querySelectorAll<HTMLButtonElement>('.cs-panel .cs-option');
    options[1].click();
    fixture.detectChanges();

    expect(fixture.componentInstance.value).toBe('b');
    expect(el.querySelector('.cs-panel')).toBeNull();
    const triggerDot = el.querySelector('.cs-trigger .cs-dot') as HTMLElement;
    expect(triggerDot.style.background).toBe('rgb(59, 130, 246)');
    expect(el.querySelector('.cs-trigger .cs-label')?.textContent).toContain('Transport');
  });

  it('offers an empty row (e.g. "Uncategorized") only when allowEmpty is set', () => {
    fixture.componentInstance.allowEmpty = true;
    fixture.detectChanges();

    el.querySelector<HTMLButtonElement>('.cs-trigger')!.click();
    fixture.detectChanges();

    const options = el.querySelectorAll('.cs-panel .cs-option');
    expect(options.length).toBe(3);
    expect(options[0].textContent).toContain('Uncategorized');
  });

  it('closes the panel on an outside click without changing the value', () => {
    el.querySelector<HTMLButtonElement>('.cs-trigger')!.click();
    fixture.detectChanges();
    expect(el.querySelector('.cs-panel')).not.toBeNull();

    document.body.click();
    fixture.detectChanges();

    expect(el.querySelector('.cs-panel')).toBeNull();
    expect(fixture.componentInstance.value).toBe('');
  });
});
