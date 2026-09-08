import { TestBed } from '@angular/core/testing';
import { SpwFormatService, WrongCredentialError } from './spw-format.service';
import { createEmptyState } from './models';

describe('SpwFormatService', () => {
  let service: SpwFormatService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SpwFormatService);
  });

  it('round-trips SPW2 (unencrypted) files', async () => {
    const state = createEmptyState();
    state.banks.push({ id: 'b1', name: 'Test Bank', initialCapital: 0, color: '#22C55E' });

    const bytes = service.encodeSpw2(state);
    expect(service.detectVersion(bytes)).toBe('SPW2');
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('SPW2');

    const decoded = await service.decode(bytes);
    expect(decoded.version).toBe('SPW2');
    expect(decoded.state.banks[0].name).toBe('Test Bank');
  });

  it('SPW2 payload bytes are XOR-obfuscated, not plaintext JSON', () => {
    const state = createEmptyState();
    const bytes = service.encodeSpw2(state);
    const payloadText = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(4));
    expect(payloadText.includes('"settings"')).toBe(false);
  });

  it('decodes legacy SPW1 (plain JSON) files', async () => {
    const json = JSON.stringify(createEmptyState());
    const bytes = new Uint8Array(4 + json.length);
    bytes.set(new TextEncoder().encode('SPW1'), 0);
    bytes.set(new TextEncoder().encode(json), 4);

    const decoded = await service.decode(bytes);
    expect(decoded.version).toBe('SPW1');
    expect(decoded.crypto).toBeNull();
  });

  it('round-trips SPW3 (password-protected) files and rejects wrong passwords', async () => {
    const state = createEmptyState();
    state.wallets.push({ id: 'w1', name: 'Cash Wallet', initialCapital: 0, color: '#F97316' });

    const { bytes, recoveryKey } = await service.encodeSpw3New(state, 'correct horse battery');
    expect(service.detectVersion(bytes)).toBe('SPW3');
    expect(service.needsCredential(bytes)).toBe(true);
    expect(recoveryKey).toHaveLength(18);

    const decoded = await service.decode(bytes, {
      kind: 'password',
      value: 'correct horse battery',
    });
    expect(decoded.state.wallets[0].name).toBe('Cash Wallet');
    expect(decoded.crypto).not.toBeNull();

    const viaRecovery = await service.decode(bytes, { kind: 'recovery', value: recoveryKey });
    expect(viaRecovery.state.wallets[0].name).toBe('Cash Wallet');

    await expect(
      service.decode(bytes, { kind: 'password', value: 'wrong password' }),
    ).rejects.toBeInstanceOf(WrongCredentialError);
  });

  it('resaving an unlocked SPW3 file keeps the same recovery key valid', async () => {
    const state = createEmptyState();
    const created = await service.encodeSpw3New(state, 'hunter2');

    state.categories.push({ id: 'c1', name: 'Groceries', color: '#EF4444', type: 'expense' });
    const resaved = await service.encodeSpw3Resave(state, created.crypto);

    const decoded = await service.decode(resaved.bytes, {
      kind: 'recovery',
      value: created.recoveryKey,
    });
    expect(decoded.state.categories[0].name).toBe('Groceries');
  });

  it('changing the password keeps the old recovery key valid', async () => {
    const state = createEmptyState();
    const created = await service.encodeSpw3New(state, 'old-password');

    const changed = await service.encodeSpw3ChangePassword(state, created.crypto, 'new-password');

    await expect(
      service.decode(changed.bytes, { kind: 'password', value: 'old-password' }),
    ).rejects.toBeInstanceOf(WrongCredentialError);

    const viaNewPassword = await service.decode(changed.bytes, {
      kind: 'password',
      value: 'new-password',
    });
    expect(viaNewPassword.crypto).not.toBeNull();

    const viaOldRecovery = await service.decode(changed.bytes, {
      kind: 'recovery',
      value: created.recoveryKey,
    });
    expect(viaOldRecovery.crypto).not.toBeNull();
  });
});
