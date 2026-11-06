import type { CapabilityPolicy } from "@shared/connector-types";
import type { ComposioActionClass, ComposioApp } from "@shared/composio-types";

/**
 * The Composio section's wording, kept out of the components so it can be
 * tested: an app with an expired sign-in must never read as working, and a
 * policy must say what an agent will actually do.
 */

export const ACTION_CLASSES: readonly { id: ComposioActionClass; label: string; hint: string }[] = [
  { id: "read", label: "Reading", hint: "Looking things up. Changes nothing." },
  { id: "change", label: "Creating, updating and sending", hint: "Anything Composio doesn't mark as read-only, including messages to people." },
  { id: "delete", label: "Deleting and moving money", hint: "Can't be cleanly taken back." },
];

const POLICY_WORD: Record<CapabilityPolicy, string> = { allowed: "allowed", approval: "ask first", disabled: "off" };

/** "Reads allowed · changes ask first · deletes off" */
export function policySummary(policies: ComposioApp["policies"]): string {
  return `Reads ${POLICY_WORD[policies.read]} · changes ${POLICY_WORD[policies.change]} · deletes ${POLICY_WORD[policies.delete]}`;
}

/** "2 accounts", with the number signed out when any have lapsed. */
export function accountSummary(accounts: ComposioApp["accounts"]): string {
  const lapsed = accounts.filter((account) => account.status !== "ACTIVE").length;
  const total = `${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}`;
  return lapsed > 0 ? `${total}, ${lapsed} signed out` : total;
}

/** Whether an agent can reach this app right now: on, with an account that is signed in. */
export function isAppUsable(app: Pick<ComposioApp, "enabled" | "accounts">): boolean {
  return app.enabled && app.accounts.some((account) => account.status === "ACTIVE");
}

export function needsSignIn(app: Pick<ComposioApp, "accounts">): boolean {
  return app.accounts.length > 0 && app.accounts.every((account) => account.status !== "ACTIVE");
}
