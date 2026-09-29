/**
 * Debt arithmetic: how long a balance takes to clear, what it costs, and what
 * to pay to clear it by a date.
 *
 * Pure, shared by the server (which reports each card's plan) and the page. The
 * interest rate is one you enter: a card's real rate depends on its terms, and
 * AgentOS does not guess it. With no rate the functions treat it as zero, which
 * understates the cost, and callers say so.
 *
 * Interest is modelled as `annualRate / 12` on the balance each month, before
 * the payment. Real cards compute it daily and add fees, so this is an estimate
 * that errs slightly low.
 */

const MAX_MONTHS = 600;

/** The interest one month adds to `owed` at an annual rate (a fraction, so 0.22 is 22%). */
export function monthlyInterest(owed: number, annualRate: number): number {
  return owed * (annualRate / 12);
}

/**
 * Months to clear `owed` paying `payment` a month, or `undefined` when the
 * payment does not even cover the interest and the balance would never fall.
 */
export function monthsToClear(owed: number, annualRate: number, payment: number): number | undefined {
  if (owed <= 0) return 0;
  if (payment <= 0) return undefined;

  const rate = annualRate / 12;
  if (rate === 0) return Math.ceil(owed / payment - 1e-9);
  if (payment <= owed * rate) return undefined;

  // n = -ln(1 - r * owed / payment) / ln(1 + r)
  // The tolerance stops floating-point noise turning exactly 12 months into 13.
  return Math.min(MAX_MONTHS, Math.ceil(-Math.log(1 - (rate * owed) / payment) / Math.log(1 + rate) - 1e-9));
}

/** The monthly payment that clears `owed` in exactly `months`. */
export function paymentToClear(owed: number, annualRate: number, months: number): number {
  if (owed <= 0) return 0;
  const n = Math.max(1, months);
  const rate = annualRate / 12;
  if (rate === 0) return owed / n;
  return (owed * rate) / (1 - (1 + rate) ** -n);
}

/** Total interest paid clearing `owed` at `payment` a month. Undefined when it never clears. */
export function totalInterest(owed: number, annualRate: number, payment: number): number | undefined {
  const months = monthsToClear(owed, annualRate, payment);
  if (months === undefined) return undefined;
  const rate = annualRate / 12;
  let balance = owed;
  let paid = 0;
  for (let month = 0; month < months && balance > 0; month += 1) {
    const interest = balance * rate;
    const pay = Math.min(payment, balance + interest);
    paid += interest;
    balance = balance + interest - pay;
  }
  return paid;
}

export interface PayoffOption {
  months: number;
  monthly: number;
  interest: number;
}

/** What clearing the debt over 6, 12 and 24 months would ask, and cost in interest. */
export function payoffOptions(owed: number, annualRate: number): PayoffOption[] {
  return [6, 12, 24].map((months) => {
    const monthly = paymentToClear(owed, annualRate, months);
    return { months, monthly: Math.round(monthly), interest: Math.round(totalInterest(owed, annualRate, monthly) ?? 0) };
  });
}
