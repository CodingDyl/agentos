/** Whether this machine's command key is ⌘ rather than Ctrl. */
export function isMacPlatform(platform: string | undefined): boolean {
  return /mac|iphone|ipad/i.test(platform ?? "");
}

/**
 * A modifier shortcut as this platform writes it: `⌘K` on a Mac, `Ctrl K`
 * elsewhere. `keys` is what follows the modifier, e.g. `K` or `⇧C`.
 */
export function formatShortcut(keys: string, platform: string | undefined = globalThis.navigator?.platform): string {
  if (isMacPlatform(platform)) return `⌘${keys}`;
  return `Ctrl ${keys.replace("⇧", "Shift ")}`;
}
