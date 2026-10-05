/**
 * What a person types in a worker's Model field, turned into what its CLI
 * accepts. "Opus 5.5" is how a model is talked about; Claude Code wants
 * `claude-opus-5-5` (or the alias `opus`), and passing the display name
 * makes it exit with `unrecognized_model` before doing any work.
 */

const CLAUDE_NAME = /^(?:claude[\s-]*)?(opus|sonnet|haiku|fable)(?:[\s-]*(\d+)(?:[.\s-]+(\d+))?)?$/i;

export function normaliseWorkerModel(workerId: string, value: string | undefined): { model?: string; error?: string } {
  const trimmed = value?.trim();
  if (!trimmed) return {};

  if (workerId === "claude-code") {
    const match = CLAUDE_NAME.exec(trimmed);
    if (match) {
      const [, family, major, minor] = match;
      const name = family.toLowerCase();
      // No version: Claude Code's own alias, which follows the latest model of that family.
      if (!major) return { model: name };
      return { model: `claude-${name}-${major}${minor ? `-${minor}` : ""}` };
    }
  }

  // Model ids never contain spaces; a name with spaces is a display name the CLI will refuse.
  if (/\s/.test(trimmed)) {
    return { error: `"${trimmed}" is a display name, not a model ID. Use an ID such as ${workerId === "claude-code" ? "claude-opus-5-5, or an alias such as opus" : "the one the tool's own docs list"}, or leave it empty for the tool's default.` };
  }
  return { model: trimmed };
}
