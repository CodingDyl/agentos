import { Check, Copy, Download, MessageSquareQuote, PenLine, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { CaseStudy, CaseStudyStatus, TractionData } from "@shared/traction-types";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperCard, PaperSection, Tag } from "@/components/paper";
import {
  useDeleteCaseStudy,
  useDismissOpportunity,
  useDraftCaseStudy,
  useRequestTestimonial,
  useSaveCaseStudy,
  useStartCaseStudy,
} from "@/lib/agentos/traction";
import { cn } from "@/lib/utils";
import { CaseStudyScreenshots } from "./traction-case-study-screenshots";
import { optional, toList } from "./traction-model";

/**
 * Case studies — evidence, captured while it is fresh.
 *
 * A finished project raises an opportunity; starting one opens a draft; Hermes
 * fills the sections nobody has written yet from what Virtec and the
 * workspace know. It never invents a result: what was not measured stays a
 * visible `[NEEDS DATA]` gap, and a study with gaps cannot be marked ready.
 * The testimonial is the client's — AgentOS can only put the ask on Waiting On.
 */

const STATUS_LABEL: Record<CaseStudyStatus, string> = { draft: "Draft", ready: "Ready", published: "Published" };
const STATUS_TONE: Record<CaseStudyStatus, "muted" | "marigold" | "green"> = { draft: "muted", ready: "marigold", published: "green" };

export function TractionCaseStudiesTab({ data, openId }: { data: TractionData; openId?: string }) {
  const start = useStartCaseStudy();
  const dismiss = useDismissOpportunity();
  const [open, setOpen] = useState<string | undefined>(openId ?? data.caseStudies[0]?.id);

  return (
    <div className="space-y-12">
      {data.caseStudyOpportunities.length > 0 ? (
        <PaperSection label="Finished projects without a case study" count={data.caseStudyOpportunities.length}>
          <ul className="divide-y divide-paper-stone border-y border-paper-mist">
            {data.caseStudyOpportunities.map((opportunity) => {
              const busy = (start.isPending && start.variables && "fromOpportunity" in start.variables && start.variables.fromOpportunity === opportunity.source) || false;
              return (
                <li key={opportunity.source} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium text-paper-moss">{opportunity.client}</span>
                    <span className="block text-[12.5px] text-paper-sage">{opportunity.detail}</span>
                  </span>
                  <span className="flex gap-1.5">
                    <PaperButton
                      variant="amber"
                      disabled={busy}
                      onClick={() =>
                        start.mutate({ fromOpportunity: opportunity.source }, { onSuccess: (result) => setOpen(result.caseStudy.id) })
                      }
                    >
                      {busy ? "Starting…" : "Start case study"}
                    </PaperButton>
                    <PaperButton disabled={dismiss.isPending} onClick={() => dismiss.mutate(opportunity.source)}>
                      Not this one
                    </PaperButton>
                  </span>
                </li>
              );
            })}
          </ul>
        </PaperSection>
      ) : null}

      <PaperSection
        label="Case studies"
        count={data.caseStudies.length}
        action={
          <PaperButton
            onClick={() =>
              start.mutate(
                { title: "New case study", client: "Client", missing: [] },
                { onSuccess: (result) => setOpen(result.caseStudy.id) },
              )
            }
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Blank
          </PaperButton>
        }
      >
        {data.caseStudies.length === 0 ? (
          <p className="max-w-[60ch] text-[14px] leading-6 text-paper-char">
            None yet. A portfolio of real evidence does more for acquisition than another pass at the homepage. Start with the most recent
            finished project.
          </p>
        ) : (
          <ul className="space-y-4">
            {data.caseStudies.map((study) =>
              open === study.id ? (
                <li key={study.id}>
                  <CaseStudyEditor study={study} onClose={() => setOpen(undefined)} />
                </li>
              ) : (
                <li key={study.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(study.id)}
                    className={cn(
                      "flex w-full cursor-pointer items-center justify-between gap-3 rounded-[4px] border border-paper-mist bg-paper-white p-4 text-left hover:bg-paper-linen",
                      PAPER_FOCUS,
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-semibold text-paper-moss">{study.title}</span>
                      <span className="block text-[12.5px] text-paper-sage">
                        {study.client}
                        {study.missing.length > 0 ? ` · ${study.missing.length} missing` : ""}
                      </span>
                    </span>
                    <Tag tone={STATUS_TONE[study.status]}>{STATUS_LABEL[study.status]}</Tag>
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
        {start.error ?? dismiss.error ? (
          <p role="alert" className="mt-3 text-[13px] text-paper-flame-deep">
            {(start.error ?? dismiss.error)?.message}
          </p>
        ) : null}
      </PaperSection>
    </div>
  );
}

type Draft = {
  title: string;
  client: string;
  problem: string;
  solution: string;
  implementation: string;
  result: string;
  testimonial: string;
  missing: string;
  publishedUrl: string;
  status: CaseStudyStatus;
  assetIds: string[];
};

function toDraft(study: CaseStudy): Draft {
  return {
    title: study.title,
    client: study.client,
    problem: study.problem ?? "",
    solution: study.solution ?? "",
    implementation: study.implementation ?? "",
    result: study.result ?? "",
    testimonial: study.testimonial ?? "",
    missing: study.missing.join("\n"),
    publishedUrl: study.publishedUrl ?? "",
    status: study.status,
    assetIds: [...study.assetIds],
  };
}

const SECTIONS: readonly { key: "problem" | "solution" | "implementation" | "result"; label: string; hint: string }[] = [
  { key: "problem", label: "The problem", hint: "What was costing them, in their terms." },
  { key: "solution", label: "What we built", hint: "The thing, named plainly." },
  { key: "implementation", label: "How", hint: "The few decisions that mattered." },
  { key: "result", label: "The result", hint: "What changed. Unmeasured results stay [NEEDS DATA]." },
];

function CaseStudyEditor({ study, onClose }: { study: CaseStudy; onClose: () => void }) {
  // Re-seeded whenever the server's copy changes — after a Hermes draft, most of all.
  const [draft, setDraft] = useState<Draft>(() => toDraft(study));
  const [seenUpdate, setSeenUpdate] = useState(study.updatedAt);
  if (study.updatedAt !== seenUpdate) {
    setSeenUpdate(study.updatedAt);
    setDraft(toDraft(study));
  }

  const [copied, setCopied] = useState(false);
  const save = useSaveCaseStudy();
  const hermes = useDraftCaseStudy();
  const testimonial = useRequestTestimonial();
  const remove = useDeleteCaseStudy();

  const set = (key: keyof Draft) => (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [key]: event.target.value }));
  const gaps = toList(draft.missing).length > 0 || SECTIONS.some((section) => /\[NEEDS DATA/i.test(draft[section.key]));
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(study));
  const error = save.error ?? hermes.error ?? testimonial.error ?? remove.error;

  const input = (status: CaseStudyStatus = draft.status) => ({
    title: draft.title.trim(),
    client: draft.client.trim(),
    status,
    problem: optional(draft.problem),
    solution: optional(draft.solution),
    implementation: optional(draft.implementation),
    result: optional(draft.result),
    testimonial: optional(draft.testimonial),
    missing: toList(draft.missing),
    publishedUrl: optional(draft.publishedUrl),
    assetIds: draft.assetIds,
  });

  return (
    <PaperCard className="p-5">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({ caseStudyId: study.id, input: input() });
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <label className="block">
              <FieldLabel>Headline</FieldLabel>
              <input required maxLength={160} className={cn(PAPER_INPUT, "w-full font-semibold")} value={draft.title} onChange={set("title")} />
            </label>
            <label className="block">
              <FieldLabel>Client</FieldLabel>
              <input required maxLength={120} className={cn(PAPER_INPUT, "w-full")} value={draft.client} onChange={set("client")} />
            </label>
          </div>
          <PaperButton onClick={onClose}>Close</PaperButton>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-[4px] bg-paper-linen px-3 py-2.5">
          <PaperButton variant="ghost" disabled={hermes.isPending || dirty} onClick={() => hermes.mutate(study.id)} title={dirty ? "Save your edits first" : undefined}>
            <PenLine className="size-3.5" aria-hidden="true" />
            {hermes.isPending ? "Hermes is drafting… (up to 2 min)" : study.draftedAt ? "Redraft empty sections" : "Draft with Hermes"}
          </PaperButton>
          <span className="text-[12.5px] text-paper-sage">
            {dirty ? "Save first. Hermes fills only sections that are empty on the server." : "Fills empty sections only. Your text is never replaced."}
          </span>
        </div>

        {SECTIONS.map((section) => (
          <label key={section.key} className="block">
            <FieldLabel>
              {section.label} <span className="font-normal text-paper-ash">({section.hint})</span>
            </FieldLabel>
            <textarea rows={4} maxLength={6000} className={cn(PAPER_INPUT, "w-full py-2 leading-6")} value={draft[section.key]} onChange={set(section.key)} />
          </label>
        ))}

        <CaseStudyScreenshots
          assetIds={draft.assetIds}
          workspace={study.workspace}
          onChange={(assetIds) => setDraft((current) => ({ ...current, assetIds }))}
        />

        <label className="block">
          <FieldLabel>
            Testimonial <span className="font-normal text-paper-ash">(the client's own words, pasted in; never drafted)</span>
          </FieldLabel>
          <textarea rows={3} maxLength={6000} className={cn(PAPER_INPUT, "w-full py-2 leading-6")} value={draft.testimonial} onChange={set("testimonial")} />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <FieldLabel>Still missing (one per line)</FieldLabel>
            <textarea rows={3} className={cn(PAPER_INPUT, "w-full py-2")} value={draft.missing} onChange={set("missing")} />
          </label>
          <label className="block">
            <FieldLabel>Published at</FieldLabel>
            <input type="url" maxLength={300} placeholder="https://virtara.co.za/work/…" className={cn(PAPER_INPUT, "w-full")} value={draft.publishedUrl} onChange={set("publishedUrl")} />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-paper-stone pt-4">
          <PaperButton type="submit" variant="amber" disabled={save.isPending || !dirty}>
            {save.isPending ? "Saving…" : "Save draft"}
          </PaperButton>
          {study.status === "draft" ? (
            <PaperButton
              variant="ghost"
              disabled={gaps || save.isPending}
              title={gaps ? "Fill every [NEEDS DATA] and clear the missing list first" : undefined}
              onClick={() => save.mutate({ caseStudyId: study.id, input: input("ready") })}
            >
              <Check className="size-3.5" aria-hidden="true" />
              Mark ready
            </PaperButton>
          ) : null}
          {study.status === "ready" ? (
            <PaperButton
              variant="ghost"
              disabled={save.isPending || !optional(draft.publishedUrl)}
              title={!optional(draft.publishedUrl) ? "Add where it was published first" : undefined}
              onClick={() => save.mutate({ caseStudyId: study.id, input: input("published") })}
            >
              Mark published
            </PaperButton>
          ) : null}
          <PaperButton disabled={testimonial.isPending || Boolean(study.testimonial)} onClick={() => testimonial.mutate(study.id)}>
            <MessageSquareQuote className="size-3.5" aria-hidden="true" />
            {testimonial.isSuccess ? "Added to Waiting on" : "Ask for testimonial"}
          </PaperButton>
          <PaperButton
            disabled={dirty}
            title={dirty ? "Save first; the export is made from the saved study" : undefined}
            onClick={() => {
              void fetch(`/api/traction/case-studies/${encodeURIComponent(study.id)}/export.md`)
                .then((response) => (response.ok ? response.text() : Promise.reject(new Error("Export failed"))))
                .then((markdown) => navigator.clipboard?.writeText(markdown))
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                })
                .catch(() => setCopied(false));
            }}
          >
            <Copy className="size-3.5" aria-hidden="true" />
            {copied ? "Copied" : "Copy Markdown"}
          </PaperButton>
          {dirty ? (
            <PaperButton disabled title="Save first; the export is made from the saved study">
              <Download className="size-3.5" aria-hidden="true" />
              Download .zip
            </PaperButton>
          ) : (
            <a
              href={`/api/traction/case-studies/${encodeURIComponent(study.id)}/export.zip`}
              download
              className={cn(
                "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-[4px] px-3 text-[13.5px] font-semibold text-paper-sage transition-colors duration-150 hover:bg-paper-stone hover:text-paper-moss",
                PAPER_FOCUS,
              )}
            >
              <Download className="size-3.5" aria-hidden="true" />
              Download .zip
            </a>
          )}
          <PaperButton
            className="ml-auto"
            aria-label={`Remove the ${study.title} case study`}
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Remove “${study.title}”? Its finished project will be suggested again.`)) remove.mutate(study.id, { onSuccess: onClose });
            }}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </PaperButton>
        </div>

        {error ? (
          <p role="alert" className="text-[13px] text-paper-flame-deep">
            {error.message}
          </p>
        ) : null}
      </form>
    </PaperCard>
  );
}
