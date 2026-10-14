import path from "node:path";

/**
 * The only way a download request names a file on disk.
 *
 * The browser never learns a filesystem path for library assets — those are
 * looked up by id — but the attachment endpoint also accepts a path so Motion
 * Design files and anything else under the media roots can be streamed with
 * `Content-Disposition: attachment`. Paths are attacker-controlled, so this
 * module refuses `..`, null bytes, and anything that is not strictly inside
 * an allowed root. It does not read the disk; the route does that after.
 */

export function resolveSafeDownloadPath(
  requested: string,
  allowedRoots: readonly string[],
): string | undefined {
  if (!requested || requested.includes("\0")) return undefined;

  const withForwardSlashes = requested.replace(/\\/g, "/");
  if (withForwardSlashes.split("/").includes("..")) return undefined;

  const roots = allowedRoots.map((root) => path.resolve(root));
  const candidates = path.isAbsolute(requested)
    ? [path.resolve(requested)]
    : roots.map((root) => path.resolve(root, withForwardSlashes));

  for (const candidate of candidates) {
    for (const root of roots) {
      if (isInside(candidate, root)) return candidate;
    }
  }

  return undefined;
}

function isInside(full: string, root: string): boolean {
  const relative = path.relative(root, full);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
