/**
 * A display name, as the directory it will become.
 *
 * Kept identical to the server's own derivation on purpose: the dialog shows
 * the slug before the project is created, and a browser that guessed
 * differently from the adapter would show the operator a path that never
 * existed.
 */
export function toSlug(name: string): string {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 64);
}
