import {
  Archive,
  ArrowLeft,
  ArrowRight,
  FileText,
  Images,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Send,
  Settings2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ProjectDetail } from "@shared/agentos-types";
import { CommandButton, PriorityTag, StatusPill } from "@/components/os";
import { SourceViewer, useWorkspaceFeedback } from "@/features/workspace";
import { useArchiveProject } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { stateLabel, statePill } from "../projects-model";
import { HEALTH_LABELS, healthPill } from "../roadmap-model";

export interface ProjectHeaderProps {
  project: ProjectDetail;
  /** The Hermes command the agent console will prepare. */
  sessionCommand: string;
  onStartSession: () => void;
  onAddTask: () => void;
  onDelegate: () => void;
  onOpenSettings: () => void;
}

/**
 * Identity, state, and the actions worth taking from anywhere on the project.
 *
 * Four actions, in order of how often they are reached for: start a session,
 * add a task, delegate one, and everything else behind `⋯`. The menu holds the
 * things that are important but not frequent — settings, the raw files, the
 * design workspace, archiving — so the row stays readable at a glance.
 */
export function ProjectHeader({
  project,
  sessionCommand,
  onStartSession,
  onAddTask,
  onDelegate,
  onOpenSettings,
}: ProjectHeaderProps) {
  const [viewingSource, setViewingSource] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const archive = useArchiveProject(project.slug);
  const feedback = useWorkspaceFeedback();
  const navigate = useNavigate();

  const archived = project.state === "archived";

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const toggleArchive = () =>
    archive.mutate(archived ? "incubating" : undefined, {
      onSuccess: () =>
        feedback.recordEdit(archived ? `${project.name} restored.` : `${project.name} archived.`),
      onError: (error) => feedback.reportFailure(error),
    });

  return (
    <header className="border-b border-os-border pb-8">
      <Link
        to="/projects"
        className="os-focus-ring os-meta -mx-2 inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-os-subtle transition-colors duration-150 hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        All projects
      </Link>

      <div className="mt-5 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-[clamp(2rem,4vw,3rem)] leading-[1.05] font-normal tracking-[-0.03em] text-balance">
            {project.name}
          </h1>

          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
            {project.type ? <span className="os-meta text-os-subtle">{project.type}</span> : null}
            <StatusPill status={statePill(project.state)} label={stateLabel(project.state)} />
            <PriorityTag priority={project.priority} />
            {project.health ? (
              <StatusPill status={healthPill(project.health)} label={HEALTH_LABELS[project.health]} />
            ) : null}
            {project.configuration.taskPrefix ? (
              <span className="os-meta text-os-subtle">{project.configuration.taskPrefix}-···</span>
            ) : null}
          </div>

          {project.status ? (
            <p className="mt-5 max-w-[68ch] text-[15px] leading-6 text-os-muted">{project.status}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-start gap-3 md:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <CommandButton variant="primary" icon={ArrowRight} onClick={onStartSession}>
              Start session
            </CommandButton>

            <CommandButton variant="secondary" icon={Plus} iconPosition="start" onClick={onAddTask}>
              Task
            </CommandButton>

            <CommandButton variant="secondary" icon={Send} iconPosition="start" onClick={onDelegate}>
              Delegate
            </CommandButton>

            <div ref={menuRef} className="relative">
              <button
                type="button"
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
                className={cn(
                  "os-focus-ring inline-flex min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-md border transition-colors duration-150",
                  menuOpen
                    ? "border-os-border-strong bg-os-surface-raised text-foreground"
                    : "border-os-border text-os-muted hover:border-os-border-strong hover:text-foreground",
                )}
              >
                <MoreHorizontal className="size-4" strokeWidth={1.5} aria-hidden="true" />
              </button>

              {menuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-lg border border-os-border-strong bg-os-surface-raised py-1"
                >
                  <MenuItem
                    icon={Settings2}
                    label="Settings"
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenSettings();
                    }}
                  />
                  <MenuItem
                    icon={Images}
                    label="Open design workspace"
                    onClick={() => {
                      setMenuOpen(false);
                      void navigate(`/designs?project=${encodeURIComponent(project.slug)}`);
                    }}
                  />
                  {/* The vault, visible. AgentOS is a better way to operate
                      these files, not a replacement for them. */}
                  <MenuItem
                    icon={FileText}
                    label="View source"
                    onClick={() => {
                      setMenuOpen(false);
                      setViewingSource(true);
                    }}
                  />
                  <div className="my-1 h-px bg-os-border" aria-hidden="true" />
                  <MenuItem
                    icon={archived ? RotateCcw : Archive}
                    label={archived ? "Restore project" : "Archive project"}
                    onClick={() => {
                      setMenuOpen(false);
                      toggleArchive();
                    }}
                  />
                </div>
              ) : null}
            </div>
          </div>

          {/* Opens the console with the command ready; it is not sent for you. */}
          <p className="os-meta min-h-4 text-os-subtle">Prepares {sessionCommand}</p>
        </div>
      </div>

      {viewingSource ? <SourceViewer project={project.slug} onClose={() => setViewingSource(false)} /> : null}
    </header>
  );
}

function MenuItem({ icon: Icon, label, onClick }: { icon: typeof Settings2; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="os-focus-ring flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-[14px] leading-5 text-os-muted transition-colors duration-150 hover:bg-os-surface-active hover:text-foreground"
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
      {label}
    </button>
  );
}
