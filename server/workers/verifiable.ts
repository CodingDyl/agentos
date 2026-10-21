import { BROWSER_CHECK_SCRIPT } from "./browser-check";

/**
 * What a worker can actually check, on this machine, in its checkout.
 *
 * A criterion the worker cannot verify here ("works in every browser and on
 * every device") can never be met, so the review keeps sending the job back
 * and the worker keeps failing to install tools it is not allowed to run.
 * These rules travel to scoping (so such criteria are never written), to the
 * worker (so it stops rather than waits) and to the reviewer (so it does not
 * ask for them).
 */

/** Browser and visual checks: one browser is the standard. */
export const ONE_BROWSER_RULE =
  "Browser and visual checks use one browser: Chromium (Playwright or headless Chrome), at named viewport widths. Never require Firefox, Safari/WebKit, other browsers, or physical devices unless the task explicitly names them.";

/** What makes a criterion checkable by a worker here. */
export const VERIFIABLE_CRITERIA_RULE = [
  "Every acceptance criterion must be checkable by the worker inside its checkout on this machine, with tools already installed.",
  ONE_BROWSER_RULE,
  "No criteria that need real users, paid accounts, external services, network installs, or the operator's own decisions.",
].join(" ");

/** For the worker: say so and stop, rather than wait on something that will not come. */
export const WORKER_TOOLING_RULE = [
  ONE_BROWSER_RULE,
  "Do not install browsers or other large tools, and do not start long background installs.",
  "If something you need is missing or a command is refused, say so in your summary and stop; do not wait for it.",
  "Pass options as command arguments, not as environment-variable prefixes (FOO=1 node x.js is refused; node x.js --foo is not).",
  `After you finish, AgentOS builds the project and opens it in Chromium at five widths itself, and the reviewer sees the result. To look before then, run the same check: node ${BROWSER_CHECK_SCRIPT} --project . --out /tmp/agentos-browser-check (it starts the site, takes screenshots and lists problems).`,
].join(" ");
