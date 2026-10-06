import { ExternalLink, PenLine, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { SOURCE_LABELS, type Prospect, type ProspectStage, type TractionData } from "@shared/traction-types";
import { PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperCard, PaperPagination, PaperSection, Tag } from "@/components/paper";
import { useDeleteProspect, useUnlinkMailThread, useUpdateProspect } from "@/lib/agentos/traction";
import { cn } from "@/lib/utils";
import { formatShortDate, gapLabels, hermesHref, hermesPrompt, PIPELINE_STAGES, stageLabel } from "./traction-model";
import { ProspectEmailSection } from "./traction-outreach-email";
import { ProspectForm } from "./traction-prospect-form";
import { usePagination } from "@/lib/use-pagination";

/**
 * Prospects: the list, and one prospect at a time beside it.
 *
 * The list answers "who, how good a fit, where are they, what next". The
 * panel answers "can I write to them yet?" — and says plainly when the answer
 * is no, and what is missing.
 */

const FIT_TONE = { high: "green", medium: "marigold", low: "muted" } as const;
const FIT_LABEL = { high: "High", medium: "Med", low: "Low" } as const;

type StageFilter = "open" | ProspectStage | "all";

export function TractionProspectsTab({
  data,
  selectedId,
  onSelect,
  onCompose,
}: {
  data: TractionData;
  selectedId: string | undefined;
  onSelect: (prospectId: string | undefined) => void;
  /** Opens the outreach composer for this prospect. */
  onCompose: (prospectId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<StageFilter>("open");
  const [search, setSearch] = useState("");

  const selected = data.prospects.find((prospect) => prospect.id === selectedId);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.prospects
      .filter((prospect) =>
        filter === "all" ? true : filter === "open" ? prospect.stage !== "won" && prospect.stage !== "lost" : prospect.stage === filter,
      )
      .filter((prospect) => !term || `${prospect.company} ${prospect.contact ?? ""} ${prospect.segment ?? ""}`.toLowerCase().includes(term))
      .sort((a, b) => (a.nextActionDate ?? "9999").localeCompare(b.nextActionDate ?? "9999") || a.company.localeCompare(b.company));
  }, [data.prospects, filter, search]);
  const pager = usePagination(rows, `${filter}|${search}`);

  const panel = adding ? (
    <PaperCard className="p-5">
      <h2 className="mb-4 font-paper-display text-[17px] font-bold text-paper-moss">New prospect</h2>
      <ProspectForm
        data={data}
        onDone={(prospectId) => {
          setAdding(false);
          if (prospectId) onSelect(prospectId);
        }}
      />
    </PaperCard>
  ) : selected ? (
    <ProspectPanel key={selected.id} data={data} prospect={selected} onClose={() => onSelect(undefined)} onCompose={() => onCompose(selected.id)} />
  ) : null;

  return (
    <div className={cn("grid gap-10", panel ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]" : "")}>
      <PaperSection
        label="Prospects"
        count={rows.length}
        // A grid item shrinks only with min-w-0; without it the table's minimum width widens the page on a phone.
        className="min-w-0"
        action={
          <PaperButton
            variant="amber"
            onClick={() => {
              onSelect(undefined);
              setAdding(true);
            }}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add prospect
          </PaperButton>
        }
      >
        <div className="mb-4 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="prospect-search">
            Search prospects
          </label>
          <input
            id="prospect-search"
            type="search"
            placeholder="Search"
            className={cn(PAPER_INPUT, "w-full sm:w-56")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <label className="sr-only" htmlFor="prospect-stage">
            Stage
          </label>
          <select id="prospect-stage" className={PAPER_INPUT} value={filter} onChange={(event) => setFilter(event.target.value as StageFilter)}>
            <option value="open">Open</option>
            {[...PIPELINE_STAGES, "lost" as const].map((stage) => (
              <option key={stage} value={stage}>
                {stageLabel(stage)}
              </option>
            ))}
            <option value="all">All</option>
          </select>
        </div>

        {rows.length === 0 ? (
          <p className="text-[14px] leading-6 text-paper-char">
            {data.prospects.length === 0
              ? `No prospects yet. Start with ten that fit${data.icp ? ` “${data.icp.name}”` : " one ICP"}. Ten good ones beat fifty cold ones.`
              : "No prospect matches."}
          </p>
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-left text-[14px]">
              <thead>
                <tr className="border-b border-paper-mist text-[12px] tracking-[0.06em] text-paper-sage uppercase">
                  <th scope="col" className="py-2 pr-3 font-semibold">Company</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Fit</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Stage</th>
                  <th scope="col" className="py-2 font-semibold">Next action</th>
                </tr>
              </thead>
              <tbody>
                {pager.pageItems.map((prospect) => (
                  <tr key={prospect.id} className={cn("border-b border-paper-stone", prospect.id === selectedId && "bg-paper-linen")}>
                    <td className="py-2.5 pr-3">
                      <button
                        type="button"
                        onClick={() => {
                          setAdding(false);
                          onSelect(prospect.id);
                        }}
                        className={cn("cursor-pointer rounded-[2px] text-left font-medium text-paper-moss hover:underline", PAPER_FOCUS)}
                      >
                        {prospect.company}
                      </button>
                      {prospect.contact ? <span className="block text-[12.5px] text-paper-sage">{prospect.contact}</span> : null}
                    </td>
                    <td className="py-2.5 pr-3">{prospect.fit ? <Tag tone={FIT_TONE[prospect.fit]}>{FIT_LABEL[prospect.fit]}</Tag> : <span className="text-paper-ash">-</span>}</td>
                    <td className="py-2.5 pr-3 text-paper-char">{stageLabel(prospect.stage)}</td>
                    <td className="py-2.5 text-paper-char">
                      {prospect.nextAction ?? <span className="text-paper-ash">-</span>}
                      {prospect.nextActionDate ? (
                        <span className={cn("ml-2 text-[12.5px] tabular-nums", prospect.nextActionDate <= data.today ? "font-semibold text-paper-flame-deep" : "text-paper-sage")}>
                          {formatShortDate(prospect.nextActionDate)}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaperPagination pager={pager} label="Prospect pages" />
          </>
        )}
      </PaperSection>

      {panel ? <aside aria-label="Prospect detail">{panel}</aside> : null}
    </div>
  );
}

function ProspectPanel({ data, prospect, onClose, onCompose }: { data: TractionData; prospect: Prospect; onClose: () => void; onCompose: () => void }) {
  const [editing, setEditing] = useState(false);
  const update = useUpdateProspect();
  const remove = useDeleteProspect();
  const unlink = useUnlinkMailThread();
  const gaps = data.outreachGaps[prospect.id] ?? [];
  const offer = data.offers.find((entry) => entry.id === prospect.offerId);
  const ask = hermesPrompt({ prospect, icp: data.icp, offers: data.offers, gaps });

  if (editing) {
    return (
      <PaperCard className="p-5">
        <h2 className="mb-4 font-paper-display text-[17px] font-bold text-paper-moss">Edit {prospect.company}</h2>
        <ProspectForm data={data} prospect={prospect} onDone={() => setEditing(false)} />
      </PaperCard>
    );
  }

  return (
    <PaperCard className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-paper-display text-[20px] leading-7 font-bold tracking-[-0.01em] text-paper-moss">{prospect.company}</h2>
          <p className="text-[13px] text-paper-sage">
            {stageLabel(prospect.stage)} · {SOURCE_LABELS[prospect.source]}
            {prospect.segment ? ` · ${prospect.segment}` : ""}
          </p>
        </div>
        <PaperButton onClick={onClose} aria-label="Close prospect">
          Close
        </PaperButton>
      </div>

      <dl className="mt-4 space-y-3 text-[14px] leading-6">
        {prospect.website ? (
          <Fact label="Website">
            {/* Only http(s) reaches here — the schema refuses anything else. */}
            <a href={prospect.website} target="_blank" rel="noopener noreferrer" className={cn("inline-flex items-center gap-1 text-paper-blue hover:underline", PAPER_FOCUS)}>
              {prospect.website.replace(/^https?:\/\//, "")}
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </Fact>
        ) : null}
        {prospect.contact || prospect.email ? (
          <Fact label="Contact">
            {prospect.contact}
            {prospect.email ? <span className="block text-paper-sage">{prospect.email}</span> : null}
          </Fact>
        ) : null}
        {prospect.reasons.length > 0 ? (
          <Fact label="Why this lead">
            <ul className="list-disc pl-5">
              {prospect.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </Fact>
        ) : null}
        {prospect.observation ? <Fact label="Observation">{prospect.observation}</Fact> : null}
        {prospect.angle ? <Fact label="Suggested angle">{prospect.angle}</Fact> : null}
        {offer ? <Fact label="Offer">{offer.name}</Fact> : null}
        {prospect.nextAction || prospect.nextActionDate ? (
          <Fact label="Next action">
            {prospect.nextAction ?? "Next step"}
            {prospect.nextActionDate ? ` · ${formatShortDate(prospect.nextActionDate)}` : ""}
          </Fact>
        ) : null}
        {prospect.lastTouchAt ? <Fact label="Last contacted">{formatShortDate(prospect.lastTouchAt)}</Fact> : null}
        {prospect.workspace ? (
          <Fact label="Workspace">
            <Link to={`/workspaces/${encodeURIComponent(prospect.workspace)}`} className={cn("text-paper-blue hover:underline", PAPER_FOCUS)}>
              {prospect.workspace}
            </Link>
          </Fact>
        ) : null}
        {prospect.notes ? <Fact label="Notes"><span className="whitespace-pre-wrap">{prospect.notes}</span></Fact> : null}
        {(data.mailThreads[prospect.id] ?? []).length > 0 ? (
          <Fact label="Email">
            <ul className="space-y-1">
              {(data.mailThreads[prospect.id] ?? []).slice(0, 5).map((thread) => (
                <li key={thread.threadId} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">{thread.subject}</span>
                  <span className="flex shrink-0 items-baseline gap-2 text-[12.5px] text-paper-sage">
                    {formatShortDate(thread.messageDate)}
                    <button
                      type="button"
                      onClick={() => unlink.mutate(thread.threadId)}
                      disabled={unlink.isPending}
                      aria-label={`Unlink “${thread.subject}” from ${prospect.company}`}
                      className={cn("cursor-pointer rounded-[2px] hover:text-paper-moss hover:underline", PAPER_FOCUS)}
                    >
                      Unlink
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </Fact>
        ) : null}
      </dl>

      {/* The brand guard, stated where the decision to write is made. The composer is where it gets resolved. */}
      <div className={cn("mt-5 rounded-none px-3 py-3", gaps.length > 0 ? "bg-paper-linen" : "border border-paper-green")}>
        {gaps.length > 0 ? (
          <>
            <p className="text-[12px] font-semibold tracking-[0.06em] text-paper-char uppercase">Not ready to write yet</p>
            <p className="mt-1 text-[13px] leading-5 text-paper-sage">
              Missing: {gapLabels(gaps).join(", ")}. The outreach composer reviews their website and walks you through the rest.
            </p>
          </>
        ) : (
          <p className="text-[13px] leading-5 text-paper-char">Ready for a personalised email. Hermes drafts; you review and send.</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <PaperButton variant="amber" onClick={onCompose}>
            <PenLine className="size-3.5" aria-hidden="true" />
            Write outreach email
          </PaperButton>
          {ask.kind !== "referral" ? (
            <Link to={hermesHref(ask.prompt)} className={cn("inline-flex items-center gap-1.5 text-[13px] text-paper-sage hover:text-paper-moss hover:underline", PAPER_FOCUS)}>
              <Search className="size-3.5" aria-hidden="true" />
              Ask Hermes in chat instead
            </Link>
          ) : null}
        </div>
      </div>

      <ProspectEmailSection prospect={prospect} />

      <div className="mt-5 flex flex-wrap gap-2">
        {prospect.stage === "target" ? (
          <PaperButton
            variant="amber"
            disabled={update.isPending}
            onClick={() => update.mutate({ prospectId: prospect.id, patch: { stage: "contacted" } })}
          >
            Mark contacted
          </PaperButton>
        ) : null}
        <PaperButton variant="ghost" onClick={() => setEditing(true)}>
          Edit
        </PaperButton>
        <PaperButton
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`Remove ${prospect.company}? Its history stays in the weekly counts.`)) {
              remove.mutate(prospect.id, { onSuccess: onClose });
            }
          }}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Remove
        </PaperButton>
      </div>
      {update.error ?? remove.error ? (
        <p role="alert" className="mt-3 text-[13px] text-paper-flame-deep">
          {(update.error ?? remove.error)?.message}
        </p>
      ) : null}
    </PaperCard>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] font-semibold tracking-[0.06em] text-paper-sage uppercase">{label}</dt>
      <dd className="text-paper-moss">{children}</dd>
    </div>
  );
}
