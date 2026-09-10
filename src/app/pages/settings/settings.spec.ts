import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SettingsPage } from './settings';
import { StateService } from '../../core/state.service';
import { SpwFormatService, Spw3Crypto } from '../../core/spw-format.service';
import { createEmptyState } from '../../core/models';

describe('SettingsPage', () => {
  let state: StateService;
  let spwFormat: SpwFormatService;
  let page: SettingsPage;
  let fixture: ComponentFixture<SettingsPage>;

  // `downloadSpwFile` goes through `URL.createObjectURL` and an `<a>`
  // click to trigger a browser download - neither does anything useful
  // (or safe) inside the test environment, so they're stubbed out for
  // every test in this file and restored afterward.
  let createObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SettingsPage] });
    state = TestBed.inject(StateService);
    state.replaceState(createEmptyState());
    spwFormat = TestBed.inject(SpwFormatService);
    fixture = TestBed.createComponent(SettingsPage);
    page = fixture.componentInstance;

    createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
    clickSpy.mockRestore();
  });

  describe('exportBackup - Quick Export (unprotected)', () => {
    it('encodes the current state as SPW2 and triggers a .spw download', async () => {
      state.addBank({ name: 'Maybank', color: '#2563EB', initialCapital: 0 });
      const encodeSpy = vi.spyOn(spwFormat, 'encodeSpw2');

      await page.exportBackup();

      expect(encodeSpy).toHaveBeenCalledWith(state.state());
      expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:fake-url');
      expect(page.exportError()).toBeNull();
      // No password involved, so no recovery key modal.
      expect(page.exportRecoveryKey()).toBeNull();
    });
  });

  describe('exportBackup - Password-Protected', () => {
    beforeEach(() => {
      page.setExportProtection('password');
    });

    it('refuses to export without a password', async () => {
      await page.exportBackup();
      expect(page.exportError()).toContain('password');
      expect(createObjectURLSpy).not.toHaveBeenCalled();
    });

    it('refuses to export when the passwords do not match', async () => {
      page.exportPassword.set('correct-horse');
      page.exportPasswordConfirm.set('something-else');
      await page.exportBackup();
      expect(page.exportError()).toBe('Passwords do not match.');
      expect(createObjectURLSpy).not.toHaveBeenCalled();
    });

    it('downloads an SPW3 file and shows the recovery key exactly once', async () => {
      const fakeCrypto = {} as Spw3Crypto;
      vi.spyOn(spwFormat, 'encodeSpw3New').mockResolvedValue({
        bytes: new Uint8Array([1, 2, 3]),
        recoveryKey: 'ABCDEFGHIJKLMNOPQR',
        crypto: fakeCrypto,
      });
      page.exportPassword.set('correct-horse');
      page.exportPasswordConfirm.set('correct-horse');

      await page.exportBackup();

      expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      // The password fields are cleared once the file's been produced -
      // nothing sensitive lingers in the form after a successful export.
      expect(page.exportPassword()).toBe('');
      expect(page.exportPasswordConfirm()).toBe('');
      // The recovery key is only ever available this once - shown now so
      // the user can save it, since `encodeSpw3New` never stores it.
      expect(page.exportRecoveryKey()).toBe('ABCDEFGHIJKLMNOPQR');

      page.closeRecoveryKeyModal();
      expect(page.exportRecoveryKey()).toBeNull();
    });
  });

  describe('rendered DOM', () => {
    it('shows password fields only when Password-Protected is selected', () => {
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('input[type="password"]')).toBeNull();

      page.setExportProtection('password');
      fixture.detectChanges();
      expect(el.querySelectorAll('input[type="password"]').length).toBe(2);
    });

    it('displays the formatted recovery key in the modal', () => {
      page.exportRecoveryKey.set('ABCDEFGHIJKLMNOPQR');
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.recovery-key')?.textContent?.trim()).toBe('ABCDEF-GHIJKL-MNOPQR');
    });
  });
});
