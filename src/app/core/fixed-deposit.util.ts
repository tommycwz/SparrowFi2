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
