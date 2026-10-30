/**
 * The environment `npm test` runs with.
 *
 * AgentOS loads the owner's `.env` (real API keys, `AGENTOS_ROOT`, service
 * URLs) into its own process, and a worker job's validation hands that whole
 * environment to `npm test`. CI has none of it, so tests passed there and
 * failed or reached real services here. Tests get only what a bare machine has.
 */

const EXACT = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "TZ",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "CI",
  "GITHUB_ACTIONS",
  "RUNNER_TEMP",
  "RUNNER_OS",
]);

const PREFIXES = ["LC_", "NODE_", "npm_config_"];

export function cleanTestEnv(
  env: NodeJS.ProcessEnv,
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const kept: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (EXACT.has(name) || PREFIXES.some((prefix) => name.startsWith(prefix))) kept[name] = value;
  }
  return { ...kept, ...extra };
}
