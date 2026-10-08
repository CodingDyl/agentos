import { MailComposeRequestSchema, type MailComposeInput, type MailComposeResult } from "../../../shared/mail-compose-types";
import { decide, type CapabilityDecision, type Initiator } from "../../connectors/policy";
import { composeMail } from "../../mail/compose";
import type { JarvisWorker } from "../jarvis-worker-registry";

/**
 * Sends a draft Jarvis wrote, as an email.
 *
 * Two gates, neither of which a model can open:
 *
 * 1. The connector policy for `gmail.send`, the same check every send in
 *    AgentOS passes. Off or disabled means no, with the reason.
 * 2. Your spoken or typed "confirm". Sending is external communication, and
 *    Jarvis follows the same rule as on Operator: a mis-heard word must not
 *    be able to send mail. The worker prepares the send; only the
 *    deterministic confirmation path executes it.
 *
 * Never retried automatically: a send that failed half-way may have gone.
 */

const CAPABILITY = "gmail.send";
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[A-Za-z]{2,}$/;

export interface MailSendDeps {
  decide: (capabilityId: string, initiator: Initiator) => CapabilityDecision;
  send: (input: MailComposeInput) => Promise<MailComposeResult>;
}

const defaultDeps: MailSendDeps = { decide, send: (input) => composeMail(input) };

function recipientFrom(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const address = value.trim().replace(/^<|>$/g, "");
  return EMAIL.test(address) ? address : undefined;
}

export function mailSendWorker(deps: MailSendDeps = defaultDeps): JarvisWorker {
  return {
    id: "mail.send_draft",
    name: "Send a draft by email",
    description: "Emails a draft Jarvis wrote in this conversation, from Gmail. Always asks you to confirm before sending.",
    capabilities: [CAPABILITY],
    intents: ["act"],
    requiredInputs: [
      { name: "output_id", description: "The draft to send", source: "output_reference" },
      { name: "to", description: "The recipient's full email address, exactly as said" },
    ],
    optionalInputs: [{ name: "subject", description: "Email subject; defaults to the draft's title" }],
    safeRetry: false,
    async run({ inputs, output, conversationId, store }) {
      if (!output) return { status: "needs_input", reply: "Which draft should I send?" };

      const to = recipientFrom(inputs.to);
      if (!to) {
        return {
          status: "needs_input",
          reply: typeof inputs.to === "string" && inputs.to.trim()
            ? `"${inputs.to}" isn't a full email address. Who should I send ${output.title} to?`
            : `Who should I send ${output.title} to? I need their email address.`,
        };
      }

      // Asked as an agent: this tells us whether sending is possible at all,
      // and whether the policy wants a person in the loop (it always gets one here).
      const decision = deps.decide(CAPABILITY, "agent");
      if (!decision.allowed && decision.code !== "approval-required") {
        return { status: "failed", reply: `I can't send email: ${decision.reason} Nothing was sent.` };
      }

      const subject = typeof inputs.subject === "string" && inputs.subject.trim() ? inputs.subject.trim().slice(0, 400) : output.title;
      store.setPendingAction(conversationId, { workerId: "mail.send_draft", summary: `Send "${output.title}" to ${to}`, inputs: { to, subject }, outputId: output.id });
      return {
        status: "awaiting_confirmation",
        reply: `Ready to email "${output.title}" to ${to} from Gmail, subject "${subject}". Say confirm to send it, or cancel.`,
      };
    },
    async executeConfirmed({ pendingInputs, output }) {
      if (!output) return { status: "failed", reply: "That draft is no longer in this conversation, so nothing was sent." };

      // Your confirmation is the approval, so the check is now the one a button press passes.
      const decision = deps.decide(CAPABILITY, "person");
      if (!decision.allowed) return { status: "failed", reply: `I can't send it: ${decision.reason} Nothing was sent.` };

      const parsed = MailComposeRequestSchema.safeParse({ mode: "send", to: [pendingInputs.to], subject: pendingInputs.subject, body: output.text });
      if (!parsed.success) return { status: "failed", reply: `That email isn't valid: ${parsed.error.issues[0]?.message ?? "unknown problem"}. Nothing was sent.` };

      try {
        const result = await deps.send(parsed.data);
        const warning = result.warning ? ` ${result.warning}` : "";
        return { status: "completed", reply: `Sent "${output.title}" to ${pendingInputs.to}.${warning}` };
      } catch (error) {
        return {
          status: "failed",
          reply: `Sending failed: ${error instanceof Error ? error.message : "unknown error"}. I haven't retried, because it may have partly gone. Check Sent in Gmail before trying again.`,
        };
      }
    },
  };
}
