import { ProspectStageSchema, type TractionData } from "@shared/traction-types";
import { PAPER_FOCUS, PAPER_INPUT, PaperSection, Tag } from "@/components/paper";
import { usePitches } from "@/lib/agentos/pitch";
import { useUpdateProspect } from "@/lib/agentos/traction";
import { cn } from "@/lib/utils";
import { formatShortDate, PIPELINE_STAGES, stageLabel } from "./traction-model";

/**
 * The pipeline as columns — a simple one, not a sales CRM.
 *
 * A stage moves only when a person moves it, with a select rather than a drag:
 * a drag is too easy to do by accident for something that feeds the weekly
 * numbers.
 */
export function TractionPipelineTab({ data, onOpen }: { data: TractionData; onOpen: (prospectId: string) => void }) {
  const update = useUpdateProspect();
  const pitches = new Map((usePitches().data ?? []).map((pitch) => [pitch.prospectId, pitch.status]));

  return (
    <PaperSection label="Pipeline" count={data.prospects.length - data.pipeline.lost}>
      <div className="grid gap-4 overflow-x-auto pb-2 md:grid-cols-5">
        {PIPELINE_STAGES.map((stage) => {
          const prospects = data.prospects.filter((prospect) => prospect.stage === stage);

          return (
            <section key={stage} aria-label={stageLabel(stage)} className="min-w-[13rem]">
              <h3 className="mb-2 flex items-baseline justify-between border-b border-paper-mist pb-2 text-[13px] font-semibold text-paper-sage">
                {stageLabel(stage)}
                <span className="text-[14px] tracking-normal text-paper-moss tabular-nums">{prospects.length}</span>
              </h3>
              <ul className="space-y-2">
                {prospects.map((prospect) => (
                  <li key={prospect.id} className="rounded-md border border-paper-mist bg-paper-white p-3">
                    <button
                      type="button"
                      onClick={() => onOpen(prospect.id)}
                      className={cn("cursor-pointer rounded-sm text-left text-[14px] font-medium text-paper-moss hover:underline", PAPER_FOCUS)}
                    >
                      {prospect.company}
                    </button>
                    {pitches.get(prospect.id) === "pitched" ? (
                      <Tag tone="blue" className="mt-1">Pitched with preview</Tag>
                    ) : pitches.get(prospect.id) === "ready" ? (
                      <Tag tone="green" className="mt-1">Pitch ready</Tag>
                    ) : null}
                    {prospect.nextAction ? (
                      <p className="mt-0.5 text-[13px] leading-5 text-paper-sage">
                        {prospect.nextAction}
                        {prospect.nextActionDate ? ` · ${formatShortDate(prospect.nextActionDate)}` : ""}
                      </p>
                    ) : null}
                    <label className="mt-2 block">
                      <span className="sr-only">Move {prospect.company} to stage</span>
                      <select
                        className={cn(PAPER_INPUT, "min-h-7 w-full text-[13px]")}
                        value={prospect.stage}
                        disabled={update.isPending && update.variables?.prospectId === prospect.id}
                        onChange={(event) =>
                          update.mutate({ prospectId: prospect.id, patch: { stage: ProspectStageSchema.parse(event.target.value) } })
                        }
                      >
                        {ProspectStageSchema.options.map((option) => (
                          <option key={option} value={option}>
                            {stageLabel(option)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {data.pipeline.lost > 0 ? <p className="mt-4 text-[13px] text-paper-sage">{data.pipeline.lost} lost, kept for the record.</p> : null}
      {update.error ? (
        <p role="alert" className="mt-3 text-[13px] text-paper-flame-deep">
          {update.error.message}
        </p>
      ) : null}
    </PaperSection>
  );
}
