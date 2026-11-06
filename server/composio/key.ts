/**
 * The key's name, and keeping it from agents. Imports nothing, because every
 * place that starts an agent loads this.
 */

export const COMPOSIO_KEY_ENV = "COMPOSIO_API_KEY";

/**
 * An agent's environment, without the key. It reaches every connected app, so
 * an agent holding it could act there without asking.
 */
export function withoutComposioKey<T extends Record<string, string | undefined>>(env: T): T {
  const copy = { ...env };
  delete copy[COMPOSIO_KEY_ENV];
  return copy;
}
