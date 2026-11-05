/** Reel and clock maths for the cassette player. Kept free of the DOM so it can be tested. */

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Supply reel (left) starts full and shrinks as the tape winds onto the take-up reel.
 * Both stay large enough that a hub is still visible.
 */
export function tapeScales(progress: number): { left: number; right: number } {
  const wound = clamp01(progress);
  return { left: 1 - wound * 0.42, right: 0.58 + wound * 0.42 };
}

/** Six characters printed under the side badge. */
export function catalogueCode(value: string | undefined): string {
  const compact = (value ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (!compact) return "000000";
  return compact.slice(0, 6).padEnd(6, "0");
}

/** A `time` element's datetime value. */
export function isoDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remain = seconds % 60;
  if (hours === 0 && minutes === 0) return `PT${remain}S`;
  return `PT${hours ? `${hours}H` : ""}${minutes || hours ? `${minutes}M` : ""}${remain}S`;
}
