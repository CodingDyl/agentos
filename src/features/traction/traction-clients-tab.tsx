import { Check, PenLine } from "lucide-react";
import { Link } from "react-router-dom";
import type { Prospect, TractionData } from "@shared/traction-types";
import { PAPER_FOCUS, PaperButton, PaperSection, Tag } from "@/components/paper";
import { useProjects } from "@/lib/agentos/queries";
import { useQueueAction } from "@/lib/agentos/traction";
import { cn } from "@/lib/utils";
import { formatShortDate, hermesHref, hermesPrompt, prospectHref } from "./traction-model";

/**
 * Clients and referral opportunities.
 *
 * While lead volume is low, a few good introductions beat a hundred cold
 * emails — and the right moment to ask is when the relationship is warm and
 * the work is going well. So each client shows how warm it is, where their
 * work stands, and whether the ask has been made.
 */

const RELATIONSHIP_TONE = { strong: "green", active: "marigold", cold: "muted" } as const;

function asked(prospect: Prospect): boolean {
  return Boolean(prospect.referralAskedAt);
}

export function TractionClientsTab({ data }: { data: TractionData }) {
  const { data: projects } = useProjects();
  const action = useQueueAction();

  // Unasked, warmest first: the list is also the order to ask in.
  const clients = data.prospects
    .filter((prospect) => prospect.stage === "won")
    .sort((a, b) => {
      const byAsked = Number(asked(a)) - Number(asked(b));
      if (byAsked !== 0) return byAsked;
      const rank = { strong: 0, active: 1, cold: 2 };
      return rank[a.relationship ?? "cold"] - rank[b.relationship ?? "cold"];
    });

  const projectState = (slug: string | undefined) => projects?.projects.find((project) => project.slug === slug);

  return (
    <PaperSection label="Clients & referral opportunities" count={clients.length}>
      {clients.length === 0 ? (
        <p className="max-w-[60ch] text-[14px] leading-6 text-paper-char">
          No clients recorded yet. Move a prospect to Won, and set how warm the relationship is, to see referral opportunities here.
        </p>
      ) : (
        <ul className="divide-y divide-paper-mist border-y border-paper-mist">
          {clients.map((client) => {
            const project = projectState(client.workspace);
            const prompt = hermesPrompt({
              prospect: client,
              item: { id: `referral:${client.id}`, kind: "referral", prospectId: client.id, title: "", detail: [] },
              icp: data.icp,
              offers: data.offers,
              gaps: [],
            }).prompt;
            const pending = action.isPending && action.variables?.itemId === `referral:${client.id}`;

            return (
              <li key={client.id} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <Link to={prospectHref(client.id)} className={cn("rounded-[2px] text-[15px] font-semibold text-paper-moss hover:underline", PAPER_FOCUS)}>
                    {client.company}
                  </Link>
                  <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                    <div className="flex items-center gap-1.5">
                      <dt className="text-paper-sage">Relationship</dt>
                      <dd>
                        {client.relationship ? (
                          <Tag tone={RELATIONSHIP_TONE[client.relationship]}>{client.relationship}</Tag>
                        ) : (
                          <span className="text-paper-ash">not set</span>
                        )}
                      </dd>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <dt className="text-paper-sage">Project</dt>
                      <dd className="text-paper-char">
                        {client.workspace ? (
                          <Link to={`/workspaces/${encodeURIComponent(client.workspace)}`} className={cn("text-paper-blue hover:underline", PAPER_FOCUS)}>
                            {project ? `${project.name} · ${project.state}` : client.workspace}
                          </Link>
                        ) : (
                          <span className="text-paper-ash">no workspace linked</span>
                        )}
                      </dd>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <dt className="text-paper-sage">Referral asked</dt>
                      <dd className={asked(client) ? "text-paper-moss" : "font-semibold text-paper-moss"}>
                        {client.referralAskedAt ? formatShortDate(client.referralAskedAt) : "No"}
                      </dd>
                    </div>
                  </dl>
                </div>

                {asked(client) ? null : (
                  <div className="flex flex-wrap gap-1.5 sm:justify-end">
                    <Link
                      to={hermesHref(prompt)}
                      className={cn(
                        "inline-flex min-h-8 items-center gap-1.5 rounded-none border-[1.5px] border-paper-gold px-3 text-[13.5px] font-semibold text-paper-moss hover:bg-paper-linen",
                        PAPER_FOCUS,
                      )}
                    >
                      <PenLine className="size-3.5" aria-hidden="true" />
                      Prepare ask
                    </Link>
                    <PaperButton
                      disabled={pending}
                      onClick={() => action.mutate({ itemId: `referral:${client.id}`, action: { action: "done" } })}
                      aria-label={`Mark referral asked: ${client.company}`}
                    >
                      <Check className="size-3.5" aria-hidden="true" />
                      Mark asked
                    </PaperButton>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {action.error ? (
        <p role="alert" className="mt-3 text-[13px] text-paper-flame-deep">
          {action.error.message}
        </p>
      ) : null}
    </PaperSection>
  );
}
