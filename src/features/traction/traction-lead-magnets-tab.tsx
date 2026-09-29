import { ArrowDown, ArrowUp, Check, Download, FlaskConical, PenLine, Plus, Trash2, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  leadMagnetBlockers,
  leadMagnetSource,
  MAX_LEAD_MAGNET_SECTIONS,
  type LeadMagnet,
  type LeadMagnetFormat,
  type LeadMagnetInput,
  type LeadMagnetStats,
  type LeadMagnetStatus,
  type LeadMagnetTrack,
} from "@shared/lead-magnet-types";
import type { Offer, TractionData } from "@shared/traction-types";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperCard, PaperSection, Tag } from "@/components/paper";
import {
  useCreateLeadMagnet,
  useDeleteLeadMagnet,
  useDraftLeadMagnet,
  useSaveLeadMagnet,
  useStartLeadMagnetExperiment,
} from "@/lib/agentos/traction";
import { cn } from "@/lib/utils";
import { CaseStudyScreenshots } from "./traction-case-study-screenshots";
import { optional, toList } from "./traction-model";

/**
 * Lead magnets: something genuinely useful, given for an email.
 *
 * Hermes drafts the resource and its landing page from the ICP and the
 * offer it leads to; a person edits; Creative supplies the cover. It ships
 * as a download the site repository takes as-is, and it is measured by the
 * signups Virtec records under `magnet-<slug>`: never by a number typed in.
 */

const TRACKS: readonly { value: LeadMagnetTrack; label: string }[] = [
  { value: "virtara", label: "Virtara" },
  { value: "jurivo", label: "Jurivo" },
];

const FORMATS: readonly { value: LeadMagnetFormat; label: string; hint: string }[] = [
  { value: "checklist", label: "Checklist", hint: "Fastest to make and to use" },
  { value: "scorecard", label: "Scorecard", hint: "Yes or no questions, then a score" },
  { value: "guide", label: "Short guide", hint: "A few practical pages" },
  { value: "template", label: "Template", hint: "Fill in the blanks" },
];

const STATUS_LABEL: Record<LeadMagnetStatus, string> = { draft: "Draft", ready: "Ready", live: "Live" };
const STATUS_TONE: Record<LeadMagnetStatus, "muted" | "marigold" | "green"> = { draft: "muted", ready: "marigold", live: "green" };

const EMPTY_STATS: LeadMagnetStats = { signups: 0, signupsLast7Days: 0, followedUp: 0, conversations: 0 };

export function TractionLeadMagnetsTab({ data }: { data: TractionData }) {
  const [open, setOpen] = useState<string | undefined>(data.leadMagnets[0]?.id);

  return (
    <div className="space-y-12">
      <PaperSection label="Lead magnets" count={data.leadMagnets.length}>
        <p className="-mt-2 mb-5 max-w-[70ch] text-[13px] leading-5 text-paper-sage">
          A free, useful resource in exchange for an email. Signups land in Virtec and at the top of your queue; each one taken into Traction counts
          toward the magnet's experiment. Start with a checklist: it is the quickest to make and the easiest to finish reading.
        </p>
        <NewLeadMagnetForm offers={data.offers} onCreated={setOpen} />

        {data.leadMagnets.length === 0 ? null : (
          <ul className="mt-6 space-y-4">
            {data.leadMagnets.map((magnet) =>
              open === magnet.id ? (
                <li key={magnet.id}>
                  <LeadMagnetEditor
                    magnet={magnet}
                    offers={data.offers}
                    stats={data.leadMagnetStats[magnet.id] ?? EMPTY_STATS}
                    experimentName={data.experiments.find((experiment) => experiment.id === magnet.experimentId)?.name}
                    virtec={!data.crm.configured ? "off" : data.crm.sources?.inbound?.ok === false ? "failed" : "ok"}
                    onClose={() => setOpen(undefined)}
                  />
                </li>
              ) : (
                <li key={magnet.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(magnet.id)}
                    className={cn(
                      "flex w-full cursor-pointer items-center justify-between gap-3 rounded-[4px] border border-paper-mist bg-paper-white p-4 text-left hover:bg-paper-linen",
                      PAPER_FOCUS,
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-semibold text-paper-moss">{magnet.title}</span>
                      <span className="block text-[12.5px] text-paper-sage">
                        {TRACKS.find((track) => track.value === magnet.track)?.label} · {FORMATS.find((format) => format.value === magnet.format)?.label} ·{" "}
                        {statsLine(data.leadMagnetStats[magnet.id] ?? EMPTY_STATS)}
                      </span>
                    </span>
                    <Tag tone={STATUS_TONE[magnet.status]}>{STATUS_LABEL[magnet.status]}</Tag>
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
      </PaperSection>
    </div>
  );
}

function statsLine(stats: LeadMagnetStats): string {
  if (stats.signups === 0) return "no signups yet";
  return `${stats.signups} ${stats.signups === 1 ? "signup" : "signups"} · ${stats.conversations} ${stats.conversations === 1 ? "conversation" : "conversations"}`;
}

function NewLeadMagnetForm({ offers, onCreated }: { offers: readonly Offer[]; onCreated: (id: string) => void }) {
  const create = useCreateLeadMagnet();
  const [track, setTrack] = useState<LeadMagnetTrack>("virtara");
  const [format, setFormat] = useState<LeadMagnetFormat>("checklist");
  const [title, setTitle] = useState("");
  const [offerId, setOfferId] = useState("");

  return (
    <form
      className="grid gap-3 rounded-[4px] border border-paper-mist bg-paper-cream p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim()) return;
        create.mutate(
          { track, format, title: title.trim(), offerId: offerId || undefined },
          {
            onSuccess: (result) => {
              setTitle("");
              onCreated(result.leadMagnet.id);
            },
          },
        );
      }}
    >
      <label className="block">
        <FieldLabel>Working title</FieldLabel>
        <input
          required
          maxLength={120}
          placeholder="The after-hours intake checklist"
          className={cn(PAPER_INPUT, "w-full")}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="block">
        <FieldLabel>Site</FieldLabel>
        <select className={cn(PAPER_INPUT, "w-full")} value={track} onChange={(event) => setTrack(event.target.value as LeadMagnetTrack)}>
          {TRACKS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <FieldLabel>Format</FieldLabel>
        <select className={cn(PAPER_INPUT, "w-full")} value={format} onChange={(event) => setFormat(event.target.value as LeadMagnetFormat)}>
          {FORMATS.map((entry) => (
            <option key={entry.value} value={entry.value} title={entry.hint}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <FieldLabel>Leads to offer</FieldLabel>
        <select className={cn(PAPER_INPUT, "w-full")} value={offerId} onChange={(event) => setOfferId(event.target.value)}>
          <option value="">None yet</option>
          {offers.map((offer) => (
            <option key={offer.id} value={offer.id}>
              {offer.name}
            </option>
          ))}
        </select>
      </label>
      <PaperButton type="submit" variant="amber" disabled={create.isPending || !title.trim()}>
        <Plus className="size-3.5" aria-hidden="true" />
        {create.isPending ? "Adding…" : "Add"}
      </PaperButton>
      {create.error ? (
        <p role="alert" className="text-[13px] text-paper-flame-deep sm:col-span-5">
          {create.error.message}
        </p>
      ) : null}
    </form>
  );
}

type Draft = {
  title: string;
  slug: string;
  track: LeadMagnetTrack;
  format: LeadMagnetFormat;
  promise: string;
  audience: string;
  offerId: string;
  headline: string;
  subhead: string;
  bullets: string;
  cta: string;
  seoTitle: string;
  seoDescription: string;
  sections: { heading: string; body: string }[];
  nextStep: string;
  coverAssetId: string;
  missing: string;
  liveUrl: string;
};

function toDraft(magnet: LeadMagnet): Draft {
  return {
    title: magnet.title,
    slug: magnet.slug,
    track: magnet.track,
    format: magnet.format,
    promise: magnet.promise ?? "",
    audience: magnet.audience ?? "",
    offerId: magnet.offerId ?? "",
    headline: magnet.headline ?? "",
    subhead: magnet.subhead ?? "",
    bullets: magnet.bullets.join("\n"),
    cta: magnet.cta ?? "",
    seoTitle: magnet.seoTitle ?? "",
    seoDescription: magnet.seoDescription ?? "",
    sections: magnet.sections.map((section) => ({ ...section })),
    nextStep: magnet.nextStep ?? "",
    coverAssetId: magnet.coverAssetId ?? "",
    missing: magnet.missing.join("\n"),
    liveUrl: magnet.liveUrl ?? "",
  };
}

function toInput(draft: Draft, magnet: LeadMagnet, status: LeadMagnetStatus): LeadMagnetInput {
  return {
    title: draft.title.trim(),
    slug: draft.slug.trim(),
    track: draft.track,
    format: draft.format,
    status,
    promise: optional(draft.promise),
    audience: optional(draft.audience),
    offerId: optional(draft.offerId),
    experimentId: magnet.experimentId,
    headline: optional(draft.headline),
    subhead: optional(draft.subhead),
    bullets: toList(draft.bullets),
    cta: optional(draft.cta),
    seoTitle: optional(draft.seoTitle),
    seoDescription: optional(draft.seoDescription),
    sections: draft.sections
      .map((section) => ({ heading: section.heading.trim(), body: section.body.trim() }))
      .filter((section) => section.heading || section.body)
      .map((section) => ({ heading: section.heading || "Untitled", body: section.body })),
    nextStep: optional(draft.nextStep),
    coverAssetId: optional(draft.coverAssetId),
    missing: toList(draft.missing),
    liveUrl: optional(draft.liveUrl),
  };
}

function LeadMagnetEditor({
  magnet,
  offers,
  stats,
  experimentName,
  virtec,
  onClose,
}: {
  magnet: LeadMagnet;
  offers: readonly Offer[];
  stats: LeadMagnetStats;
  experimentName?: string;
  virtec: "ok" | "off" | "failed";
  onClose: () => void;
}) {
  // Re-seeded whenever the server's copy changes, after a Hermes draft most of all.
  const [draft, setDraft] = useState<Draft>(() => toDraft(magnet));
  const [seenUpdate, setSeenUpdate] = useState(magnet.updatedAt);
  if (magnet.updatedAt !== seenUpdate) {
    setSeenUpdate(magnet.updatedAt);
    setDraft(toDraft(magnet));
  }

  const save = useSaveLeadMagnet();
  const hermes = useDraftLeadMagnet();
  const experiment = useStartLeadMagnetExperiment();
  const remove = useDeleteLeadMagnet();

  const set = (key: keyof Draft) => (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [key]: event.target.value }));
  const setSection = (index: number, field: "heading" | "body", value: string) =>
    setDraft((current) => ({ ...current, sections: current.sections.map((section, at) => (at === index ? { ...section, [field]: value } : section)) }));
  const moveSection = (index: number, by: -1 | 1) =>
    setDraft((current) => {
      const sections = [...current.sections];
      const target = index + by;
      if (target < 0 || target >= sections.length) return current;
      [sections[index], sections[target]] = [sections[target], sections[index]];
      return { ...current, sections };
    });

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(magnet));
  const current = toInput(draft, magnet, magnet.status);
  const blockers = leadMagnetBlockers({ ...current, bullets: current.bullets ?? [], sections: current.sections ?? [], missing: current.missing ?? [] });
  const live = magnet.status === "live";
  const error = save.error ?? hermes.error ?? experiment.error ?? remove.error;

  return (
    <PaperCard className="p-5">
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({ leadMagnetId: magnet.id, input: toInput(draft, magnet, magnet.status) });
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <label className="block min-w-0 flex-1">
            <FieldLabel>Title</FieldLabel>
            <input required maxLength={120} className={cn(PAPER_INPUT, "w-full font-semibold")} value={draft.title} onChange={set("title")} />
          </label>
          <div className="flex items-center gap-2 pt-6">
            <Tag tone={STATUS_TONE[magnet.status]}>{STATUS_LABEL[magnet.status]}</Tag>
            <PaperButton onClick={onClose}>Close</PaperButton>
          </div>
        </div>

        <Results stats={stats} virtec={virtec} source={leadMagnetSource(magnet.slug)} />

        <div className="flex flex-wrap items-center gap-2 rounded-[4px] bg-paper-linen px-3 py-2.5">
          {magnet.experimentId ? (
            <Link
              to="/traction?tab=experiments"
              className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-[4px] px-3 text-[13.5px] font-semibold text-paper-blue hover:bg-paper-stone", PAPER_FOCUS)}
            >
              <FlaskConical className="size-3.5" aria-hidden="true" />
              {experimentName ?? "Its experiment"}
            </Link>
          ) : (
            <PaperButton variant="ghost" disabled={experiment.isPending} onClick={() => experiment.mutate(magnet.id)}>
              <FlaskConical className="size-3.5" aria-hidden="true" />
              {experiment.isPending ? "Starting…" : "Track with an experiment"}
            </PaperButton>
          )}
          <span className="text-[12.5px] text-paper-sage">
            {magnet.experimentId
              ? "Signups you take into Traction are tagged with it, so its numbers come from real prospects."
              : "Creates a planned experiment on the content channel and links it; sharpen its hypothesis on the Experiments tab."}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <label className="block">
            <FieldLabel>Site</FieldLabel>
            <select disabled={live} className={cn(PAPER_INPUT, "w-full")} value={draft.track} onChange={set("track")}>
              {TRACKS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <FieldLabel>Format</FieldLabel>
            <select className={cn(PAPER_INPUT, "w-full")} value={draft.format} onChange={set("format")}>
              {FORMATS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <FieldLabel>Slug {live ? <span className="font-normal text-paper-ash">(fixed once live)</span> : null}</FieldLabel>
            <input
              required
              disabled={live}
              maxLength={32}
              pattern="[a-z0-9](?:[a-z0-9\-]{0,30}[a-z0-9])?"
              title="Lower-case letters, digits and hyphens"
              className={cn(PAPER_INPUT, "w-full font-mono text-[13px]")}
              value={draft.slug}
              onChange={set("slug")}
            />
          </label>
          <label className="block">
            <FieldLabel>Leads to offer</FieldLabel>
            <select className={cn(PAPER_INPUT, "w-full")} value={draft.offerId} onChange={set("offerId")}>
              <option value="">None</option>
              {offers.map((offer) => (
                <option key={offer.id} value={offer.id}>
                  {offer.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-[4px] bg-paper-linen px-3 py-2.5">
          <PaperButton variant="ghost" disabled={hermes.isPending || dirty} onClick={() => hermes.mutate(magnet.id)} title={dirty ? "Save your edits first" : undefined}>
            <PenLine className="size-3.5" aria-hidden="true" />
            {hermes.isPending ? "Hermes is drafting… (up to 2 min)" : magnet.draftedAt ? "Redraft empty fields" : "Draft with Hermes"}
          </PaperButton>
          <span className="text-[12.5px] text-paper-sage">
            {dirty ? "Save first. Hermes fills only fields that are empty on the server." : "Fills empty fields only. Anything it cannot know is marked [NEEDS DATA]."}
          </span>
        </div>

        <fieldset className="space-y-3">
          <legend className="mb-1 font-paper-display text-[15px] font-bold text-paper-moss">The promise</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Promise" hint="the one-line result" max={200} value={draft.promise} onChange={set("promise")} />
            <TextField label="Who it is for" hint="in their words" max={200} value={draft.audience} onChange={set("audience")} />
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-1 font-paper-display text-[15px] font-bold text-paper-moss">Landing page</legend>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <TextField label="Headline" max={120} value={draft.headline} onChange={set("headline")} />
            <TextField label="Button" hint="2 to 5 words" max={40} value={draft.cta} onChange={set("cta")} />
          </div>
          <label className="block">
            <FieldLabel>Subhead</FieldLabel>
            <textarea rows={2} maxLength={300} className={cn(PAPER_INPUT, "w-full py-2 leading-6")} value={draft.subhead} onChange={set("subhead")} />
          </label>
          <label className="block">
            <FieldLabel>
              What is inside <span className="font-normal text-paper-ash">(one per line, 3 to 5)</span>
            </FieldLabel>
            <textarea rows={4} className={cn(PAPER_INPUT, "w-full py-2 leading-6")} value={draft.bullets} onChange={set("bullets")} />
          </label>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <TextField label="Search title" hint="under 60" max={70} value={draft.seoTitle} onChange={set("seoTitle")} />
            <TextField label="Search description" hint="under 155" max={170} value={draft.seoDescription} onChange={set("seoDescription")} />
          </div>
          <CaseStudyScreenshots
            assetIds={draft.coverAssetId ? [draft.coverAssetId] : []}
            onChange={(ids) => setDraft((current) => ({ ...current, coverAssetId: ids[0] ?? "" }))}
            max={1}
            label="Cover image"
            hint="shown beside the headline; PNG, JPG or WebP"
            empty="No cover yet. A mock-up of the first page works well; make one in Creative or upload it here."
            uploadLabel="Upload cover"
          />
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-1 font-paper-display text-[15px] font-bold text-paper-moss">
            The resource{" "}
            <span className="text-[12.5px] font-normal text-paper-sage">
              Blank line between paragraphs, <code>- </code> for bullets, <code>- [ ] </code> for checklist items, <code>**bold**</code>.
            </span>
          </legend>
          {draft.sections.length === 0 ? <p className="text-[13px] text-paper-sage">No sections yet. Draft with Hermes, or add the first one.</p> : null}
          <ol className="space-y-3">
            {draft.sections.map((section, index) => (
              <li key={index} className="rounded-[4px] border border-paper-mist p-3">
                <div className="flex items-center gap-2">
                  <span className="font-paper-display text-[13px] font-bold text-paper-ash tabular-nums">{index + 1}.</span>
                  <input
                    aria-label={`Section ${index + 1} heading`}
                    maxLength={120}
                    placeholder="Heading"
                    className={cn(PAPER_INPUT, "min-w-0 flex-1 font-semibold")}
                    value={section.heading}
                    onChange={(event) => setSection(index, "heading", event.target.value)}
                  />
                  <IconButton label={`Move section ${index + 1} up`} disabled={index === 0} onClick={() => moveSection(index, -1)}>
                    <ArrowUp className="size-3.5" aria-hidden="true" />
                  </IconButton>
                  <IconButton label={`Move section ${index + 1} down`} disabled={index === draft.sections.length - 1} onClick={() => moveSection(index, 1)}>
                    <ArrowDown className="size-3.5" aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`Remove section ${index + 1}`}
                    onClick={() => setDraft((current) => ({ ...current, sections: current.sections.filter((_, at) => at !== index) }))}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </IconButton>
                </div>
                <textarea
                  aria-label={`Section ${index + 1} text`}
                  rows={6}
                  maxLength={4000}
                  className={cn(PAPER_INPUT, "mt-2 w-full py-2 font-mono text-[13px] leading-6")}
                  value={section.body}
                  onChange={(event) => setSection(index, "body", event.target.value)}
                />
              </li>
            ))}
          </ol>
          <PaperButton
            disabled={draft.sections.length >= MAX_LEAD_MAGNET_SECTIONS}
            onClick={() => setDraft((current) => ({ ...current, sections: [...current.sections, { heading: "", body: "" }] }))}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add section
          </PaperButton>
          <label className="block">
            <FieldLabel>
              Next step <span className="font-normal text-paper-ash">(the one line after the resource, pointing at the offer)</span>
            </FieldLabel>
            <textarea rows={2} maxLength={300} className={cn(PAPER_INPUT, "w-full py-2 leading-6")} value={draft.nextStep} onChange={set("nextStep")} />
          </label>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <FieldLabel>Still missing (one per line)</FieldLabel>
            <textarea rows={3} className={cn(PAPER_INPUT, "w-full py-2")} value={draft.missing} onChange={set("missing")} />
          </label>
          <label className="block">
            <FieldLabel>Live at</FieldLabel>
            <input
              type="url"
              maxLength={300}
              placeholder={`https://…/guides/${draft.slug}`}
              className={cn(PAPER_INPUT, "w-full")}
              value={draft.liveUrl}
              onChange={set("liveUrl")}
            />
          </label>
        </div>

        {blockers.length > 0 ? (
          <div className="rounded-[4px] border border-paper-mist bg-paper-cream px-4 py-3">
            <p className="text-[13px] font-semibold text-paper-moss">Before it can ship</p>
            <ul className="mt-1 list-disc pl-5 text-[13px] leading-6 text-paper-char">
              {blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-paper-stone pt-4">
          <PaperButton type="submit" variant="amber" disabled={save.isPending || !dirty}>
            {save.isPending ? "Saving…" : "Save"}
          </PaperButton>
          {magnet.status === "draft" ? (
            <PaperButton
              variant="ghost"
              disabled={blockers.length > 0 || save.isPending}
              title={blockers.length > 0 ? "Clear the list above first" : undefined}
              onClick={() => save.mutate({ leadMagnetId: magnet.id, input: toInput(draft, magnet, "ready") })}
            >
              <Check className="size-3.5" aria-hidden="true" />
              Mark ready
            </PaperButton>
          ) : null}
          {magnet.status === "ready" ? (
            <PaperButton
              variant="ghost"
              disabled={save.isPending || !optional(draft.liveUrl)}
              title={!optional(draft.liveUrl) ? "Add where it is live first" : undefined}
              onClick={() => save.mutate({ leadMagnetId: magnet.id, input: toInput(draft, magnet, "live") })}
            >
              Mark live
            </PaperButton>
          ) : null}
          {live ? (
            <PaperButton disabled={save.isPending} onClick={() => save.mutate({ leadMagnetId: magnet.id, input: toInput(draft, magnet, "draft") })}>
              Back to draft
            </PaperButton>
          ) : null}
          {dirty || blockers.length > 0 ? (
            <PaperButton disabled title={dirty ? "Save first; the export is made from the saved magnet" : "Clear the list above first"}>
              <Download className="size-3.5" aria-hidden="true" />
              Download for the site
            </PaperButton>
          ) : (
            <a
              href={`/api/traction/lead-magnets/${encodeURIComponent(magnet.id)}/export.zip`}
              download
              className={cn(
                "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-[4px] px-3 text-[13.5px] font-semibold text-paper-sage transition-colors duration-150 hover:bg-paper-stone hover:text-paper-moss",
                PAPER_FOCUS,
              )}
            >
              <Download className="size-3.5" aria-hidden="true" />
              Download for the site
            </a>
          )}
          <PaperButton
            className="ml-auto"
            aria-label={`Remove the ${magnet.title} lead magnet`}
            disabled={remove.isPending || live}
            title={live ? "Back to draft first" : undefined}
            onClick={() => {
              if (window.confirm(`Remove “${magnet.title}”?`)) remove.mutate(magnet.id, { onSuccess: onClose });
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

function Results({ stats, virtec, source }: { stats: LeadMagnetStats; virtec: "ok" | "off" | "failed"; source: string }) {
  const cells: [string, number][] = [
    ["Signups", stats.signups],
    ["Last 7 days", stats.signupsLast7Days],
    ["Followed up", stats.followedUp],
    ["Conversations", stats.conversations],
  ];
  return (
    <div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cells.map(([label, value]) => (
          <div key={label} className="rounded-[4px] border border-paper-mist px-3 py-2">
            <dt className="text-[11.5px] font-semibold tracking-[0.06em] text-paper-sage uppercase">{label}</dt>
            <dd className="font-paper-display text-[22px] font-bold text-paper-moss tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1.5 text-[12px] text-paper-sage">
        {virtec === "ok" ? (
          <>
            Counted from Virtec website leads with source <code>{source}</code>.
          </>
        ) : virtec === "off" ? (
          "Connect Virtec (Virtec tab) to count signups."
        ) : (
          "Virtec's website leads could not be read, so these are not current."
        )}
      </p>
    </div>
  );
}

function TextField({
  label,
  hint,
  max,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  max: number;
  value: string;
  onChange: (event: { target: { value: string } }) => void;
}) {
  return (
    <label className="block">
      <FieldLabel>
        {label} {hint ? <span className="font-normal text-paper-ash">({hint})</span> : null}
      </FieldLabel>
      <input maxLength={max} className={cn(PAPER_INPUT, "w-full")} value={value} onChange={onChange} />
    </label>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn("cursor-pointer rounded-[3px] p-1.5 text-paper-sage hover:text-paper-moss disabled:cursor-default disabled:opacity-30", PAPER_FOCUS)}
    >
      {children}
    </button>
  );
}
