export const money = (minor: number | undefined) => minor === undefined ? "Unknown" : new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(minor / 100);
export const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
export function minor(value: FormDataEntryValue | null): number {
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error("Amounts must be positive rand values with no more than two decimal places.");
  const [whole, fraction = ""] = text.split(".");
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount is too large.");
  return Number(result);
}
