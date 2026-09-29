import type { FinancialAccount, Transaction } from "../../shared/finance-types";
import { cleanMerchant } from "./categorise";
import { addMonths, monthOf } from "./engine";
import type { StoredGoal } from "./store";

/**
 * An illustrative ledger, for seeing the page before Investec is connected.
 *
 * Generated in memory relative to today, never written to `finance.db`, and
 * labelled "Sample data" everywhere it appears. It exists so a screen with no
 * data is not the only way to judge the design; it is not a stand-in for
 * anyone's money, and the moment Investec is configured it is gone.
 */

const SAMPLE_ACCOUNTS: FinancialAccount[] = [
  { id: "sample-current", provider: "sample", name: "Private Bank Account", type: "current", currency: "ZAR", balance: 26_320, mask: "0000" },
  { id: "sample-savings", provider: "sample", name: "Savings pocket", type: "savings", currency: "ZAR", balance: 58_000, mask: "0001" },
  { id: "sample-invest", provider: "sample", name: "Investment account", type: "investment", currency: "ZAR", balance: 74_200, mask: "0002" },
];

export function sampleAccounts(): FinancialAccount[] {
  return SAMPLE_ACCOUNTS;
}

export function sampleGoals(today: string): StoredGoal[] {
  const trip = new Date(`${today}T12:00:00Z`);
  trip.setUTCMonth(trip.getUTCMonth() + 6);
  return [
    { id: "sample-uk", name: "UK Trip", targetAmount: 35_000, currentAmount: 18_500, targetDate: trip.toISOString().slice(0, 10), type: "travel", kind: "goal" },
    { id: "sample-emergency", name: "Emergency Fund", targetAmount: 60_000, currentAmount: 42_000, type: "emergency", kind: "goal" },
  ];
}

export function sampleTransactions(today: string): Transaction[] {
  const month = monthOf(today);
  const out: Transaction[] = [];
  let counter = 0;

  const add = (offsetMonths: number, day: number, description: string, amount: number) => {
    const target = addMonths(month, offsetMonths);
    const date = `${target}-${String(day).padStart(2, "0")}`;
    // Nothing dated after today: a sample "future" charge would be an invention.
    if (date > today) return;
    counter += 1;
    out.push({ id: `sample-${counter}`, accountId: "sample-current", date, description, amount, merchant: cleanMerchant(description) });
  };

  for (let back = -4; back <= 0; back += 1) {
    const dining = back === 0 ? 4_820 : 2_950;
    add(back, 1, "SALARY TYPEDSAFE", 42_000);
    add(back, 2, "RENT CAPE TOWN", -9_500);
    add(back, 3, "DISCOVERY HEALTH", -3_150);
    add(back, 3, "OUTSURANCE PREMIUM", -820);
    add(back, 1, "WESBANK VEHICLE FINANCE", -4_650);
    add(back, 4, "VODACOM", -699);
    add(back, 16, "STER-KINEKOR", back === 0 ? -260 : -180);
    add(back, 18, "SALON 27 HAIR", -380);
    add(back, 5, "NETFLIX.COM", back >= 0 ? -229 : -199);
    add(back, 6, "SPOTIFY", -69);
    add(back, 7, "ADOBE CREATIVE CLOUD", -899);
    add(back, 8, "PLAYSTATION PLUS", -209);
    add(back, 9, "MICROSOFT 365", -179);
    add(back, 10, "VIRGIN ACTIVE", -599);
    add(back, 11, "AWS EMEA", -420);
    add(back, 4, "TRANSFER TO SAVINGS POCKET", -5_500);
    add(back, 12, "EASYEQUITIES CONTRIBUTION", -3_000);
    for (const [day, place, amount] of [
      [3, "WOOLWORTHS 00329", -1_240],
      [10, "CHECKERS HYPER 4451", -980],
      [17, "WOOLWORTHS 00329", -1_310],
      [24, "PICK N PAY 1129", -870],
    ] as const) {
      add(back, day, place, amount);
    }
    add(back, 8, "UBER EATS", -Math.round(dining * 0.3));
    add(back, 15, "NANDOS SANDTON", -Math.round(dining * 0.35));
    add(back, 21, "VIDA E CAFFE", -Math.round(dining * 0.35));
    add(back, 6, "ENGEN SANDTON", -1_150);
    add(back, 19, "ENGEN 1CE", -1_020);
    add(back, 13, "TAKEALOT.COM", back === 0 ? -1_640 : -840);
    add(back, 14, "CLICKS 3321", -430);
  }

  // The unusual one: a large first-time charge this month.
  add(0, 22, "APPLE.COM/BILL", -1_899);

  return out;
}
