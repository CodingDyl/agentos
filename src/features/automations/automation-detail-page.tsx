import { ArrowLeft, Play, TriangleAlert } from "lucide-react";
import { useCallback } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Automation } from "@shared/agentos-types";
import {
  AppShell,
  CommandButton,
  ErrorState,
  LoadingState,
  Section,
  StatusPill,
} from "@/components/os";
import { useNavigationItems } from "@/config/use-navigation";
import { reportActivity } from "@/lib/agentos/client";
import { useAutomation } from "@/lib/agentos/queries";
import {
  commandFor,
  formatRunTime,
  formatSchedule,
  labelFor,
  statusFor,
} from "./automations-model";
import { RunHistory } from "./run-history";

const PAGE_PADDING =
  "mx-auto w-full max-w-[1400px] px-5 py-8 sm:px-8 lg:px-12 lg:py-12";

/** One labelled fact, at the detail screen's weight. */
function Fact({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "danger";
}) {
  return (
    <div className="min-w-0">
      <p className="os-meta text-os-subtle">{label}</p>
      <p
        className={
          tone === "danger"
            ? "mt-3 text-[15px] leading-6 text-os-danger"
            : "mt-3 text-[15px] leading-6 text-os-muted"
        }
      >
        {value}
      </p>
    </div>
  );
}

export function AutomationDetailPage() {
  const navigationItems = useNavigationItems();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data, isPending, isFetching, error, refetch } = useAutomation(id);

  /**
   * Runs the automation's skill by hand.
   *
   * This starts nothing new: it hands the same skill to the agent console,
   * which runs it through the Runs system the rest of the app already uses. One
   * execution path, one place that streams activity, one transcript.
   */
  const runNow = useCallback(
    (command: string, name: string) => {
      // A schedule fired by hand is a decision, and the audit trail should say
      // who made it — the run that follows is recorded by the console.
      void reportActivity({ type: "automation.run", description: name });
      navigate(`/agent?run=${encodeURIComponent(command)}`);
    },
    [navigate],
  );

  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="automation"
      activeHref="/automations"
      contextLabel={data ? `Automation / ${data.automation.name}` : undefined}
      modelLabel="Model / AgentOS V1"
    >
      <div className={PAGE_PADDING}>
        {isPending ? (
          <LoadingState
            label="Automation"
            message="Reading run history…"
            detail="Hermes / cron"
          />
        ) : !data ? (
          <ErrorState
            label="Automation unavailable"
            title="Could not read this automation."
            detail={error?.message}
            hint="Hermes may have removed the job, or the CLI could not be reached."
            onRetry={() => void refetch()}
            isRetrying={isFetching}
          />
        ) : (
          <AutomationDetail automation={data.automation} onRun={runNow}>
            <RunHistory runs={data.runs} />
          </AutomationDetail>
        )}
      </div>
    </AppShell>
  );
}

interface AutomationDetailProps {
  automation: Automation;
  onRun: (command: string, name: string) => void;
  children: React.ReactNode;
}

function AutomationDetail({
  automation,
  onRun,
  children,
}: AutomationDetailProps) {
  const command = commandFor(automation);
  const lastRun = automation.lastRun;
  const nextRun = formatRunTime(automation.nextRun);

  return (
    <>
      <header className="border-b border-os-border pb-8">
        <Link
          to="/automations"
          className="os-focus-ring os-meta -mx-2 inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-os-subtle transition-colors duration-150 hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          All automations
        </Link>

        <div className="mt-5 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <h1 className="text-[clamp(2rem,4vw,3rem)] leading-[1.05] font-normal tracking-[-0.03em] text-balance">
              {automation.name}
            </h1>

            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
              <StatusPill
                status={statusFor(automation)}
                label={labelFor(automation)}
              />
              {command ? (
                <span className="font-mono text-[13px] leading-5 text-os-subtle">
                  {command}
                </span>
              ) : null}
            </div>

            <p className="mt-5 max-w-[68ch] text-[15px] leading-6 text-os-muted">
              {formatSchedule(automation.schedule)}
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-start gap-3">
            <CommandButton
              variant="primary"
              icon={Play}
              iconPosition="start"
              disabled={!command}
              onClick={() => command && onRun(command, automation.name)}
            >
              Run now
            </CommandButton>
            {/* Says where the run happens, before it happens. */}
            <p className="os-meta min-h-4 max-w-52 text-os-subtle">
              {command
                ? `Runs ${command} in the agent console`
                : "This job runs a script, not a skill"}
            </p>
          </div>
        </div>
      </header>

      {/* Only shown when Hermes has something to report. */}
      {lastRun?.detail || automation.warnings.length > 0 ? (
        <div className="mt-10 flex max-w-[72ch] gap-3 rounded-lg border border-os-danger/30 bg-os-danger/5 p-5 md:p-6">
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-os-danger"
            strokeWidth={1.5}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="os-meta text-os-subtle">Reported by Hermes</p>
            {lastRun?.detail ? (
              <p className="mt-3 font-mono text-[12px] leading-5 break-words text-os-danger">
                {lastRun.detail}
              </p>
            ) : null}
            {automation.warnings.map((warning) => (
              <p
                key={warning}
                className="mt-3 text-[13px] leading-5 break-words text-os-warning"
              >
                {warning}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-10 grid gap-x-16 gap-y-8 border-b border-os-border pb-10 sm:grid-cols-2 lg:max-w-2xl">
        <Fact
          label="Last run"
          tone={lastRun?.status === "failed" ? "danger" : "default"}
          value={
            lastRun
              ? `${lastRun.status === "failed" ? "Failed" : lastRun.status === "running" ? "Running" : "Success"} · ${
                  formatRunTime(lastRun.timestamp) ?? lastRun.timestamp
                }`
              : "Never run"
          }
        />
        <Fact label="Next run" value={nextRun ?? "Not scheduled"} />
      </div>

      <Section label="Run history" className="mt-10 pb-4">
        {children}
      </Section>
    </>
  );
}
