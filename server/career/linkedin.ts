import { authorize } from "../connectors/policy";

/**
 * LinkedIn, for posting as the signed-in member only.
 *
 * Posting uses LinkedIn's Posts API with a member token carrying
 * `w_member_social` (from LinkedIn's developer portal, "Share on LinkedIn"
 * product). Messaging is not here on purpose: LinkedIn's messaging APIs are
 * restricted partner programmes, so Career opens linkedin.com/messaging
 * instead of scraping it.
 *
 * Every publish is a person pressing Publish on a post they approved; an
 * agent is refused by the capability's `approval` policy.
 */

const API = "https://api.linkedin.com";
export const LINKEDIN_PROFILE_URL = "https://www.linkedin.com/in/me/";
export const LINKEDIN_MESSAGES_URL = "https://www.linkedin.com/messaging/";

export class LinkedInError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

export function linkedInToken(): string | undefined {
  return process.env.LINKEDIN_ACCESS_TOKEN?.trim() || undefined;
}

/** LinkedIn's versioned API wants a `YYYYMM` it still supports. Overridable when it ages out. */
function apiVersion(): string {
  const configured = process.env.LINKEDIN_API_VERSION?.trim();
  return configured && /^\d{6}$/.test(configured) ? configured : "202509";
}

export function linkedInReadiness(): { canPublish: boolean; detail?: string } {
  return linkedInToken()
    ? { canPublish: true }
    : { canPublish: false, detail: "Add LINKEDIN_ACCESS_TOKEN (with w_member_social) in Connectors → LinkedIn to publish from here." };
}

/** Commentary is LinkedIn "little text": these characters must be escaped or the post is cut short. */
export function escapeLittleText(text: string): string {
  return text.replace(/[\\|{}@[\]()<>#*_~]/g, (character) => `\\${character}`);
}

async function memberUrn(token: string): Promise<string> {
  const configured = process.env.LINKEDIN_PERSON_URN?.trim();
  if (configured && /^urn:li:person:[A-Za-z0-9_-]{1,64}$/.test(configured)) return configured;

  let response: Response;
  try {
    response = await fetch(`${API}/v2/userinfo`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new LinkedInError("Couldn't reach LinkedIn.");
  }
  if (response.status === 401) throw new LinkedInError("LinkedIn rejected LINKEDIN_ACCESS_TOKEN.");
  if (!response.ok) {
    throw new LinkedInError("LinkedIn would not say who the token belongs to. Set LINKEDIN_PERSON_URN, or add the openid and profile scopes.");
  }
  const body = (await response.json().catch(() => ({}))) as { sub?: unknown };
  if (typeof body.sub !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(body.sub)) throw new LinkedInError("LinkedIn's answer had no member id.");
  return `urn:li:person:${body.sub}`;
}

export async function testLinkedIn(): Promise<{ ok: boolean; detail: string; account?: string }> {
  const token = linkedInToken();
  if (!token) return { ok: false, detail: "LINKEDIN_ACCESS_TOKEN is not set." };
  try {
    const urn = await memberUrn(token);
    return { ok: true, detail: `Token accepted for ${urn}.` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "The LinkedIn test failed." };
  }
}

/** Publishes `text` publicly as the member. Returns the post's URN and a link to it. */
export async function publishToLinkedIn(text: string, postId: string): Promise<{ postUrn: string; url: string }> {
  const decision = authorize("linkedin.publish_post", { initiator: "person", detail: postId });
  if (!decision.allowed) throw new LinkedInError(decision.reason, 403);

  const token = linkedInToken();
  if (!token) throw new LinkedInError("LINKEDIN_ACCESS_TOKEN is not set.", 400);
  const author = await memberUrn(token);

  let response: Response;
  try {
    response = await fetch(`${API}/rest/posts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "LinkedIn-Version": apiVersion(),
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author,
        commentary: escapeLittleText(text),
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new LinkedInError("Couldn't reach LinkedIn. The post was not published.");
  }

  if (response.status === 401) throw new LinkedInError("LinkedIn rejected the token. The post was not published.");
  if (response.status === 403) throw new LinkedInError("The token lacks w_member_social. The post was not published.");
  if (response.status === 426) throw new LinkedInError("LinkedIn no longer supports this API version. Set LINKEDIN_API_VERSION.");
  if (!response.ok) throw new LinkedInError(`LinkedIn responded with ${response.status}. The post was not published.`);

  const postUrn = response.headers.get("x-restli-id") ?? "";
  return { postUrn, url: postUrn ? `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}/` : LINKEDIN_PROFILE_URL };
}
