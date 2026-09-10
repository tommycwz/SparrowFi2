import { TestBed } from '@angular/core/testing';
import { StateService } from './state.service';
import { createEmptyState } from './models';
import { fdMaturityValue } from './fixed-deposit.util';

describe('StateService fixed deposit <-> transaction linking', () => {
  let service: StateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StateService);
    service.replaceState(createEmptyState());
    service.addBank({ name: 'Main Bank', color: '#22C55E', initialCapital: 0 });
    service.addBank({ name: 'Other Bank', color: '#3B82F6', initialCapital: 0 });
  });

  function bankId(name: string): string {
    return service.state()!.banks.find((b) => b.name === name)!.id;
  }

  it('records an others-out transaction against the bank when a fixed deposit is created', () => {
    service.addFixedDeposit({
      bankId: bankId('Main Bank'),
      startDate: '2026-01-01',
      amount: 1000,
      percentage: 3.5,
      months: 12,
      status: 'active',
    });

    const fd = service.state()!.fixedDeposits[0];
    const linked = service.state()!.transactions.filter((t) => t.fdId === fd.id);
    expect(linked.length).toBe(1);
    expect(linked[0].type).toBe('others-out');
    expect(linked[0].accountType).toBe('bank');
    expect(linked[0].accountId).toBe(bankId('Main Bank'));
    expect(linked[0].amount).toBe(1000);
    expect(linked[0].date).toBe('2026-01-01');
  });

  it('records an others-in maturity transaction, to toBankId, exactly once when marked matured', () => {
    service.addFixedDeposit({
      bankId: bankId('Main Bank'),
      toBankId: bankId('Other Bank'),
      startDate: '2026-01-01',
      amount: 1000,
      percentage: 12,
      months: 12,
      status: 'active',
    });
    const fd = service.state()!.fixedDeposits[0];

    service.updateFixedDeposit(fd.id, { status: 'matured' });
    let maturityTx = service.state()!.transactions.filter((t) => t.fdId === fd.id && t.type === 'others-in');
    expect(maturityTx.length).toBe(1);
    expect(maturityTx[0].accountId).toBe(bankId('Other Bank'));
    expect(maturityTx[0].amount).toBeCloseTo(fdMaturityValue({ ...fd, status: 'matured' }));

    // Marking matured again (e.g. a stray double-call) must not duplicate it.
    service.updateFixedDeposit(fd.id, { status: 'matured' });
    maturityTx = service.state()!.transactions.filter((t) => t.fdId === fd.id && t.type === 'others-in');
    expect(maturityTx.length).toBe(1);
  });

  it('keeps the opening transaction in sync when the fixed deposit is edited', () => {
    service.addFixedDeposit({
      bankId: bankId('Main Bank'),
      startDate: '2026-01-01',
      amount: 1000,
      percentage: 3.5,
      months: 12,
      status: 'active',
    });
    const fd = service.state()!.fixedDeposits[0];

    service.updateFixedDeposit(fd.id, { amount: 2000, bankId: bankId('Other Bank') });
    const opening = service.state()!.transactions.find((t) => t.fdId === fd.id && t.type === 'others-out')!;
    expect(opening.amount).toBe(2000);
    expect(opening.accountId).toBe(bankId('Other Bank'));
  });

  it('removes linked transactions when the fixed deposit is deleted', () => {
    service.addFixedDeposit({
      bankId: bankId('Main Bank'),
      startDate: '2026-01-01',
      amount: 1000,
      percentage: 3.5,
      months: 12,
      status: 'active',
    });
    const fd = service.state()!.fixedDeposits[0];
    service.updateFixedDeposit(fd.id, { status: 'matured' });
    expect(service.state()!.transactions.filter((t) => t.fdId === fd.id).length).toBe(2);

    service.removeFixedDeposit(fd.id);
    expect(service.state()!.transactions.filter((t) => t.fdId === fd.id).length).toBe(0);
  });
});

describe('StateService bank/wallet initial capital', () => {
  let service: StateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StateService);
    service.replaceState(createEmptyState());
  });

  it('records a non-zero initial capital as an opening transaction, not on the bank record', () => {
    service.addBank({ name: 'Main Bank', color: '#22C55E', initialCapital: 1500 });
    const bank = service.state()!.banks[0];

    // Not double-counted: the stored field is zeroed...
    expect(bank.initialCapital).toBe(0);
    // ...because the balance instead comes from an opening transaction.
    const opening = service.state()!.transactions.filter((t) => t.accountId === bank.id);
    expect(opening.length).toBe(1);
    expect(opening[0].type).toBe('others-in');
    expect(opening[0].accountType).toBe('bank');
    expect(opening[0].amount).toBe(1500);
    expect(opening[0].notes).toBe('Initial balance');

    const balance = service.accountBalances().find((a) => a.id === bank.id)!;
    expect(balance.balance).toBe(1500);
  });

  it('records a wallet initial capital the same way', () => {
    service.addWallet({ name: 'Cash Wallet', color: '#F97316', initialCapital: 200 });
    const wallet = service.state()!.wallets[0];

    expect(wallet.initialCapital).toBe(0);
    const opening = service.state()!.transactions.filter((t) => t.accountId === wallet.id);
    expect(opening.length).toBe(1);
    expect(opening[0].accountType).toBe('wallet');
    expect(opening[0].amount).toBe(200);
  });

  it('creates no opening transaction when initial capital is zero', () => {
    service.addBank({ name: 'Empty Bank', color: '#22C55E', initialCapital: 0 });
    expect(service.state()!.transactions.length).toBe(0);
  });

  it('updateBank only ever changes name/color, never initialCapital', () => {
    service.addBank({ name: 'Main Bank', color: '#22C55E', initialCapital: 1000 });
    const bank = service.state()!.banks[0];

    service.updateBank(bank.id, { name: 'Renamed Bank', color: '#3B82F6' });
    const updated = service.state()!.banks[0];
    expect(updated.name).toBe('Renamed Bank');
    expect(updated.color).toBe('#3B82F6');
    expect(updated.initialCapital).toBe(0);
    // The opening transaction (and thus the balance) is untouched by the rename.
    const balance = service.accountBalances().find((a) => a.id === bank.id)!;
    expect(balance.balance).toBe(1000);
  });
});

describe('StateService account deletion guard', () => {
  let service: StateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StateService);
    service.replaceState(createEmptyState());
  });

  it('deletes a bank with no transactions', () => {
    service.addBank({ name: 'Empty Bank', color: '#22C55E', initialCapital: 0 });
    const bank = service.state()!.banks[0];
    service.removeBank(bank.id);
    expect(service.state()!.banks.length).toBe(0);
  });

  it('refuses to delete a bank with its own opening-balance transaction', () => {
    service.addBank({ name: 'Main Bank', color: '#22C55E', initialCapital: 500 });
    const bank = service.state()!.banks[0];
    expect(service.accountHasTransactions('bank', bank.id)).toBe(true);
    expect(() => service.removeBank(bank.id)).toThrowError(/can’t be deleted/);
    // Nothing was removed.
    expect(service.state()!.banks.length).toBe(1);
    expect(service.state()!.transactions.length).toBe(1);
  });

  it('refuses to delete a bank that only has a fixed-deposit-generated transaction', () => {
    service.addBank({ name: 'Main Bank', color: '#22C55E', initialCapital: 0 });
    const bank = service.state()!.banks[0];
    service.addFixedDeposit({
      bankId: bank.id,
      startDate: '2026-01-01',
      amount: 1000,
      percentage: 3.5,
      months: 12,
      status: 'active',
    });
    expect(() => service.removeBank(bank.id)).toThrowError(/can’t be deleted/);
  });

  it('refuses to delete a wallet with transactions, but allows it once they are gone', () => {
    service.addWallet({ name: 'Cash Wallet', color: '#F97316', initialCapital: 100 });
    const wallet = service.state()!.wallets[0];
    expect(() => service.removeWallet(wallet.id)).toThrowError(/can’t be deleted/);

    const tx = service.state()!.transactions[0];
    service.removeTransaction(tx.id);
    expect(service.accountHasTransactions('wallet', wallet.id)).toBe(false);
    service.removeWallet(wallet.id);
    expect(service.state()!.wallets.length).toBe(0);
  });

  it('refuses to delete a card with transactions', () => {
    service.addCard({ name: 'Visa', color: '#3B82F6' });
    const card = service.state()!.cards[0];
    service.addTransaction({
      date: '2026-01-01',
      amount: 50,
      type: 'expense',
      accountType: 'card',
      accountId: card.id,
    });
    expect(() => service.removeCard(card.id)).toThrowError(/can’t be deleted/);
    service.removeTransaction(service.state()!.transactions[0].id);
    service.removeCard(card.id);
    expect(service.state()!.cards.length).toBe(0);
  });
});
