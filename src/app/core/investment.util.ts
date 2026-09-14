import { Investment } from './models';

/** Gain/loss on a completed investment - positive is a gain, negative is a
 * loss, zero is a wash. `undefined` while still active, since there's no
 * formula to predict it (unlike a Fixed Deposit's rate). */
export function investmentDelta(inv: Investment): number | undefined {
  if (inv.status !== 'completed' || inv.finalAmount === undefined) return undefined;
  return inv.finalAmount - inv.amount;
}

/** Gain portion only (0 if there was no gain, or the investment isn't
 * completed yet) - what `completeInvestment` books as "Investment Profit"
 * income (when there's a "to fund" account to book it against). */
export function investmentGainValue(inv: Investment): number {
  const delta = investmentDelta(inv);
  return delta !== undefined && delta > 0 ? delta : 0;
}

/** Loss portion only, as a positive magnitude (0 if there was no loss, or
 * the investment isn't completed yet) - purely for chart/report display.
 * `completeInvestment` itself has no dedicated loss category: a loss just
 * shows up as a smaller "Investment (In)" principal transaction. */
export function investmentLossValue(inv: Investment): number {
  const delta = investmentDelta(inv);
  return delta !== undefined && delta < 0 ? -delta : 0;
}
