import type { AgentFailureReason } from "../../shared/agentos-types";
import type { MailCategory } from "../../shared/mail-types";
import { getProjects } from "../agentos/projects";
import { isAiEnabled, switchedOffReason } from "../ai-stack/settings";

const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";
const REQUEST_TIMEOUT_MS = 30_000;

export class JevError extends Error {
  constructor(
    message: string,
    readonly reason: AgentFailureReason,
  ) {
    super(message);
    this.name = "JevError";
  }
}

export function isJevConfigured(): boolean {
  return Boolean(process.env.JEV_API_KEY?.trim());
}

function requireApiKey(): string {
  const apiKey = process.env.JEV_API_KEY?.trim();
  if (!apiKey) {
    throw new JevError("JEV_API_KEY is not set. Copy .env.example to .env and add your key.", "not-configured");
  }
  return apiKey;
}

type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

interface JevRequestBody {
  model: string;
  state: Record<string, string>;
  questions: Record<string, JevQuestion>;
}

interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}
interface JevScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}
interface JevNoulAnswer {
  type: "noul";
  noul: number;
}
type JevAnswer = JevChoiceAnswer | JevScoreAnswer | JevNoulAnswer;

interface JevResponseBody {
  model: string;
  answers: Record<string, JevAnswer>;
}

async function sendToJev(body: JevRequestBody): Promise<JevResponseBody> {
  // Gated here, at the call, rather than in `isJevConfigured`: Mail treats an
  // unconfigured Jev as "Mail is not set up" and hides the inbox. Switching
  // classification off should stop classification, not the inbox.
  if (!isAiEnabled("jev")) {
    throw new JevError(switchedOffReason("Jev"), "not-configured");
  }

  const apiKey = requireApiKey();

  let response: Response;
  try {
    response = await fetch(JEV_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new JevError(`Jev did not answer within ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s.`, "timed-out");
    }
    throw new JevError("Could not reach Jev.", "offline");
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new JevError("Jev rejected the API key.", "unauthorized");
    }
    throw new JevError(`Jev responded with ${response.status}.`, "failed");
  }

  try {
    return (await response.json()) as JevResponseBody;
  } catch {
    throw new JevError("Jev returned an unreadable response.", "failed");
  }
}

const CATEGORY_CRITERIA: Record<MailCategory, string> = {
  client: "From or about a paying client or prospective client",
  sales: "A sales inquiry, pricing question, or new business lead",
  finance: "Invoices, payments, receipts, or other money matters",
  admin: "Operational or administrative — vendors, tools, scheduling",
  notification: "An automated notification from a service or platform",
  newsletter: "A subscribed newsletter or digest",
  personal: "Personal correspondence unrelated to work",
  spam: "Unsolicited or promotional mail",
};

function isMailCategory(value: string): value is MailCategory {
  return Object.prototype.hasOwnProperty.call(CATEGORY_CRITERIA, value);
}

export interface ClassifyThreadInput {
  from: string;
  subject: string;
  snippet: string;
  /** ISO 8601. */
  date: string;
}

export interface ClassificationResult {
  category: MailCategory;
  needsReply: number;
  urgency: number;
  business: string;
  financial: number;
  actionRequired: number;
}

function answerAs<T extends JevAnswer["type"]>(
  answers: Record<string, JevAnswer>,
  key: string,
  type: T,
): Extract<JevAnswer, { type: T }> {
  const answer = answers[key];
  if (!answer || answer.type !== type) {
    throw new JevError("Jev returned an answer in an unexpected shape.", "failed");
  }
  return answer as Extract<JevAnswer, { type: T }>;
}

/**
 * Classifies one thread through Jev.
 *
 * `state` is deliberately narrow — sender, subject, snippet, date, never a
 * full body. `business`'s criteria are rebuilt from the live project list on
 * every call, so a project added or renamed in AgentOS is reflected the next
 * time a thread is classified, with no separate sync step of its own.
 */
export async function classifyThread(input: ClassifyThreadInput): Promise<ClassificationResult> {
  const projects = await getProjects("live");

  const businessCriteria: Record<string, string> = {
    none: "Not related to any tracked project or business",
  };
  for (const project of projects) {
    businessCriteria[project.name] = `Related to the ${project.name} project`;
  }

  const body: JevRequestBody = {
    model: JEV_MODEL,
    state: { from: input.from, subject: input.subject, snippet: input.snippet, date: input.date },
    questions: {
      category: {
        type: "choice",
        instructions: "Which category best describes this email?",
        criteria: CATEGORY_CRITERIA,
      },
      needs_reply: {
        type: "noul",
        instructions: "Does this email require a reply from the recipient?",
        criteria: {
          true: "The sender expects or is waiting on a reply",
          false: "No reply is expected",
        },
      },
      urgency: {
        type: "score",
        instructions: "How urgent is this for the recipient to act on?",
        criteria: ["Not urgent", "Low", "Medium", "High", "Critical"],
      },
      business: {
        type: "choice",
        instructions: "Which tracked project or business does this relate to, if any?",
        criteria: businessCriteria,
      },
      financial: {
        type: "noul",
        instructions: "Does this email involve money — an invoice, payment, receipt, or financial decision?",
        criteria: {
          true: "Involves an invoice, payment, receipt, or financial decision",
          false: "Not related to money",
        },
      },
      action_required: {
        type: "noul",
        instructions:
          "Does this email require the recipient to take an action beyond replying, such as approving, paying, signing, or reviewing something?",
        criteria: {
          true: "Requires an action beyond a reply",
          false: "No action required beyond an optional reply",
        },
      },
    },
  };

  const response = await sendToJev(body);

  const category = answerAs(response.answers, "category", "choice");
  const needsReply = answerAs(response.answers, "needs_reply", "noul");
  const urgency = answerAs(response.answers, "urgency", "score");
  const business = answerAs(response.answers, "business", "choice");
  const financial = answerAs(response.answers, "financial", "noul");
  const actionRequired = answerAs(response.answers, "action_required", "noul");

  return {
    category: isMailCategory(category.choice) ? category.choice : "admin",
    needsReply: needsReply.noul,
    urgency: urgency.score,
    business: business.choice,
    financial: financial.noul,
    actionRequired: actionRequired.noul,
  };
}
