import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  CHANNEL_LABELS,
  ExperimentChannelSchema,
  ExperimentStatusSchema,
  type Experiment,
  type ExperimentInput,
  type ExperimentProgress,
  type ExperimentStatus,
  type TractionData,
} from "@shared/traction-types";
import { FieldLabel, Meter, PAPER_INPUT, PaperButton, PaperCard, PaperSection, Tag } from "@/components/paper";
import { useDeleteExperiment, useSaveExperiment } from "@/lib/agentos/traction";
import { cn } from "@/lib/utils";
import { formatShortDate, optional } from "./traction-model";

/**
 * Traction experiments — channels under test, not nineteen sections.
 *
 * Each card is a hypothesis with a target, a success line and progress
 * counted from the prospects tagged with it. The point is to decide "LinkedIn
 * doesn't work" from numbers, after two weeks, rather than from a bad Tuesday.
 */

const STATUS_ORDER: readonly ExperimentStatus[] = ["running", "planned", "concluded"];
const STATUS_LABEL: Record<ExperimentStatus, string> = { running: "Running", planned: "Planned", concluded: "Concluded" };

export function TractionExperimentsTab({ data }: { data: TractionData }) {
  const [editing, setEditing] = useState<string | "new" | undefined>();

  return (
    <div className="space-y-12">
      {editing === "new" ? (
        <PaperCard className="max-w-2xl p-5">
          <h2 className="mb-4 font-paper-display text-[17px] font-bold text-paper-moss">New experiment</h2>
          <ExperimentForm onDone={() => setEditing(undefined)} />
        </PaperCard>
      ) : (
        <PaperButton variant="amber" onClick={() => setEditing("new")}>
          <Plus className="size-3.5" aria-hidden="true" />
          Plan an experiment
        </PaperButton>
      )}

      {data.experiments.length === 0 && editing !== "new" ? (
        <p className="max-w-[60ch] text-[14px] leading-6 text-paper-char">
          No experiments yet. Start with one: a channel, a hypothesis, a budget, two weeks, a target number of contacts, and what
          would count as success. Tag prospects with it and the progress counts itself.
        </p>
      ) : null}

      {STATUS_ORDER.map((status) => {
        const experiments = data.experiments.filter((experiment) => experiment.status === status);
        if (experiments.length === 0) return null;

        return (
          <PaperSection key={status} label={STATUS_LABEL[status]} count={experiments.length}>
            <div className="grid gap-4 lg:grid-cols-2">
              {experiments.map((experiment) =>
                editing === experiment.id ? (
                  <PaperCard key={experiment.id} className="p-5">
                    <ExperimentForm experiment={experiment} onDone={() => setEditing(undefined)} />
                  </PaperCard>
                ) : (
                  <ExperimentCard
                    key={experiment.id}
                    experiment={experiment}
                    progress={data.experimentProgress.find((entry) => entry.experimentId === experiment.id)}
                    onEdit={() => setEditing(experiment.id)}
                  />
                ),
              )}
            </div>
          </PaperSection>
        );
      })}
    </div>
  );
}

function ExperimentCard({ experiment, progress, onEdit }: { experiment: Experiment; progress: ExperimentProgress | undefined; onEdit: () => void }) {
  const remove = useDeleteExperiment();
  const contacted = progress?.contacted ?? 0;
  const conversations = progress?.conversations ?? 0;

  return (
    <PaperCard className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-paper-display text-[17px] font-bold tracking-[-0.01em] text-paper-moss">{experiment.name}</h3>
          <p className="text-[12.5px] text-paper-sage">{CHANNEL_LABELS[experiment.channel]}</p>
        </div>
        <Tag tone={experiment.status === "running" ? "green" : "muted"}>{STATUS_LABEL[experiment.status]}</Tag>
      </div>

      <p className="mt-3 text-[14px] leading-6 text-paper-char">
        <span className="font-semibold text-paper-moss">Hypothesis: </span>
        {experiment.hypothesis}
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-4">
        <Stat label="Budget" value={experiment.budget ?? "-"} />
        <Stat
          label="Window"
          value={experiment.startedOn || experiment.endsOn ? `${experiment.startedOn ? formatShortDate(experiment.startedOn) : "?"} – ${experiment.endsOn ? formatShortDate(experiment.endsOn) : "?"}` : "-"}
        />
        <Stat label="Target" value={experiment.targetContacts !== undefined ? `${experiment.targetContacts} contacts` : "-"} />
        <Stat label="Success" value={experiment.successConversations !== undefined ? `${experiment.successConversations} conversations` : "-"} />
      </dl>

      <div className="mt-4 space-y-3">
        <Progress label="Contacted" value={contacted} of={experiment.targetContacts} />
        <Progress label="Conversations" value={conversations} of={experiment.successConversations} />
      </div>

      {experiment.verdict ? (
        <p className="mt-3 text-[13.5px] leading-6 text-paper-moss">
          <span className="font-semibold">Verdict: </span>
          {experiment.verdict}
        </p>
      ) : null}

      <div className="mt-4 flex justify-end gap-1.5">
        <PaperButton variant="ghost" onClick={onEdit}>
          Edit
        </PaperButton>
        <PaperButton
          aria-label={`Remove ${experiment.name}`}
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`Remove “${experiment.name}”? Tagged prospects stay; they lose the tag.`)) remove.mutate(experiment.id);
          }}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </PaperButton>
      </div>
    </PaperCard>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11.5px] font-semibold tracking-[0.06em] text-paper-sage uppercase">{label}</dt>
      <dd className="text-paper-moss">{value}</dd>
    </div>
  );
}

function Progress({ label, value, of }: { label: string; value: number; of: number | undefined }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[13px]">
        <span className="text-paper-char">{label}</span>
        <span className="font-medium text-paper-moss tabular-nums">
          {value}
          {of !== undefined ? <span className="text-paper-ash"> / {of}</span> : null}
        </span>
      </div>
      <Meter value={of ? value / of : undefined} label={`${label}: ${value}${of !== undefined ? ` of ${of}` : ""}`} tone={of && value >= of ? "green" : "ink"} />
    </div>
  );
}

function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : undefined;
}

function ExperimentForm({ experiment, onDone }: { experiment?: Experiment; onDone: () => void }) {
  const [draft, setDraft] = useState({
    name: experiment?.name ?? "",
    channel: experiment?.channel ?? "linkedin",
    hypothesis: experiment?.hypothesis ?? "",
    status: experiment?.status ?? "planned",
    budget: experiment?.budget ?? "",
    startedOn: experiment?.startedOn ?? "",
    endsOn: experiment?.endsOn ?? "",
    targetContacts: experiment?.targetContacts?.toString() ?? "",
    successConversations: experiment?.successConversations?.toString() ?? "",
    verdict: experiment?.verdict ?? "",
  });
  const save = useSaveExperiment();

  const set = (key: keyof typeof draft) => (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [key]: event.target.value }));

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const input: ExperimentInput = {
          name: draft.name.trim(),
          channel: ExperimentChannelSchema.parse(draft.channel),
          hypothesis: draft.hypothesis.trim(),
          status: ExperimentStatusSchema.parse(draft.status),
          budget: optional(draft.budget),
          startedOn: optional(draft.startedOn),
          endsOn: optional(draft.endsOn),
          targetContacts: numberOrUndefined(draft.targetContacts),
          successConversations: numberOrUndefined(draft.successConversations),
          verdict: optional(draft.verdict),
        };
        save.mutate({ experimentId: experiment?.id, input }, { onSuccess: onDone });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <FieldLabel>Name</FieldLabel>
          <input required maxLength={120} placeholder="Founder LinkedIn outreach" className={cn(PAPER_INPUT, "w-full")} value={draft.name} onChange={set("name")} />
        </label>
        <label className="block">
          <FieldLabel>Channel</FieldLabel>
          <select className={cn(PAPER_INPUT, "w-full")} value={draft.channel} onChange={set("channel")}>
            {ExperimentChannelSchema.options.map((channel) => (
              <option key={channel} value={channel}>
                {CHANNEL_LABELS[channel]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <FieldLabel>Hypothesis</FieldLabel>
        <textarea
          required
          maxLength={500}
          rows={2}
          placeholder="Personal outreach to property agency owners will create qualified conversations."
          className={cn(PAPER_INPUT, "w-full py-2")}
          value={draft.hypothesis}
          onChange={set("hypothesis")}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <FieldLabel>Status</FieldLabel>
          <select className={cn(PAPER_INPUT, "w-full")} value={draft.status} onChange={set("status")}>
            {STATUS_ORDER.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <FieldLabel>Starts</FieldLabel>
          <input type="date" className={cn(PAPER_INPUT, "w-full")} value={draft.startedOn} onChange={set("startedOn")} />
        </label>
        <label className="block">
          <FieldLabel>Ends</FieldLabel>
          <input type="date" className={cn(PAPER_INPUT, "w-full")} value={draft.endsOn} onChange={set("endsOn")} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <FieldLabel>Budget</FieldLabel>
          <input maxLength={60} placeholder="R0" className={cn(PAPER_INPUT, "w-full")} value={draft.budget} onChange={set("budget")} />
        </label>
        <label className="block">
          <FieldLabel>Target contacts</FieldLabel>
          <input type="number" min={0} inputMode="numeric" className={cn(PAPER_INPUT, "w-full")} value={draft.targetContacts} onChange={set("targetContacts")} />
        </label>
        <label className="block">
          <FieldLabel>Success = conversations</FieldLabel>
          <input type="number" min={0} inputMode="numeric" className={cn(PAPER_INPUT, "w-full")} value={draft.successConversations} onChange={set("successConversations")} />
        </label>
      </div>
      {experiment ? (
        <label className="block">
          <FieldLabel>Verdict</FieldLabel>
          <textarea maxLength={500} rows={2} placeholder="Continue another week. Improve the initial offer." className={cn(PAPER_INPUT, "w-full py-2")} value={draft.verdict} onChange={set("verdict")} />
        </label>
      ) : null}
      <div className="flex gap-2 pt-1">
        <PaperButton type="submit" variant="amber" disabled={save.isPending}>
          {save.isPending ? "Saving…" : experiment ? "Save experiment" : "Add experiment"}
        </PaperButton>
        <PaperButton onClick={onDone}>Cancel</PaperButton>
      </div>
      {save.error ? (
        <p role="alert" className="text-[13px] text-paper-flame-deep">
          {save.error.message}
        </p>
      ) : null}
    </form>
  );
}
