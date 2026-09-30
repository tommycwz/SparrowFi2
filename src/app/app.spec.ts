import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { App } from './app';
import { StateService } from './core/state.service';
import { CloudDataService } from './core/cloud-data.service';
import { createEmptyState } from './core/models';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      // `enabled: false` - App injects UpdateService, which injects
      // SwUpdate, which needs this provider to exist in the DI tree even
      // though there's no real service worker in the jsdom test
      // environment to register.
      providers: [provideRouter([]), provideServiceWorker('ngsw-worker.js', { enabled: false })],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('shows the launcher when not signed in', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-launcher')).toBeTruthy();
  });

  it('shows an "Unsaved items (N)" button that opens the list of changes', async () => {
    TestBed.overrideProvider(CloudDataService, {
      useValue: { load: async () => createEmptyState(), save: async () => {}, reset: async () => {} },
    });
    const fixture = TestBed.createComponent(App);
    const state = TestBed.inject(StateService);
    await state.load();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.unsaved-btn')).toBeNull();

    state.addBank({ name: 'Maybank', color: '#000', initialCapital: 0 });
    state.addCard({ name: 'Visa', color: '#111' });
    fixture.detectChanges();
    await fixture.whenStable();

    const btn = el.querySelector<HTMLButtonElement>('.unsaved-btn')!;
    expect(btn.textContent).toContain('Unsaved items');
    expect(btn.querySelector('.unsaved-count')!.textContent!.trim()).toBe('2');

    btn.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const list = el.querySelector('sf-unsaved-changes')!;
    expect(list.textContent).toContain('Unsaved items (2)');
    expect(list.textContent).toContain('Maybank');
    expect(list.textContent).toContain('Visa');
  });
});
