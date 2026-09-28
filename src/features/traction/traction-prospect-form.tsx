import { useState } from "react";
import {
  ProspectFitSchema,
  ProspectSourceSchema,
  ProspectStageSchema,
  RelationshipSchema,
  SOURCE_LABELS,
  type Prospect,
  type ProspectInput,
  type ProspectPatch,
  type TractionData,
} from "@shared/traction-types";
import { FieldLabel, PAPER_INPUT, PaperButton } from "@/components/paper";
import { useCreateProspect, useUpdateProspect } from "@/lib/agentos/traction";
import { useProjects } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { nullable, stageLabel, toList } from "./traction-model";

/**
 * One form for adding and editing a prospect.
 *
 * Short by default — company, contact, website, fit — because a prospect that
 * takes two minutes to enter will not get entered. The fields that make
 * outreach specific (why this lead, the observation, the angle) are right
 * below, since without them Hermes will not draft anything.
 */

type Draft = {
  company: string;
  contact: string;
  email: string;
  website: string;
  segment: string;
  fit: string;
  stage: string;
  source: string;
  nextAction: string;
  nextActionDate: string;
  reasons: string;
  observation: string;
  angle: string;
  offerId: string;
  experimentId: string;
  relationship: string;
  workspace: string;
  notes: string;
};

function toDraft(prospect: Prospect | undefined, icpName: string | undefined): Draft {
  return {
    company: prospect?.company ?? "",
    contact: prospect?.contact ?? "",
    email: prospect?.email ?? "",
    website: prospect?.website ?? "",
    segment: prospect?.segment ?? icpName ?? "",
    fit: prospect?.fit ?? "",
    stage: prospect?.stage ?? "target",
    source: prospect?.source ?? "outbound",
    nextAction: prospect?.nextAction ?? "",
    nextActionDate: prospect?.nextActionDate ?? "",
    reasons: prospect?.reasons.join("\n") ?? "",
    observation: prospect?.observation ?? "",
    angle: prospect?.angle ?? "",
    offerId: prospect?.offerId ?? "",
    experimentId: prospect?.experimentId ?? "",
    relationship: prospect?.relationship ?? "",
    workspace: prospect?.workspace ?? "",
    notes: prospect?.notes ?? "",
  };
}

/** A typed-in address without a scheme is almost always meant as https. */
function normaliseWebsite(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function toPatch(draft: Draft): ProspectPatch {
  return {
    company: draft.company.trim(),
    contact: nullable(draft.contact),
    email: nullable(draft.email),
    website: nullable(normaliseWebsite(draft.website)),
    segment: nullable(draft.segment),
    fit: draft.fit ? ProspectFitSchema.parse(draft.fit) : null,
    stage: ProspectStageSchema.parse(draft.stage),
    source: ProspectSourceSchema.parse(draft.source),
    nextAction: nullable(draft.nextAction),
    nextActionDate: nullable(draft.nextActionDate),
    reasons: toList(draft.reasons),
    observation: nullable(draft.observation),
    angle: nullable(draft.angle),
    offerId: nullable(draft.offerId),
    experimentId: nullable(draft.experimentId),
    relationship: draft.relationship ? RelationshipSchema.parse(draft.relationship) : null,
    workspace: nullable(draft.workspace),
    notes: nullable(draft.notes),
  };
}

/** A new prospect has no fields to clear, so nulls simply become absent. */
function withoutNulls(patch: ProspectPatch) {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null));
}

export function ProspectForm({
  data,
  prospect,
  onDone,
}: {
  data: TractionData;
  prospect?: Prospect;
  onDone: (prospectId?: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(prospect, data.icp?.name));
  const [more, setMore] = useState(Boolean(prospect));
  const create = useCreateProspect();
  const update = useUpdateProspect();
  const { data: projects } = useProjects();
  const saving = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  const field = (key: keyof Draft) => ({
    value: draft[key],
    onChange: (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [key]: event.target.value })),
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const patch = toPatch(draft);

        if (prospect) {
          update.mutate({ prospectId: prospect.id, patch }, { onSuccess: () => onDone(prospect.id) });
        } else {
          create.mutate(withoutNulls(patch) as ProspectInput, {
            onSuccess: (result) => onDone((result as { prospect?: Prospect }).prospect?.id),
          });
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <FieldLabel>Company</FieldLabel>
          <input required maxLength={120} className={cn(PAPER_INPUT, "w-full")} {...field("company")} />
        </label>
        <label className="block">
          <FieldLabel>Website</FieldLabel>
          <input maxLength={300} inputMode="url" placeholder="parkviewrealty.co.za" className={cn(PAPER_INPUT, "w-full")} {...field("website")} />
        </label>
        <label className="block">
          <FieldLabel>Contact</FieldLabel>
          <input maxLength={120} className={cn(PAPER_INPUT, "w-full")} {...field("contact")} />
        </label>
        <label className="block">
          <FieldLabel>Email</FieldLabel>
          <input type="email" maxLength={200} className={cn(PAPER_INPUT, "w-full")} {...field("email")} />
        </label>
        <label className="block">
          <FieldLabel>Fit</FieldLabel>
          <select className={cn(PAPER_INPUT, "w-full")} {...field("fit")}>
            <option value="">Not rated</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className="block">
          <FieldLabel>Source</FieldLabel>
          <select className={cn(PAPER_INPUT, "w-full")} {...field("source")}>
            {ProspectSourceSchema.options.map((source) => (
              <option key={source} value={source}>
                {SOURCE_LABELS[source]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <FieldLabel>Stage</FieldLabel>
          <select className={cn(PAPER_INPUT, "w-full")} {...field("stage")}>
            {ProspectStageSchema.options.map((stage) => (
              <option key={stage} value={stage}>
                {stageLabel(stage)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <FieldLabel>Offer to pitch</FieldLabel>
          <select className={cn(PAPER_INPUT, "w-full")} {...field("offerId")}>
            <option value="">{data.offers.length === 0 ? "No offers yet" : "None chosen"}</option>
            {data.offers.map((offer) => (
              <option key={offer.id} value={offer.id}>
                {offer.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <FieldLabel>Specific observation (the thing you would actually say)</FieldLabel>
        <textarea
          maxLength={500}
          rows={2}
          placeholder="Property pages have no clear viewing-enquiry CTA on mobile."
          className={cn(PAPER_INPUT, "w-full py-2")}
          {...field("observation")}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <label className="block">
          <FieldLabel>Next action</FieldLabel>
          <input maxLength={200} placeholder="Follow up on quote" className={cn(PAPER_INPUT, "w-full")} {...field("nextAction")} />
        </label>
        <label className="block">
          <FieldLabel>By</FieldLabel>
          <input type="date" className={cn(PAPER_INPUT, "w-full")} {...field("nextActionDate")} />
        </label>
      </div>

      {more ? (
        <>
          <label className="block">
            <FieldLabel>Why this lead (one reason per line)</FieldLabel>
            <textarea rows={3} placeholder={"Independent agency\nExisting site is dated\nNo strong lead capture"} className={cn(PAPER_INPUT, "w-full py-2")} {...field("reasons")} />
          </label>
          <label className="block">
            <FieldLabel>Suggested angle</FieldLabel>
            <input maxLength={300} placeholder="Offer a short website conversion audit" className={cn(PAPER_INPUT, "w-full")} {...field("angle")} />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <FieldLabel>Segment</FieldLabel>
              <input maxLength={80} className={cn(PAPER_INPUT, "w-full")} {...field("segment")} />
            </label>
            <label className="block">
              <FieldLabel>Experiment</FieldLabel>
              <select className={cn(PAPER_INPUT, "w-full")} {...field("experimentId")}>
                <option value="">None</option>
                {data.experiments.map((experiment) => (
                  <option key={experiment.id} value={experiment.id}>
                    {experiment.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <FieldLabel>Relationship</FieldLabel>
              <select className={cn(PAPER_INPUT, "w-full")} {...field("relationship")}>
                <option value="">Not set</option>
                <option value="strong">Strong</option>
                <option value="active">Active</option>
                <option value="cold">Cold</option>
              </select>
            </label>
          </div>
          <label className="block">
            <FieldLabel>Linked workspace</FieldLabel>
            <select className={cn(PAPER_INPUT, "w-full")} {...field("workspace")}>
              <option value="">None</option>
              {(projects?.projects ?? []).map((project) => (
                <option key={project.slug} value={project.slug}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <FieldLabel>Notes</FieldLabel>
            <textarea maxLength={4000} rows={3} className={cn(PAPER_INPUT, "w-full py-2")} {...field("notes")} />
          </label>
        </>
      ) : (
        <PaperButton onClick={() => setMore(true)}>More detail: reasons, angle, experiment, workspace</PaperButton>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <PaperButton type="submit" variant="amber" disabled={saving}>
          {saving ? "Saving…" : prospect ? "Save prospect" : "Add prospect"}
        </PaperButton>
        <PaperButton onClick={() => onDone(prospect?.id)}>Cancel</PaperButton>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-paper-flame-deep">
          {error.message}
        </p>
      ) : null}
    </form>
  );
}

