import { authorize } from "../connectors/policy";

/**
 * Apollo, for finding who runs a business and their email address.
 *
 * Two steps on purpose, because only one of them costs anything:
 *
 * - `searchPeopleAtDomain` lists people with an owner-type title at a company
 *   domain. Free, and returns names and titles but no addresses.
 * - `revealEmail` asks Apollo for one person's address. That is the step that
 *   spends a credit, so it only runs when a person presses Reveal on that
 *   name, never in bulk and never on its own.
 *
 * The key lives in `.env`, rides in a header, and is never logged or returned.
 */

const BASE = "https://api.apollo.io/api/v1";
const TIMEOUT_MS = 20_000;
const OWNER_TITLES = ["owner", "founder", "co-founder", "managing director", "director", "ceo", "general manager", "manager"];

export class ApolloError extends Error {
  constructor(
    message: string,
    readonly reason: "not-configured" | "off" | "unauthorized" | "plan" | "failed" | "no-credits",
  ) {
    super(message);
    this.name = "ApolloError";
  }
}

export interface ApolloPerson {
  id: string;
  firstName: string;
  /** Apollo hides most of the surname until the person is revealed. */
  lastName: string;
  title: string;
}

export function isApolloConfigured(): boolean {
  return Boolean(process.env.APOLLO_API_KEY?.trim());
}

function key(): string {
  const value = process.env.APOLLO_API_KEY?.trim();
  if (!value) throw new ApolloError("APOLLO_API_KEY is not set. Add it in Connectors → Apollo.", "not-configured");
  return value;
}

async function call(path: string, body: unknown): Promise<unknown> {
  const apiKey = key();
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "Cache-Control": "no-cache" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApolloError("Could not reach Apollo.", "failed");
  }

  if (response.status === 401 || response.status === 403) {
    const failure = (await response.json().catch(() => ({}))) as { error_code?: unknown };
    // A valid key on a plan without API access is a different problem from a bad key, and fixing the wrong one wastes a trip to Apollo.
    if (failure.error_code === "API_INACCESSIBLE") {
      throw new ApolloError(
        "Your key is fine, but Apollo's Free plan does not include API access to people search or email reveal. Upgrade the plan to use it from AgentOS.",
        "plan",
      );
    }
    throw new ApolloError(
      "Apollo refused the key. It needs to be a master API key (Apollo → Settings → Integrations → API).",
      "unauthorized",
    );
  }
  if (response.status === 402 || response.status === 429) {
    throw new ApolloError("Apollo says the credits or rate limit for this plan are used up.", "no-credits");
  }
  if (!response.ok) throw new ApolloError(`Apollo answered ${response.status}.`, "failed");
  return response.json().catch(() => ({}));
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Owner-type people at a company domain, best title first. Costs no credits. */
export async function searchPeopleAtDomain(domain: string, perPage = 8): Promise<ApolloPerson[]> {
  const payload = (await call("/mixed_people/api_search", {
    q_organization_domains_list: [domain],
    person_titles: OWNER_TITLES,
    per_page: perPage,
    page: 1,
  })) as { people?: unknown };

  const people = Array.isArray(payload.people) ? payload.people : [];
  const parsed = people
    .map((entry): ApolloPerson | undefined => {
      const person = entry as Record<string, unknown>;
      const id = text(person.id);
      return id
        ? { id, firstName: text(person.first_name), lastName: text(person.last_name_obfuscated ?? person.last_name), title: text(person.title) }
        : undefined;
    })
    .filter((person): person is ApolloPerson => person !== undefined);

  const rank = (title: string) => {
    const index = OWNER_TITLES.findIndex((word) => title.toLowerCase().includes(word));
    return index === -1 ? OWNER_TITLES.length : index;
  };
  return parsed.sort((a, b) => rank(a.title) - rank(b.title));
}

/** One person's email. Spends an Apollo credit when it finds one; nothing when it does not. */
export async function revealEmail(personId: string, domain: string): Promise<{ address: string; verified: boolean } | undefined> {
  const payload = (await call("/people/match", { id: personId, domain })) as { person?: Record<string, unknown> };
  const email = text(payload.person?.email);
  if (!email || !email.includes("@") || /not_unlocked|email_not_unlocked/i.test(email)) return undefined;
  return { address: email.toLowerCase(), verified: text(payload.person?.email_status) === "verified" };
}

/** Gate for the two route handlers: Apollo must be switched on, and the capability allowed. */
export function allow(capability: "search_people" | "reveal_email", detail: string): void {
  const decision = authorize(`apollo.${capability}`, { initiator: "person", detail });
  if (!decision.allowed) throw new ApolloError(decision.reason, "off");
}
