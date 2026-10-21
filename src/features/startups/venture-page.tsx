import { Check, Lock } from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";
import { EDITABLE_STAGES, STARTUP_STAGES, type EditableStage, type StartupStageId, type VentureDetail } from "@shared/startup-types";
import { AppShell, DedsecLoader } from "@/components/os";
import { PAPER_FOCUS, PaperBackLink, PaperError, PaperNotice, PaperStage, Tag } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { useVenture } from "@/lib/agentos/startups";
import { cn } from "@/lib/utils";
import { MvpPanel, SimpleStagePanel } from "./stage-panels";
import { ValidatePanel } from "./validate-panel";

/** One venture: the road of stages, the stage being worked on, and what was parked or decided. */
export function VenturePage() {
  const navigationItems = useNavigationItems();
  const { slug = "" } = useParams();
  const venture = useVenture(slug);

  return (
    <AppShell navigationItems={navigationItems} pageId="startups" activeHref="/startups" agentState="idle" agentLabel="Agents / idle" modelLabel="Model / AgentOS V1">
      <PaperStage>
        <PaperBackLink to="/startups">Startups</PaperBackLink>
        {venture.isPending ? (
          <DedsecLoader variant="page" />
        ) : venture.error ? (
          <div className="mt-6">
            <PaperError headingLevel="h2" title="This venture could not be read." detail={venture.error.message} onRetry={() => void venture.refetch()} isRetrying={venture.isFetching} />
          </div>
        ) : (
          <Venture detail={venture.data} />
        )}
      </PaperStage>
    </AppShell>
  );
}

function isEditable(stage: string): stage is EditableStage {
  return (EDITABLE_STAGES as readonly string[]).includes(stage);
}

function Venture({ detail }: { detail: VentureDetail }) {
  const [params, setParams] = useSearchParams();
  const { venture } = detail;
  const asked = params.get("stage");
  const fallback: EditableStage = isEditable(venture.stage) ? venture.stage : "mvp";
  const active: EditableStage = asked && isEditable(asked) && !detail.locks[asked] ? asked : fallback;
  const latest = detail.scores.at(-1);
  const savedStage = (stage: StartupStageId) => (isEditable(stage) ? detail.stages[stage] !== null : STARTUP_STAGES.findIndex((entry) => entry.id === stage) < STARTUP_STAGES.findIndex((entry) => entry.id === venture.stage));

  return (
    <>
      <header className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-[72ch]">
          <h1 className="font-paper-display text-[28px] leading-[1.15] font-extrabold tracking-[-0.015em] text-balance text-paper-moss sm:text-[34px]">{venture.name}</h1>
          {venture.pitch ? <p className="mt-2 text-[14px] leading-6 text-paper-char">{venture.pitch}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone={venture.status === "stopped" ? "flame" : venture.status === "building" ? "blue" : "muted"}>{venture.status}</Tag>
          {latest ? <Tag tone={latest.passed ? "green" : "flame"}>Score {latest.total}/10</Tag> : null}
          {venture.pivotsUsed > 0 ? <Tag tone="marigold">Pivoted</Tag> : null}
        </div>
      </header>

      {venture.status === "stopped" ? (
        <PaperNotice className="mt-6">
          This venture stopped{venture.outcomeReason ? `: ${venture.outcomeReason}` : "."} What it taught is in saas/LEARNINGS.md, which every new venture reads.
        </PaperNotice>
      ) : null}

      <nav aria-label="Stages" className="mt-8 overflow-x-auto">
        <ol className="flex min-w-max gap-1">
          {STARTUP_STAGES.map((stage, index) => {
            const editable = isEditable(stage.id);
            const lock = editable ? detail.locks[stage.id] : undefined;
            const done = savedStage(stage.id);
            const current = stage.id === active;
            const content = (
              <>
                <span className="flex items-center gap-1.5 text-[12px] font-semibold tracking-[0.06em] uppercase tabular-nums">
                  {done && !current ? <Check className="size-3" aria-hidden="true" /> : null}
                  {lock ? <Lock className="size-3" aria-hidden="true" /> : null}
                  {index + 1}
                </span>
                <span className="mt-0.5 block text-[13.5px] font-medium">{stage.label}</span>
                {!editable ? <span className="block text-[11.5px]">Phase {stage.phase}</span> : null}
              </>
            );
            const style = cn(
              "block w-[7.5rem] border-t-[3px] px-3 py-2 text-left",
              current ? "border-paper-blue bg-paper-white text-paper-moss" : done ? "border-paper-moss text-paper-char" : "border-paper-stone text-paper-sage",
            );
            return (
              <li key={stage.id}>
                {editable && !lock ? (
                  <button
                    type="button"
                    aria-current={current ? "step" : undefined}
                    onClick={() => setParams({ stage: stage.id }, { replace: true })}
                    className={cn(style, "cursor-pointer transition-colors duration-150 hover:bg-paper-linen", PAPER_FOCUS)}
                  >
                    {content}
                  </button>
                ) : (
                  <div className={cn(style, "opacity-70")} title={lock ?? `${stage.label} comes in phase ${stage.phase}: ${stage.gate}`}>
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-label={STARTUP_STAGES.find((stage) => stage.id === active)?.label}>
          <p className="mb-4 max-w-[70ch] text-[13.5px] leading-6 text-paper-sage">
            <span className="font-medium text-paper-char">Gate:</span> {STARTUP_STAGES.find((stage) => stage.id === active)?.gate}
          </p>
          {active === "validate" ? <ValidatePanel detail={detail} /> : active === "mvp" ? <MvpPanel detail={detail} /> : <SimpleStagePanel key={active} detail={detail} stage={active} />}
        </section>

        <aside className="space-y-6">
          <div>
            <h2 className="font-paper-display text-[15px] font-bold text-paper-moss">Later <span className="font-paper-ui text-[12.5px] font-medium text-paper-sage tabular-nums">{detail.later.length}</span></h2>
            {detail.later.length ? (
              <ul className="mt-2 space-y-2 text-[13.5px] leading-5 text-paper-char">
                {detail.later.map((item) => (
                  <li key={`${item.at}-${item.title}`}>
                    {item.title}
                    {item.reason ? <span className="block text-[12.5px] text-paper-sage">{item.reason}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[13px] text-paper-sage">Ideas that don't fit the MVP land here, so nothing is lost and nothing grows the build.</p>
            )}
          </div>
          <div>
            <h2 className="font-paper-display text-[15px] font-bold text-paper-moss">Decisions</h2>
            <ol className="mt-2 space-y-2 text-[13px] leading-5 text-paper-char">
              {[...detail.decisions].reverse().slice(0, 12).map((decision) => (
                <li key={`${decision.at}-${decision.title}`}>
                  <span className="text-paper-sage tabular-nums">{decision.at.slice(0, 10)}</span> {decision.title}
                  {decision.detail ? <span className="block text-[12.5px] text-paper-sage">{decision.detail}</span> : null}
                </li>
              ))}
            </ol>
          </div>
          <p className="text-[12.5px] leading-5 text-paper-sage">Filed in your vault at saas/{venture.slug}/</p>
        </aside>
      </div>
    </>
  );
}
