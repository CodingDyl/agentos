import fs from "node:fs/promises";
import path from "node:path";

async function exists(target: string): Promise<boolean> {
  return fs.access(target).then(
    () => true,
    () => false,
  );
}

/**
 * The command that installs a folder's dependencies, or `undefined` when none
 * is needed.
 *
 * `node_modules` is gitignored, so it lives only in whichever checkout ran
 * `npm install`. A lockfile means `npm ci`, which installs exactly what was
 * locked; without one, `npm install`. Shared by worker validation and the Dev
 * tab so both install the same way the operator would by hand.
 */
export async function installCommandFor(cwd: string): Promise<string | undefined> {
  if (!(await exists(path.join(cwd, "package.json")))) return undefined;
  if (await exists(path.join(cwd, "node_modules"))) return undefined;

  return (await exists(path.join(cwd, "package-lock.json"))) ? "npm ci" : "npm install";
}
