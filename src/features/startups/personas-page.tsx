import { useState } from "react";
import type { Persona } from "@shared/startup-types";
import { AppShell, DedsecLoader } from "@/components/os";
import { PAPER_FOCUS, PaperBackLink, PaperEmpty, PaperError, PaperStage, Tag } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { usePersonas, useSavePersona } from "@/lib/agentos/startups";
import { cn } from "@/lib/utils";
import { PersonaEditor } from "./persona-editor";

/** The persona library: field experts written once and reused by every venture they fit. */
export function PersonasPage() {
  const navigationItems = useNavigationItems();
  const personas = usePersonas();
  const save = useSavePersona();
  const [editing, setEditing] = useState<Persona>();

  return (
    <AppShell navigationItems={navigationItems} pageId="startups" activeHref="/startups" agentState="idle" agentLabel="Agents / idle" modelLabel="Model / AgentOS V1">
      <PaperStage>
        <PaperBackLink to="/startups">Startups</PaperBackLink>
        <header className="mt-4 max-w-[72ch]">
          <h1 className="font-paper-display text-[28px] leading-[1.15] font-extrabold tracking-[-0.015em] text-paper-moss sm:text-[34px]">Persona library</h1>
          <p className="mt-2 text-[14px] leading-6 text-paper-char">
            Field experts who vet ideas against their real working day. Each lives in saas/personas/ in your vault, and is offered again to every venture it fits. New personas are written from a venture's Validate stage.
          </p>
        </header>

        <div className="mt-8">
          {personas.isPending ? (
            <DedsecLoader variant="compact" />
          ) : personas.error ? (
            <PaperError headingLevel="h2" title="The persona library could not be read." detail={personas.error.message} onRetry={() => void personas.refetch()} isRetrying={personas.isFetching} />
          ) : personas.data.length === 0 ? (
            <PaperEmpty title="No personas yet." description="Open a venture's Validate stage and ask Hermes who should vet it. The personas you save there appear here." />
          ) : editing ? (
            <PersonaEditor
              persona={editing}
              saving={save.isPending}
              error={save.error?.message}
              onCancel={() => setEditing(undefined)}
              onSave={(persona) => save.mutate(persona, { onSuccess: () => setEditing(undefined) })}
            />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {personas.data.map((persona) => (
                <li key={persona.slug}>
                  <button
                    type="button"
                    onClick={() => setEditing(persona)}
                    className={cn("block h-full w-full cursor-pointer border border-paper-mist bg-paper-white p-5 text-left transition-colors duration-150 hover:border-paper-ash hover:bg-paper-linen", PAPER_FOCUS)}
                  >
                    <p className="font-paper-display text-[17px] font-bold text-paper-moss">{persona.name}</p>
                    <p className="text-[13.5px] text-paper-sage">
                      {persona.role}
                      {persona.industry ? ` · ${persona.industry}` : ""}
                    </p>
                    {persona.summary ? <p className="mt-2 line-clamp-3 text-[13.5px] leading-6 text-paper-char">{persona.summary}</p> : null}
                    <div className="mt-3">
                      <Tag>{persona.usedBy.length === 1 ? "Used by 1 venture" : `Used by ${persona.usedBy.length} ventures`}</Tag>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PaperStage>
    </AppShell>
  );
}
