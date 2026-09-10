import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { App } from './app';

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
});
