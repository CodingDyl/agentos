import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { OutreachCaseSchema } from "@shared/outreach-case";
import { vettingOf, type Prospect, type TractionData } from "@shared/traction-types";
import { PAPER_FOCUS, PaperButton, PaperCard, PaperEmpty, PaperPagination, PaperSection, Tag } from "@/components/paper";
import { useOutreachCases, useSenders, useWriteCase } from "@/lib/agentos/outreach-cases";
import { useUpdateProspect } from "@/lib/agentos/traction";
import { usePagination } from "@/lib/use-pagination";
import { cn } from "@/lib/utils";
import { Leads, SetupNote } from "./traction-crm-tab";
import { TractionIcpCard } from "./traction-icp-card";
import { KnowThem, ProspectOverview } from "./traction-outreach-case";
import { pathPatch } from "./traction-outreach-path";
import { TractionPlacesSearch } from "./traction-places-search";
import { ProspectForm } from "./traction-prospect-form";

/**
 * Find: businesses that might become customers, from first sight to "I can help".
 *
 * 1. Find them: search a high-ticket niche near an area on Google Places,
 *    Virtec's local candidates (scored against the ICP), or add one by hand.
 * 2. Check them: read their website, note the one specific thing you saw.
 * 3. Decide: "Can help" puts them in Outreach; "Not a fit" closes them.
 *
 * Nothing here writes to anyone.
 */
export function TractionFindTab({ data, selectedId, onSelect, onCompose }: { data: TractionData; selectedId: string | undefined; onSelect: (prospectId: string | undefined) => void; onCompose: (prospectId: string) => void }) {
  const [adding, setAdding] = useState(false);

  const targets = data.prospects.filter((prospect) => prospect.stage === "target");
  const toCheck = targets.filter((prospect) => vettingOf(prospect) === undefined);
  const canHelp = targets.filter((prospect) => vettingOf(prospect) === "can_help");

  return (
    <div className="max-w-[64rem] space-y-12">
      <TractionPlacesSearch prospects={data.prospects} />
      <ToCheck prospects={toCheck} selectedId={selectedId} onSelect={onSelect} adding={adding} onAdd={() => setAdding((open) => !open)} />
      {adding ? (
        <PaperCard className="p-5">
          <h2 className="mb-4 font-paper-display text-[17px] font-bold text-paper-moss">Add a business</h2>
          <ProspectForm
            data={data}
            onDone={(prospectId) => {
              setAdding(false);
              if (prospectId) onSelect(prospectId);
            }}
          />
        </PaperCard>
      ) : null}
      <CanHelp prospects={canHelp} onCompose={onCompose} />
      {data.crm.configured ? <Leads crm={data.crm} icpName={data.icp?.name} /> : <SetupNote problem={data.crm.problem} />}
      <TractionIcpCard icp={data.icp} />
    </div>
  );
}

// ─── To check ───────────────────────────────────────────────────────────────

function ToCheck({ prospects, selectedId, onSelect, adding, onAdd }: { prospects: Prospect[]; selectedId: string | undefined; onSelect: (prospectId: string | undefined) => void; adding: boolean; onAdd: () => void }) {
  const update = useUpdateProspect();
  const pager = usePagination(prospects, "", 10);

  return (
    <PaperSection
      label="To check"
      count={prospects.length}
      action={
        <PaperButton onClick={onAdd} aria-expanded={adding}>
          {adding ? "Close" : "Add a business"}
        </PaperButton>
      }
    >
      <p className="-mt-2 mb-3 max-w-[70ch] text-[13px] leading-5 text-paper-sage">
        Open one, read what Hermes found on their website, and decide: can you help them? Imported leads and businesses you add by hand wait here.
      </p>
      {prospects.length === 0 ? (
        <PaperEmpty description="Nothing waiting to be checked. Import a lead below, or add a business by hand." />
      ) : (
        <ul className="divide-y divide-paper-mist border-y border-paper-mist">
          {pager.pageItems.map((prospect) => {
            const open = prospect.id === selectedId;
            return (
              <li key={prospect.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold text-paper-moss">{prospect.company}</h3>
                    <p className="text-[12.5px] text-paper-sage">
                      {[prospect.segment, prospect.website ? prospect.website.replace(/^https?:\/\/(www\.)?/, "") : "no website on file"].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {prospect.fit ? <Tag tone={prospect.fit === "high" ? "green" : prospect.fit === "medium" ? "marigold" : "muted"}>{prospect.fit} fit</Tag> : null}
                    <PaperButton variant={open ? "ghost" : "amber"} onClick={() => onSelect(open ? undefined : prospect.id)} aria-expanded={open} aria-label={`${open ? "Close" : "Check"} ${prospect.company}`}>
                      {open ? "Close" : "Check"}
                    </PaperButton>
                    <PaperButton disabled={update.isPending} onClick={() => update.mutate({ prospectId: prospect.id, patch: { vetting: "not_a_fit" } })} aria-label={`${prospect.company} is not a fit`}>
                      Not a fit
                    </PaperButton>
                  </div>
                </div>
                {open ? <VettingPanel prospect={prospect} onDone={() => onSelect(undefined)} /> : null}
              </li>
            );
          })}
        </ul>
      )}
      <PaperPagination pager={pager} label="To check pages" />
      {update.error ? (
        <p role="alert" className="mt-3 text-[13px] text-paper-flame-deep">
          {update.error.message}
        </p>
      ) : null}
    </PaperSection>
  );
}

/** Who they are, what Hermes found on their site, and the decision. */
function VettingPanel({ prospect, onDone }: { prospect: Prospect; onDone: () => void }) {
  const cases = useOutreachCases();
  const update = useUpdateProspect();
  const entry = cases.data?.[prospect.id] ?? OutreachCaseSchema.parse({ prospectId: prospect.id });
  const noticed = prospect.observation?.trim();

  return (
    <div className="mt-4 space-y-5 border-l-2 border-paper-blue pl-4">
      <ProspectOverview prospect={prospect} />
      <KnowThem prospect={prospect} entry={entry} />
      {/* Stays in view while you read down the page, so the decision is never a scroll away. */}
      <div className="sticky bottom-0 z-10 -ml-4 flex flex-wrap items-center gap-3 border-t border-paper-mist bg-paper-white py-3 pl-4">
        <PaperButton
          variant="amber"
          disabled={!noticed || update.isPending}
          onClick={() => update.mutate({ prospectId: prospect.id, patch: { vetting: "can_help" } }, { onSuccess: onDone })}
        >
          I can help them
        </PaperButton>
        <PaperButton disabled={update.isPending} onClick={() => update.mutate({ prospectId: prospect.id, patch: { vetting: "not_a_fit" } }, { onSuccess: onDone })}>
          Not a fit
        </PaperButton>
        {!noticed ? <span className="text-[13px] text-paper-sage">Write the one specific thing you noticed (the opening line above) first. Outreach is never drafted without it.</span> : null}
      </div>
      {update.error ? (
        <p role="alert" className="text-[13px] text-paper-flame-deep">
          {update.error.message}
        </p>
      ) : null}
    </div>
  );
}

// ─── Can help ───────────────────────────────────────────────────────────────

function CanHelp({ prospects, onCompose }: { prospects: Prospect[]; onCompose: (prospectId: string) => void }) {
  const update = useUpdateProspect();
  const cases = useOutreachCases();
  const senders = useSenders();
  const writeCase = useWriteCase();
  const pager = usePagination(prospects, "", 10);

  /**
   * Takes you to the rebuild for this business. "Build it first" is chosen for
   * you only when no approach has been picked yet, with your usual prices; an
   * approach you already chose is left as it is.
   */
  const buildTheirSite = (prospect: Prospect) => {
    const entry = cases.data?.[prospect.id] ?? OutreachCaseSchema.parse({ prospectId: prospect.id });
    if (entry.path) return onCompose(prospect.id);
    const sender = senders.data?.find((candidate) => candidate.id === entry.senderId);
    writeCase.mutate({ prospectId: prospect.id, patch: pathPatch("build_first", entry, sender) }, { onSuccess: () => onCompose(prospect.id) });
  };

  return (
    <PaperSection label="I can help: ready to email" count={prospects.length}>
      {prospects.length === 0 ? (
        <PaperEmpty description="Businesses you mark “I can help them” appear here and in Outreach." />
      ) : (
        <ul className="divide-y divide-paper-mist border-y border-paper-mist">
          {pager.pageItems.map((prospect) => (
            <li key={prospect.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold text-paper-moss">{prospect.company}</h3>
                <p className="max-w-[70ch] text-[13px] leading-5 text-paper-char">{prospect.observation}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {prospect.website ? (
                  <a href={prospect.website} target="_blank" rel="noopener noreferrer" className={cn("inline-flex items-center gap-1 px-2 text-[13px] text-paper-blue hover:underline", PAPER_FOCUS)}>
                    Website
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                ) : null}
                <PaperButton variant="amber" disabled={!cases.data || writeCase.isPending} onClick={() => buildTheirSite(prospect)} aria-label={`Build their site first for ${prospect.company}`}>
                  Build their site first
                </PaperButton>
                <PaperButton onClick={() => onCompose(prospect.id)} aria-label={`Write the email to ${prospect.company}`}>
                  Write the email
                </PaperButton>
                <PaperButton disabled={update.isPending} onClick={() => update.mutate({ prospectId: prospect.id, patch: { vetting: "to_check" } })} aria-label={`Move ${prospect.company} back to check`}>
                  Back to check
                </PaperButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      <PaperPagination pager={pager} label="Ready to email pages" />
      {writeCase.error ? (
        <p role="alert" className="mt-3 text-[13px] text-paper-flame-deep">
          {writeCase.error.message}
        </p>
      ) : null}
    </PaperSection>
  );
}
