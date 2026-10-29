import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Chat tools that act outside AgentOS: sending an email, starting a worker
 * job (which spends). Each needs the operator's own OK for that exact action.
 *
 * The OK is the chat's existing approval (a click, or Jarvis's "allow" then
 * "confirm"), so there is no second approval system. What this adds is the
 * server's own check that the approval happened: when the operator allows a
 * call, a one-use grant is recorded for a digest of exactly what they were
 * shown, and the tool refuses to act unless it can spend a matching grant.
 * A different recipient, subject, body or brief, a grant used twice, or one
 * older than `GRANT_TTL_MS` is refused.
 *
 * Kept free of the Agent SDK so the permission policy can load it.
 */

/** Matches `AGENTOS_TOOL_PREFIX` in agentos-tools.ts. */
const PREFIX = "mcp__agentos__";

/** Long enough to read an email and say confirm; short enough that an old OK can't be reused. */
export const GRANT_TTL_MS = 5 * 60_000;

const email = z.string().trim().email("Use a full email address.").max(320);

export const SendEmailInputSchema = z.object({
  to: z.array(email).min(1).max(20),
  cc: z.array(email).max(20).optional(),
  subject: z.string().trim().min(1).max(400),
  body: z.string().min(1).max(50_000),
  replyToThreadId: z.string().min(1).max(200).optional(),
});
export type SendEmailInput = z.infer<typeof SendEmailInputSchema>;

export const StartJobInputSchema = z.object({
  project: z.string().trim().min(1).max(120),
  objective: z.string().trim().min(1).max(4000),
  agentId: z.string().trim().min(1).max(120).optional(),
});
export type StartJobInput = z.infer<typeof StartJobInputSchema>;

const GATED = {
  send_email: {
    schema: SendEmailInputSchema,
    reason: "Sends an email from your mailbox. Check the recipient, subject and body.",
    describe: (input: SendEmailInput) => ({
      summary: `email to ${input.to.join(", ")}${input.cc?.length ? ` (cc ${input.cc.join(", ")})` : ""}, subject "${input.subject}"`,
      detail: [`To: ${input.to.join(", ")}`, ...(input.cc?.length ? [`Cc: ${input.cc.join(", ")}`] : []), `Subject: ${input.subject}`, "", input.body].join("\n"),
    }),
  },
  start_job: {
    schema: StartJobInputSchema,
    reason: "Starts a worker job, which runs an agent and can spend credits.",
    describe: (input: StartJobInput) => ({
      summary: `job in ${input.project}${input.agentId ? ` for ${input.agentId}` : ""}: ${input.objective.split("\n")[0]}`,
      detail: [`Project: ${input.project}`, `Specialist: ${input.agentId ?? "chosen by Agents routing"}`, "", input.objective].join("\n"),
    }),
  },
} as const;

type GatedName = keyof typeof GATED;

function gatedName(toolName: string): GatedName | undefined {
  const bare = toolName.startsWith(PREFIX) ? toolName.slice(PREFIX.length) : toolName;
  return Object.hasOwn(GATED, bare) ? (bare as GatedName) : undefined;
}

export function isGatedTool(toolName: string): boolean {
  return gatedName(toolName) !== undefined;
}

export function gatedReason(toolName: string): string | undefined {
  const name = gatedName(toolName);
  return name ? GATED[name].reason : undefined;
}

/** The input as the tool will run it: parsed, so two spellings of one action share a digest. */
function canonical(name: GatedName, input: unknown): unknown {
  const parsed = GATED[name].schema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(name: GatedName, input: unknown): string | undefined {
  const value = canonical(name, input);
  return value === undefined ? undefined : createHash("sha256").update(`${name}\n${stable(value)}`).digest("hex");
}

/** What the operator is shown before they decide: one line, and the whole thing. */
export function describeGatedAction(toolName: string, input: unknown): { summary: string; detail: string } | undefined {
  const name = gatedName(toolName);
  if (!name) return undefined;
  const parsed = GATED[name].schema.safeParse(input);
  if (!parsed.success) return undefined;
  return (GATED[name].describe as (value: typeof parsed.data) => { summary: string; detail: string })(parsed.data);
}

const grants = new Map<string, number>();

function prune(now: number): void {
  for (const [key, expires] of grants) if (expires <= now) grants.delete(key);
}

/** Records the operator's OK for exactly this call. Called only from the approval path. */
export function grantAction(toolName: string, input: unknown, now = Date.now()): boolean {
  const name = gatedName(toolName);
  const key = name && digest(name, input);
  if (!key) return false;
  prune(now);
  grants.set(key, now + GRANT_TTL_MS);
  return true;
}

export type GrantCheck = { ok: true } | { ok: false; reason: string };

/** Spends the grant for this exact call, or says why there isn't one. */
export function consumeGrant(toolName: string, input: unknown, now = Date.now()): GrantCheck {
  const name = gatedName(toolName);
  const key = name && digest(name, input);
  if (!key) return { ok: false, reason: "That isn't a valid request." };
  const expires = grants.get(key);
  grants.delete(key);
  if (expires === undefined) return { ok: false, reason: "The operator hasn't confirmed this exact action." };
  if (expires <= now) return { ok: false, reason: "The operator's confirmation has expired." };
  return { ok: true };
}

/** For tests. */
export function clearGrants(): void {
  grants.clear();
}
