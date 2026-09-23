import { ArrowRight, RefreshCw } from "lucide-react";
import { useState } from "react";
import { ColorToken } from "@/components/design-system/color-token";
import { SpecimenSection } from "@/components/design-system/specimen-section";
import { TypeSpecimen } from "@/components/design-system/type-specimen";
import {
  AgentActivity,
  AgentCommandInput,
  AppShell,
  CommandButton,
  EmptyState,
  HairlineCard,
  PageHeader,
  ProjectCard,
  SectionLabel,
  StatusPill,
  SystemIndicator,
  type AgentActivityStep,
  type AgentStatus,
} from "@/components/os";
import { useNavigationItems } from "@/config/use-navigation";

const colorTokens = [
  { name: "Background", value: "#041C1C", className: "bg-os-background" },
  { name: "Surface", value: "#062322", className: "bg-os-surface" },
  { name: "Raised", value: "#082827", className: "bg-os-surface-raised" },
  { name: "Foreground", value: "#FFE6CB", className: "bg-os-foreground" },
  { name: "Muted", value: "#A7B7B1", className: "bg-os-muted" },
  { name: "Subtle", value: "#7A8F8A", className: "bg-os-subtle" },
  { name: "Amber", value: "#FFBD38", className: "bg-os-amber" },
  { name: "Success", value: "#8FC89A", className: "bg-os-success" },
  { name: "Danger", value: "#D96B5F", className: "bg-os-danger" },
];

const statusStates: AgentStatus[] = [
  "active",
  "running",
  "healthy",
  "paused",
  "incubating",
  "blocked",
  "attention",
];

const runningSteps: AgentActivityStep[] = [
  { id: "context", label: "Read Pantry Pilot context", detail: "0.4s", state: "complete" },
  { id: "git", label: "Checked local Git state", detail: "0.8s", state: "complete" },
  { id: "task", label: "Analysing active task", detail: "Running", state: "current" },
  { id: "plan", label: "Prepare implementation plan", state: "pending" },
];

const blockedSteps: AgentActivityStep[] = [
  { id: "context", label: "Loaded project context", state: "complete" },
  { id: "permissions", label: "Workspace permission required", detail: "Action needed", state: "error" },
  { id: "continue", label: "Continue execution", state: "pending" },
];

const commandSuggestions = [
  { command: "/start-day", description: "Review priorities and constraints" },
  { command: "/project-sync", description: "Refresh active project context" },
  { command: "/capture", description: "Store a note or decision" },
];

export function DesignSystemPage() {
  const navigationItems = useNavigationItems();
  const [lastCommand, setLastCommand] = useState<string>();

  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="design-system"
      activeHref="/design-system"
      modelLabel="Model / AgentOS V1"
    >
      <div className="mx-auto w-full max-w-[1400px] px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
        <PageHeader
          title="AgentOS visual foundation"
          description="An internal approval surface for the Editorial Terminal system: warm, architectural, precise, and deliberately quiet. Every future screen should inherit these decisions rather than invent new ones."
          actions={
            <>
              <StatusPill status="healthy" label="V1 foundation" />
              <CommandButton variant="primary" icon={ArrowRight}>
                Start session
              </CommandButton>
            </>
          }
        />

        <div className="mt-12 space-y-14 pb-16">
          <SpecimenSection
            label="Palette"
            title="Low-light surfaces, warm information"
            description="The canvas carries the atmosphere. Cream carries hierarchy. Signal colors stay small enough to retain meaning."
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 xl:grid-cols-5">
              {colorTokens.map((token) => (
                <ColorToken key={token.name} {...token} />
              ))}
            </div>
          </SpecimenSection>

          <SpecimenSection
            label="Typography"
            title="Editorial hierarchy with machine-readable detail"
            description="Inter handles reading and action. IBM Plex Mono is reserved for system state, metadata, and commands."
          >
            <div className="border-y border-os-border">
              <TypeSpecimen
                label="Display"
                detail="48–64 / 400"
                className="text-[clamp(2.4rem,5vw,4rem)] leading-[1] tracking-[-0.035em]"
              >
                Quiet systems, clear intent.
              </TypeSpecimen>
              <TypeSpecimen
                label="Page"
                detail="32 / 400"
                className="text-[32px] leading-[1.05] tracking-[-0.025em]"
              >
                Your work, in focus
              </TypeSpecimen>
              <TypeSpecimen
                label="Section"
                detail="22 / 400"
                className="text-[22px] leading-[1.15] tracking-[-0.02em]"
              >
                Active projects
              </TypeSpecimen>
              <TypeSpecimen
                label="Body"
                detail="15 / 400"
                className="max-w-[68ch] text-[15px] leading-[1.5] text-os-muted"
              >
                AgentOS keeps the next useful action visible without turning the
                workspace into a reporting screen.
              </TypeSpecimen>
              <TypeSpecimen
                label="Metadata"
                detail="11 / 400"
                className="os-meta text-os-muted"
              >
                Hermes / Connected / Local
              </TypeSpecimen>
            </div>
          </SpecimenSection>

          <SpecimenSection
            label="Labels & actions"
            title="Controls state their purpose plainly"
            description="Cream is the primary action color. Amber is reserved for focus and live state, never used as a default fill."
          >
            <div className="grid gap-8 xl:grid-cols-2">
              <div>
                <SectionLabel>Command buttons</SectionLabel>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <CommandButton variant="primary" icon={ArrowRight}>
                    Start session
                  </CommandButton>
                  <CommandButton variant="secondary" icon={RefreshCw}>
                    Project sync
                  </CommandButton>
                  <CommandButton variant="quiet">View context</CommandButton>
                  <CommandButton disabled>Disabled</CommandButton>
                  <CommandButton loading loadingLabel="Syncing">
                    Sync
                  </CommandButton>
                </div>
              </div>
              <div>
                <SectionLabel>Status pills</SectionLabel>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {statusStates.map((status) => (
                    <StatusPill key={status} status={status} />
                  ))}
                </div>
              </div>
            </div>
          </SpecimenSection>

          <SpecimenSection
            label="Cards"
            title="Structure without artificial elevation"
            description="Borders, surface contrast, and spacing create separation. Cards remain sparse and never depend on shadows."
          >
            <div className="grid gap-4 xl:grid-cols-3">
              <HairlineCard className="p-5 md:p-6">
                <SectionLabel>Current focus</SectionLabel>
                <h3 className="mt-8 text-base font-medium">System foundation</h3>
                <p className="mt-2 text-[13px] leading-5 text-os-muted">
                  Validate tokens and primitives before production screens begin.
                </p>
              </HairlineCard>
              <ProjectCard
                name="Pantry Pilot"
                status="active"
                priority="High"
                summary="Production refinement and release readiness."
                lastActivity="12 min ago"
                to="#project-card"
              />
              <ProjectCard
                name="AgentOS"
                status="running"
                priority="Medium"
                summary="Establish the V1 interface language."
                lastActivity="Just now"
                to="#project-card"
              />
            </div>
          </SpecimenSection>

          <SpecimenSection
            label="Command surface"
            title="A terminal control, not a chat bubble"
            description="The input exposes context, keyboard affordance, command discovery, disabled state, and running state without changing its basic shape."
          >
            <div className="grid items-start gap-4 xl:grid-cols-2">
              <div>
                <AgentCommandInput
                  activeContext="AgentOS / Design system"
                  suggestions={commandSuggestions}
                  showSuggestions
                  onSubmit={setLastCommand}
                />
                <p className="os-meta mt-3 min-h-4 text-os-subtle" aria-live="polite">
                  {lastCommand ? `Last command / ${lastCommand}` : "Ready for input"}
                </p>
              </div>
              <div className="space-y-4">
                <AgentCommandInput
                  defaultValue="/project-sync AgentOS"
                  activeContext="AgentOS"
                  running
                />
                <AgentCommandInput disabled placeholder="Command input disabled" />
              </div>
            </div>
          </SpecimenSection>

          <SpecimenSection
            label="System state"
            title="Status remains legible without relying on color"
          >
            <HairlineCard className="divide-y divide-os-border">
              {[
                ["online", "Hermes", "Connected"],
                ["syncing", "Workspace", "Indexing"],
                ["degraded", "GitHub", "Attention"],
                ["offline", "Calendar", "Offline"],
              ].map(([state, label, detail]) => (
                <div
                  key={label}
                  className="flex min-h-14 items-center px-5 md:px-6"
                >
                  <SystemIndicator
                    state={state as "online" | "syncing" | "degraded" | "offline"}
                    label={label}
                    detail={detail}
                  />
                </div>
              ))}
            </HairlineCard>
          </SpecimenSection>

          <SpecimenSection
            label="Agent activity"
            title="Progress is expressed as meaningful work"
          >
            <div className="grid gap-4 xl:grid-cols-2">
              <HairlineCard>
                <AgentActivity steps={runningSteps} running />
              </HairlineCard>
              <HairlineCard>
                <AgentActivity
                  title="Approval required"
                  steps={blockedSteps}
                />
              </HairlineCard>
            </div>
          </SpecimenSection>

          <SpecimenSection
            label="Empty state"
            title="Quiet by default, useful when needed"
          >
            <div className="grid gap-4 xl:grid-cols-2">
              <EmptyState
                label="No captured ideas"
                description="Your inbox is clear."
              />
              <EmptyState
                label="No active session"
                description="Start a focused session when you are ready to work."
                action={
                  <CommandButton variant="secondary" icon={ArrowRight}>
                    Start session
                  </CommandButton>
                }
              />
            </div>
          </SpecimenSection>
        </div>
      </div>
    </AppShell>
  );
}
