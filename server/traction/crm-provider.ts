import type { Prospect } from "../../shared/traction-types";
import { addDays, FOLLOW_UP_AFTER_DAYS, isoDate, PROPOSAL_FOLLOW_UP_AFTER_DAYS } from "./engine";
import { readState } from "./store";

/**
 * Where Traction's prospects come from.
 *
 * The working set of prospects — the ones AgentOS records stages, observations
 * and referral asks against — lives in the local store, because Virtec's API
 * to AgentOS is read-only and a pipeline nobody can move is not a pipeline.
 *
 * Virtec is read alongside rather than behind this interface
 * (`server/virtec/`, joined in `server/traction/crm.ts`):
 *
 * ```text
 * Virtec /api/agentos/*  ──►  server/virtec (cached, normalised)  ──►  Traction
 *                                                   │
 *                             import one lead/client ▼ (crmId links them)
 *                                          local prospect store
 * ```
 *
 * When Virtec gains write endpoints, a provider that proposes changes to it
 * can replace the local one here without the screen changing.
 *
 * Nothing here carries credentials. The Virtec key is read server-side in
 * `server/virtec/client.ts` and never reaches a response.
 */
export interface CrmProvider {
  /** A short name, shown on the screen so it is clear where the pipeline came from. */
  readonly name: string;
  getProspects(): Promise<Prospect[]>;
  getClients(): Promise<Client[]>;
  getQuotes(): Promise<Quote[]>;
  getFollowUps(): Promise<FollowUp[]>;
}

export type Client = {
  id: string;
  company: string;
  contact?: string;
  workspace?: string;
  relationship?: "strong" | "active" | "cold";
  crmId?: string;
};

export type Quote = {
  id: string;
  prospectId: string;
  company: string;
  /** When it went out, as best the provider knows. */
  sentAt: string;
  /** Free text — the local store does not hold amounts. */
  amount?: string;
};

export type FollowUp = {
  prospectId: string;
  company: string;
  contact?: string;
  /** `YYYY-MM-DD`. */
  due: string;
  action: string;
};

/**
 * The local store, presented as a CRM.
 *
 * It has no separate client or quote tables — a won prospect is a client and
 * a prospect at proposal is an open quote. That is the honest mapping for V1,
 * and exactly the shape a real CRM will fill in properly.
 */
export class LocalCrmProvider implements CrmProvider {
  readonly name = "local";

  async getProspects(): Promise<Prospect[]> {
    return (await readState()).prospects;
  }

  async getClients(): Promise<Client[]> {
    return (await this.getProspects())
      .filter((prospect) => prospect.stage === "won")
      .map((prospect) => ({
        id: prospect.id,
        company: prospect.company,
        contact: prospect.contact,
        workspace: prospect.workspace,
        relationship: prospect.relationship,
        crmId: prospect.crmId,
      }));
  }

  async getQuotes(): Promise<Quote[]> {
    return (await this.getProspects())
      .filter((prospect) => prospect.stage === "proposal")
      .map((prospect) => ({
        id: `quote:${prospect.id}`,
        prospectId: prospect.id,
        company: prospect.company,
        sentAt: prospect.stageChangedAt,
      }));
  }

  /** Every open prospect's promised next action, or the follow-up its silence implies. */
  async getFollowUps(): Promise<FollowUp[]> {
    const today = isoDate(new Date());

    return (await this.getProspects()).flatMap((prospect): FollowUp[] => {
      if (prospect.stage === "won" || prospect.stage === "lost") return [];

      if (prospect.nextActionDate) {
        return [
          {
            prospectId: prospect.id,
            company: prospect.company,
            contact: prospect.contact,
            due: prospect.nextActionDate,
            action: prospect.nextAction ?? "Next step",
          },
        ];
      }

      if (prospect.stage === "contacted" || prospect.stage === "proposal") {
        const since = isoDate(new Date(prospect.lastTouchAt ?? prospect.stageChangedAt));
        const after = prospect.stage === "proposal" ? PROPOSAL_FOLLOW_UP_AFTER_DAYS : FOLLOW_UP_AFTER_DAYS;
        const due = addDays(since, after);
        return [
          {
            prospectId: prospect.id,
            company: prospect.company,
            contact: prospect.contact,
            due: due < today ? today : due,
            action: "Follow up",
          },
        ];
      }

      return [];
    });
  }
}

let provider: CrmProvider = new LocalCrmProvider();

/** The one place the provider is chosen. */
export function crmProvider(): CrmProvider {
  return provider;
}

/** For tests, and for the day Virtec is wired in. */
export function setCrmProvider(next: CrmProvider): void {
  provider = next;
}
