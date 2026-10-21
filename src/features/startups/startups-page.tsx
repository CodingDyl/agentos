import { Lightbulb, Sparkles, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { STARTUP_STAGES, type BrainstormIdea, type Venture } from "@shared/startup-types";
import { AppShell, DedsecLoader } from "@/components/os";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperCard, PaperEmpty, PaperError, PaperStage, Tag } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { formatRelativeTime } from "@/lib/format";
import { useBrainstorm, useCreateVenture, useVentures } from "@/lib/agentos/startups";
import { cn } from "@/lib/utils";

/**
 * Startups: ideas walked from first thought to an MVP, one gated stage at a
 * time. Every venture is filed under saas/ in the vault, so the next one can
 * learn from it.
 */
export function StartupsPage() {
  const navigationItems = useNavigationItems();
  const ventures = useVentures();
  const [mode, setMode] = useState<"idle" | "idea" | "brainstorm">("idle");

  return (
    <AppShell navigationItems={navigationItems} pageId="startups" activeHref="/startups" agentState="idle" agentLabel="Agents / idle" modelLabel="Model / AgentOS V1">
      <PaperStage>
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-[72ch]">
            <h1 className="font-paper-display text-[28px] leading-[1.15] font-extrabold tracking-[-0.015em] text-paper-moss sm:text-[34px]">Startups</h1>
            <p className="mt-2 text-[14px] leading-6 text-paper-char">
              Idea, value, validate, MVP, then design, tech, build, test, refine and launch. Each stage is a gate. An idea has to score {8}/10 in Validate to be built, and the MVP stays small.
            </p>
          </div>
          <Link to="/startups/personas" className={cn("inline-flex min-h-8 items-center gap-1.5 px-2 text-[13.5px] font-medium text-paper-sage hover:bg-paper-stone hover:text-paper-moss", PAPER_FOCUS)}>
            <Users className="size-3.5" aria-hidden="true" />
            Persona library
          </Link>
        </header>

        <div className="mt-8 flex flex-wrap gap-2">
          <PaperButton variant="amber" onClick={() => setMode("idea")}>
            <Lightbulb className="size-3.5" aria-hidden="true" />
            Start with my idea
          </PaperButton>
          <PaperButton onClick={() => setMode("brainstorm")}>
            <Sparkles className="size-3.5" aria-hidden="true" />
            Brainstorm ideas
          </PaperButton>
        </div>

        {mode === "idea" ? <NewVenture onCancel={() => setMode("idle")} /> : null}
        {mode === "brainstorm" ? <Brainstorm onCancel={() => setMode("idle")} /> : null}

        <section aria-label="Ventures" className="mt-10">
          {ventures.isPending ? (
            <DedsecLoader variant="compact" />
          ) : ventures.error ? (
            <PaperError headingLevel="h2" title="Ventures could not be read." detail={ventures.error.message} onRetry={() => void ventures.refetch()} isRetrying={ventures.isFetching} />
          ) : ventures.data.length === 0 ? (
            <PaperEmpty title="No ventures yet." description="Start with an idea you already have, or brainstorm a few. Each one gets a folder under saas/ in your vault." />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {ventures.data.map((venture) => (
                <li key={venture.slug}>
                  <VentureCard venture={venture} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </PaperStage>
    </AppShell>
  );
}

const STATUS_TONE: Record<Venture["status"], "green" | "marigold" | "flame" | "muted" | "blue"> = {
  exploring: "muted",
  validating: "marigold",
  building: "blue",
  testing: "blue",
  live: "green",
  paused: "muted",
  stopped: "flame",
};

function VentureCard({ venture }: { venture: Venture }) {
  const stageIndex = STARTUP_STAGES.findIndex((stage) => stage.id === venture.stage);
  return (
    <Link to={`/startups/${venture.slug}`} className={cn("block h-full border border-paper-mist bg-paper-white p-5 transition-colors duration-150 hover:border-paper-ash hover:bg-paper-linen", PAPER_FOCUS)}>
      <div className="flex items-start justify-between gap-3">
        <p className="font-paper-display text-[17px] font-bold text-paper-moss">{venture.name}</p>
        <Tag tone={STATUS_TONE[venture.status]}>{venture.status}</Tag>
      </div>
      {venture.pitch ? <p className="mt-1 line-clamp-2 text-[13.5px] leading-6 text-paper-char">{venture.pitch}</p> : null}
      <ol className="mt-4 flex gap-1" aria-label={`Stage ${stageIndex + 1} of ${STARTUP_STAGES.length}: ${STARTUP_STAGES[stageIndex]?.label}`}>
        {STARTUP_STAGES.map((stage, index) => (
          <li key={stage.id} className={cn("h-1.5 flex-1", index < stageIndex ? "bg-paper-moss" : index === stageIndex ? (venture.status === "stopped" ? "bg-paper-flame" : "bg-paper-blue") : "bg-paper-stone")} />
        ))}
      </ol>
      <p className="mt-2 text-[12.5px] text-paper-sage">
        {STARTUP_STAGES[stageIndex]?.label} · {formatRelativeTime(venture.updated)}
      </p>
    </Link>
  );
}

function NewVenture({ onCancel, initial }: { onCancel: () => void; initial?: BrainstormIdea }) {
  const create = useCreateVenture();
  const navigate = useNavigate();
  const [name, setName] = useState(initial?.title ?? "");
  const [pitch, setPitch] = useState(initial ? `${initial.oneLiner}${initial.who ? ` For ${initial.who}.` : ""}` : "");

  return (
    <PaperCard className="mt-4 max-w-[760px] p-6">
      <label className="block">
        <FieldLabel>A working name</FieldLabel>
        <input value={name} autoFocus onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Matter Desk" className={cn(PAPER_INPUT, "w-full")} />
      </label>
      <label className="mt-4 block">
        <FieldLabel>One line (optional)</FieldLabel>
        <input value={pitch} onChange={(event) => setPitch(event.target.value)} maxLength={1000} placeholder="Matter intake for small law firms" className={cn(PAPER_INPUT, "w-full")} />
      </label>
      <div className="mt-5 flex gap-2">
        <PaperButton
          variant="amber"
          disabled={create.isPending || !name.trim()}
          onClick={() => create.mutate({ name: name.trim(), pitch: pitch.trim() || undefined, origin: initial ? "brainstorm" : "idea" }, { onSuccess: (detail) => void navigate(`/startups/${detail.venture.slug}`) })}
        >
          {create.isPending ? "Creating…" : "Create and start"}
        </PaperButton>
        <PaperButton onClick={onCancel}>Cancel</PaperButton>
      </div>
      {create.error ? <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">{create.error.message}</p> : null}
    </PaperCard>
  );
}

function Brainstorm({ onCancel }: { onCancel: () => void }) {
  const brainstorm = useBrainstorm();
  const [focus, setFocus] = useState("");
  const [picked, setPicked] = useState<BrainstormIdea>();

  if (picked) return <NewVenture initial={picked} onCancel={() => setPicked(undefined)} />;

  return (
    <PaperCard className="mt-4 max-w-[900px] p-6">
      <p className="max-w-[66ch] text-[14px] leading-6 text-paper-char">
        Hermes reads your Compass, profile, workspaces and the lessons from earlier ventures, then suggests five SaaS ideas you could build alone. Pick one to start it as a venture.
      </p>
      <label className="mt-4 block">
        <FieldLabel>Anything to focus on? (optional)</FieldLabel>
        <input value={focus} onChange={(event) => setFocus(event.target.value)} maxLength={500} placeholder="e.g. legal, trades, small clinics" className={cn(PAPER_INPUT, "w-full")} />
      </label>
      <div className="mt-4 flex gap-2">
        <PaperButton variant="amber" disabled={brainstorm.isPending} onClick={() => brainstorm.mutate(focus.trim() || undefined)}>
          <Sparkles className="size-3.5" aria-hidden="true" />
          {brainstorm.isPending ? "Hermes is thinking… (usually under a minute, sometimes a few)" : brainstorm.data ? "Five more" : "Brainstorm"}
        </PaperButton>
        <PaperButton onClick={onCancel}>Close</PaperButton>
      </div>
      {brainstorm.error ? <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">{brainstorm.error.message}</p> : null}

      {brainstorm.data ? (
        <ul className="mt-5 grid gap-3 md:grid-cols-2">
          {brainstorm.data.map((idea) => (
            <li key={idea.title} className="flex flex-col border border-paper-mist bg-paper-linen p-4">
              <p className="font-medium text-paper-moss">{idea.title}</p>
              <p className="mt-1 text-[13.5px] leading-6 text-paper-char">{idea.oneLiner}</p>
              {idea.who ? <p className="mt-1 text-[13px] text-paper-sage">For {idea.who}</p> : null}
              {idea.why ? <p className="mt-2 text-[13px] leading-5 text-paper-char">{idea.why}</p> : null}
              <PaperButton className="mt-3 self-start" variant="ghost" onClick={() => setPicked(idea)}>
                Start this one
              </PaperButton>
            </li>
          ))}
        </ul>
      ) : null}
    </PaperCard>
  );
}
