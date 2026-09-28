import type { AgentFailureReason } from "../../shared/agentos-types";
import type { MailBucket, MailCategory } from "../../shared/mail-types";
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

/** Jev accepts a string or a structured object/array wherever instructions or criteria go. */
type JevText = string | Record<string, unknown> | unknown[];

type JevQuestion =
  | { type: "choice"; instructions: JevText; criteria: Record<string, JevText> }
  | { type: "noul"; instructions: JevText; criteria: Record<string, JevText> }
  | { type: "score"; instructions: JevText; criteria: JevText[] };

interface JevRequestBody {
  model: string;
  state: Record<string, unknown>;
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

/**
 * Each category spells out what it is *not* as well as what it is. The
 * mistakes worth preventing are between neighbours (a platform's security
 * notice is a notification, not admin; a receipt is finance, not a
 * notification).
 */
const CATEGORY_CRITERIA: Record<MailCategory, JevText> = {
  client: {
    means: "Written by, or about work for, a paying client or a named prospect the recipient is dealing with",
    not: "Automated mail from a company's platform, even one the recipient pays for",
  },
  sales: {
    means: "A person asking about buying, pricing, a partnership, or new business",
    not: "Marketing or promotional mail sent to many people",
  },
  finance: {
    means: "Invoices, payments, receipts, payouts, bank or brokerage statements, tax: anything about money moving",
    not: "Security or login alerts from a bank or broker, which are notifications",
  },
  admin: {
    means: "Operational matters a person handles: vendors, contracts, scheduling, account setup, tools the recipient manages",
  },
  notification: {
    means: "An automated message from a service: alerts, monitoring, security codes, login or security notices, status updates",
  },
  newsletter: {
    means: "A newsletter, digest, or content the recipient subscribed to",
  },
  personal: {
    means: "Personal correspondence from friends or family, unrelated to work",
  },
  spam: {
    means: "Unsolicited promotion, cold outreach at scale, or likely phishing",
  },
};

function isMailCategory(value: string): value is MailCategory {
  return Object.prototype.hasOwnProperty.call(CATEGORY_CRITERIA, value);
}

/** What each status means to the recipient, in the words Jev sees in `recipient_corrections`. */
const BUCKET_MEANING: Record<MailBucket, string> = {
  needs_you: "Needs me: I have to reply or act on this",
  fyi: "FYI: worth knowing, no reply or action needed",
  low_priority: "Low priority: I don't need to see this",
};

/** An earlier thread the recipient re-sorted by hand. */
export interface ClassifyCorrectionExample {
  from: string;
  subject: string;
  snippet: string;
  bucket?: MailBucket;
  category?: MailCategory;
}

export interface ClassifyThreadInput {
  from: string;
  subject: string;
  snippet: string;
  /** ISO 8601. */
  date: string;
  /** The recipient's most relevant past corrections — the closest thing Jev has to learning. */
  corrections?: readonly ClassifyCorrectionExample[];
}

export interface ClassificationResult {
  category: MailCategory;
  needsReply: number;
  urgency: number;
  business: string;
  financial: number;
  actionRequired: number;
  automated: number;
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
 * Every question gets the same reminder: follow the recipient's own
 * corrections where this email resembles one. Jev has no training endpoint,
 * so corrections travel as worked examples in `state` instead.
 */
function withCorrections(question: string, hasCorrections: boolean): JevText {
  if (!hasCorrections) return question;
  return {
    question,
    guidance:
      "`recipient_corrections` lists earlier emails the recipient re-sorted by hand. Where this email is like one of them (same sender, or the same kind of message), answer the way that correction implies.",
  };
}

/**
 * Classifies one thread through Jev.
 *
 * `state` is deliberately narrow — sender, subject, snippet, date, never a
 * full body — plus the recipient's own corrections of earlier threads.
 * `business`'s criteria are rebuilt from the live project list on every
 * call, so a project added or renamed in AgentOS is reflected the next time
 * a thread is classified, with no separate sync step of its own.
 */
export async function classifyThread(input: ClassifyThreadInput): Promise<ClassificationResult> {
  const projects = await getProjects("live");

  const businessCriteria: Record<string, string> = {
    none: "Not related to any tracked project or business",
  };
  for (const project of projects) {
    businessCriteria[project.name] = `Related to the ${project.name} project`;
  }

  const corrections = input.corrections ?? [];
  const hasCorrections = corrections.length > 0;

  const state: Record<string, unknown> = {
    email: { from: input.from, subject: input.subject, snippet: input.snippet, date: input.date },
    recipient: {
      role: "The owner of this inbox. Runs several businesses and wants only mail that needs them surfaced",
      tracked_projects: projects.map((project) => project.name),
    },
  };
  if (hasCorrections) {
    state.recipient_corrections = corrections.map((correction) => ({
      email: { from: correction.from, subject: correction.subject, snippet: correction.snippet },
      ...(correction.bucket ? { recipient_said: BUCKET_MEANING[correction.bucket] } : {}),
      ...(correction.category ? { correct_category: correction.category } : {}),
    }));
  }

  const body: JevRequestBody = {
    model: JEV_MODEL,
    state,
    questions: {
      category: {
        type: "choice",
        instructions: withCorrections("Which category best describes `email`?", hasCorrections),
        criteria: CATEGORY_CRITERIA,
      },
      needs_reply: {
        type: "noul",
        instructions: withCorrections(
          "Is a person waiting on a written reply from the recipient to `email`?",
          hasCorrections,
        ),
        criteria: {
          true: "A person asked the recipient something or is waiting to hear back",
          false:
            "Nobody is waiting on a reply, including automated alerts, codes, receipts, newsletters, and no-reply senders",
        },
      },
      urgency: {
        type: "score",
        instructions: withCorrections("How soon does the recipient need to deal with `email`?", hasCorrections),
        criteria: [
          "Never: safe to ignore entirely",
          "Whenever convenient: no deadline or consequence",
          "This week: a soft deadline or a person gently waiting",
          "Today: a real deadline, a blocked person, or money at stake",
          "Right now: an outage, a security breach on the recipient's own account, or an imminent hard deadline",
        ],
      },
      business: {
        type: "choice",
        instructions: "Which tracked project or business in `recipient.tracked_projects` does `email` relate to, if any?",
        criteria: businessCriteria,
      },
      financial: {
        type: "noul",
        instructions: "Does `email` involve money: an invoice, payment, receipt, or financial decision?",
        criteria: {
          true: "Involves an invoice, payment, receipt, payout, or financial decision",
          false: "Not about money, including security or login notices from a bank or broker",
        },
      },
      action_required: {
        type: "noul",
        instructions: withCorrections(
          "Must the recipient personally do something because of `email`: approve, pay, sign, review, fix, or decide?",
          hasCorrections,
        ),
        criteria: {
          true: "There is a specific task the recipient must do, and something goes wrong if they don't",
          false:
            "Nothing needs doing, or the email only informs, including one-time codes the recipient already requested and routine notices",
        },
      },
      automated: {
        type: "noul",
        instructions: "Was `email` generated by a system or sent in bulk, rather than written by a person to the recipient?",
        criteria: {
          true: "An automated alert, notification, code, receipt, newsletter, or mass mailing",
          false: "A person wrote this to the recipient",
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
  const automated = answerAs(response.answers, "automated", "noul");

  return {
    category: isMailCategory(category.choice) ? category.choice : "admin",
    needsReply: needsReply.noul,
    urgency: urgency.score,
    business: business.choice,
    financial: financial.noul,
    actionRequired: actionRequired.noul,
    automated: automated.noul,
  };
}
