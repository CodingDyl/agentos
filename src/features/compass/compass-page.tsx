import { useState } from "react";
import type { Compass } from "@shared/compass-types";
import { AppShell } from "@/components/os";
import { PaperButton, PaperError, PaperStage } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { useCompass } from "@/lib/agentos/compass";
import { CompassEditor } from "./compass-editor";
import { CompassInterview } from "./compass-interview";

/**
 * The Compass: where you are heading, what matters, your goals, and which
 * project serves which goal. Today reads it every morning to choose your 3.
 *
 * Until me/COMPASS.md exists, the page is the first-time interview. After
 * that it is the Compass itself, editable in place.
 */
export function CompassPage() {
  const navigationItems = useNavigationItems();
  const compass = useCompass();
  // A draft from the interview, or a blank start, waiting to be saved for the first time.
  const [draft, setDraft] = useState<{ compass: Compass; from: "hermes" | "blank" }>();

  return (
    <AppShell navigationItems={navigationItems} pageId="compass" activeHref="/compass" agentState="idle" agentLabel="Agents / idle" modelLabel="Model / AgentOS V1">
      <PaperStage>
        <header className="max-w-[72ch]">
          <h1 className="font-paper-display text-[28px] leading-[1.15] font-extrabold tracking-[-0.015em] text-paper-moss sm:text-[34px]">Compass</h1>
          <p className="mt-2 text-[14px] leading-6 text-paper-char">
            Where you are heading and what matters. Today reads this every morning when it picks your three things, and the Sunday review keeps it current.
          </p>
        </header>

        <div className="mt-8">
          {compass.isPending ? (
            <div aria-busy="true" className="h-40 border border-paper-mist bg-paper-cream motion-safe:animate-pulse" />
          ) : compass.error ? (
            <PaperError title="The Compass could not be read." detail={compass.error.message} headingLevel="h2" isRetrying={compass.isFetching} onRetry={() => void compass.refetch()} />
          ) : compass.data.exists ? (
            <CompassEditor key={compass.data.revision} read={compass.data} />
          ) : draft ? (
            <CompassEditor
              read={{ exists: false, compass: draft.compass, problems: [], revision: compass.data.revision }}
              notice={draft.from === "hermes" ? "Hermes drafted this from your files and answers. Edit anything, then save it." : "A blank Compass. Fill in what you can; it can grow over time."}
              onDiscard={() => setDraft(undefined)}
            />
          ) : (
            <div className="space-y-4">
              <CompassInterview onDraft={(drafted) => setDraft({ compass: drafted, from: "hermes" })} />
              <PaperButton onClick={() => setDraft({ compass: BLANK, from: "blank" })}>Or start from a blank Compass</PaperButton>
            </div>
          )}
        </div>
      </PaperStage>
    </AppShell>
  );
}

const BLANK: Compass = {
  direction: "",
  values: [],
  areas: ["Business", "Career", "Money", "Health", "Relationships", "Learning"].map((name) => ({ name, status: "unrated" as const })),
  goals: [],
  projects: [],
  thisWeek: [],
};
