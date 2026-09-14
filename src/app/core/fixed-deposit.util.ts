import { FixedDeposit } from './models';

/** Maturity date ('YYYY-MM-DD') for a fixed deposit, shared by the Fixed
 * Deposits page and the Dashboard's "next maturity" summary. */
export function fdMaturityDate(fd: FixedDeposit): string {
  const d = new Date(fd.startDate);
  d.setMonth(d.getMonth() + fd.months);
  return d.toISOString().slice(0, 10);
}

/** Payout value (principal + simple interest) at maturity. */
export function fdMaturityValue(fd: FixedDeposit): number {
  return fd.amount * (1 + (fd.percentage / 100) * (fd.months / 12));
}

/** Interest/gains portion of the maturity payout only - `fdMaturityValue`
 * minus the original principal (`fd.amount`). Split out as its own
 * function so `StateService` can book it as a separate Income transaction
 * from the principal returned, instead of the whole payout looking like a
 * single lump-sum transfer. */
export function fdGainValue(fd: FixedDeposit): number {
  return fdMaturityValue(fd) - fd.amount;
}
