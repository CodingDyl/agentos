const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

/**
 * Human-readable age of an ISO 8601 timestamp, e.g. `2 days ago`.
 *
 * Timestamps cross the wire as ISO strings and are formatted here, because
 * "how long ago" depends on when the reader is looking, not when the adapter
 * responded. Returns `undefined` for absent or unparseable input.
 */
export function formatRelativeTime(
  isoTimestamp: string | undefined,
  now: Date = new Date(),
): string | undefined {
  if (!isoTimestamp) return undefined;

  const timestamp = new Date(isoTimestamp).getTime();
  if (Number.isNaN(timestamp)) return undefined;

  const elapsed = timestamp - now.getTime();
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  for (const [unit, milliseconds] of RELATIVE_UNITS) {
    if (Math.abs(elapsed) >= milliseconds) {
      return formatter.format(Math.round(elapsed / milliseconds), unit);
    }
  }

  return formatter.format(0, "minute");
}
