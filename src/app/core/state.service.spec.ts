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
