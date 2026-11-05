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
  PageLoader,
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
  { name: "Canvas", value: "#111315", className: "bg-background" },
  { name: "Sidebar", value: "#15181B", className: "bg-sidebar" },
  { name: "Panel", value: "#1A1E22", className: "bg-paper-white" },
  { name: "Raised", value: "#22272D", className: "bg-paper-linen" },
  { name: "Selected", value: "#273B34", className: "bg-selected" },
  { name: "Divider", value: "#30363D", className: "bg-paper-mist" },
  { name: "Control edge", value: "#65717D", className: "bg-paper-ash" },
  { name: "Primary text", value: "#EEF1F4", className: "bg-paper-moss" },
  { name: "Secondary text", value: "#ACB5BF", className: "bg-paper-char" },
  { name: "Muted text", value: "#8E99A5", className: "bg-paper-sage" },
  { name: "Mint", value: "#9DDBBD", className: "bg-primary" },
  { name: "Mint hover", value: "#B4E6CE", className: "bg-[var(--accent-hover)]" },
  { name: "Ink", value: "#12231B", className: "bg-[var(--on-accent)]" },
  { name: "Focus", value: "#B0D6FF", className: "bg-[var(--focus)]" },
  { name: "Warning", value: "#E8C58A", className: "bg-paper-marigold" },
  { name: "Error", value: "#F4A3A8", className: "bg-paper-flame" },
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
    >
      <div className="qt-page">
        <PageHeader
          title="Quiet Terminal"
          description="Neutral graphite, a measured mint accent, and a clear reading order. These are the live components; DESIGN.md is the authority."
          actions={
            <>
                            <CommandButton variant="primary" icon={ArrowRight}>
                Start session
              </CommandButton>
            </>
          }
        />

        <div className="mt-12 space-y-14 pb-16">
          <SpecimenSection
            label="Palette"
            title="Graphite and mint"
            description="Surfaces step from canvas to panel to raised. Mint is rationed: one primary action per view, the brand mark and the selected rail. Status always carries a word."
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 xl:grid-cols-6">
              {colorTokens.map((token) => (
                <ColorToken key={token.name} {...token} />
              ))}
            </div>
          </SpecimenSection>

          <SpecimenSection
            label="Typography"
            title="Readable sans, mono for what a machine named"
            description="Geist Sans for reading and controls. Geist Mono for IDs, paths, shortcuts and runtime details. Both are bundled locally."
          >
            <div className="border-y border-os-border">
              <TypeSpecimen
                label="Page heading"
                detail="28 / 36 / 600"
                className="text-[28px] leading-9 font-semibold tracking-[-0.02em]"
              >
                Quiet systems, clear intent.
              </TypeSpecimen>
              <TypeSpecimen
                label="Section heading"
                detail="16 / 24 / 600"
                className="text-[16px] leading-6 font-semibold"
              >
                Active workspaces
              </TypeSpecimen>
              <TypeSpecimen
                label="Body"
                detail="14 / 22 / 400"
                className="max-w-[68ch] text-[14px] leading-[1.5] text-os-muted"
              >
                AgentOS keeps the next useful action visible without turning the
                workspace into a reporting screen.
              </TypeSpecimen>
              <TypeSpecimen
                label="Runtime and paths"
                detail="12 / 18 / mono"
                className="os-meta text-os-muted"
              >
                Hermes / Connected / Local
              </TypeSpecimen>
            </div>
          </SpecimenSection>

          <SpecimenSection
            label="Labels & actions"
            title="Controls state their purpose plainly"
            description="Lime primary actions use ink text. Secondary controls use graphite surfaces and visible borders. All controls retain clear keyboard focus."
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
                <h3 className="mt-8 text-[16px] font-medium">System foundation</h3>
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
            label="Loading"
            title="DedSec wait, full page and in a card"
            description="Every route and panel wait uses the same looping DedSec animation. Button spinners stay as they are."
          >
            <div className="grid gap-4 xl:grid-cols-2">
              <PageLoader variant="page" delayMs={0} className="min-h-[22rem] border border-os-border" />
              <HairlineCard className="p-0">
                <PageLoader variant="compact" delayMs={0} />
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
