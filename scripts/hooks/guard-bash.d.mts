export type BashDecision = { allow: true } | { allow: false; reason: string };
export function decideBash(
  command: string,
  deps?: { prChecks?: (args: string[]) => Promise<"green" | "not-green"> },
): Promise<BashDecision>;
