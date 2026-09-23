import { ArrowRight, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  AgentMessage,
  AgentSessionMessage,
  ApprovalDecision,
} from "@shared/agentos-types";
import {
  AppShell,
  CommandButton,
  ErrorState,
  HairlineCard,
  Markdown,
  SectionLabel,
} from "@/components/os";
import { useNavigationItems } from "@/config/use-navigation";
import { AgentRequestError, reportActivity } from "@/lib/agentos/client";
import {
  useAgentCapabilities,
  useAgentSession,
  useAgentSessionMessages,
  useAgentSkills,
  useAgentStatus,
  useForkAgentSession,
  useNewAgentSession,
  useProjects,
  useRefreshAgentMessages,
  useRefreshVault,
  useSendAgentMessage,
} from "@/lib/agentos/queries";
import { AgentActivityPanel } from "./agent-activity-panel";
import { AgentContext } from "./agent-context";
import { AgentInput } from "./agent-input";
import { AgentQuickActions } from "./agent-quick-actions";
import { AgentSessionBar } from "./agent-session";
import { AgentStatus } from "./agent-status";
import { AgentThread } from "./agent-thread";
import { ApprovalCard } from "./approval-card";
import { ProposalCard } from "./proposal-card";
import { readProposal } from "./proposal";
import { useCommandPalette } from "./command-palette-context";
import {
  runStateFor,
  shellStateFor,
  type AgentRunState,
} from "./run-status-display";
import { useAgentRun } from "./hooks/use-agent-run";

const FAILURE_COPY: Record<string, { title: string; hint: string }> = {
  "not-configured": {
    title: "Hermes is not configured.",
    hint: "Copy .env.example to .env and add HERMES_API_KEY, then restart the adapter.",
  },
  offline: {
    title: "Could not connect to the local agent.",
    hint: "Check that Hermes is running and that HERMES_BASE_URL points at it.",
  },
  unauthorized: {
    title: "Hermes rejected the API key.",
    hint: "Check HERMES_API_KEY in .env, then restart the adapter.",
  },
  "timed-out": {
    title: "Hermes ran out of time.",
    hint: "It was reached and was still working. A large request — a review carrying a whole diff — can outlast the window; try again, or send it less to read.",
  },
  failed: {
    title: "Hermes could not complete the request.",
    hint: "The agent was reached but did not return a usable reply.",
  },
};

/**
 * Terminal run statuses that are worth recording, and how each is filed.
 *
 * A run that merely stopped streaming is not an outcome; only these three say
 * something happened that the timeline should carry.
 */
const RUN_OUTCOMES: Partial<
  Record<string, "run.completed" | "run.failed" | "run.cancelled">
> = {
  completed: "run.completed",
  failed: "run.failed",
  cancelled: "run.cancelled",
};

/**
 * Hermes' transcript, as the thread renders it.
 *
 * `tool` turns are activity rather than conversation — the Activity panel shows
 * that work — and a turn with structured (non-text) content has nothing to
 * render as prose.
 */
function toThreadMessages(
  messages: AgentSessionMessage[] | undefined,
): AgentMessage[] {
  return (messages ?? []).flatMap((message) => {
    if (message.role === "tool" || typeof message.content !== "string") return [];

    return [
      {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt ?? "",
      },
    ];
  });
}

function createMessage(
  role: AgentMessage["role"],
  content: string,
): AgentMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

export function AgentPage() {
  const navigationItems = useNavigationItems();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectSlug = searchParams.get("project") ?? undefined;
  // A command handed over by the command palette, run once on arrival.
  const handedOver = searchParams.get("run") ?? undefined;

  // Optimistic turns only. Hermes owns the transcript; these are cleared as
  // soon as the canonical history is reloaded.
  const [pending, setPending] = useState<AgentMessage[]>([]);
  const [lastAttempt, setLastAttempt] = useState<string>();

  const { data: projectsData } = useProjects();
  const { data: agentStatus } = useAgentStatus();
  const { data: capabilities } = useAgentCapabilities();
  const { data: skillsData, isError: skillsUnavailable } = useAgentSkills();
  const { data: session } = useAgentSession(projectSlug);
  const { data: transcript } = useAgentSessionMessages(
    projectSlug,
    Boolean(session),
  );
  const refreshMessages = useRefreshAgentMessages(projectSlug);
  const refreshVault = useRefreshVault();
  const newSession = useNewAgentSession(projectSlug);
  const forkSession = useForkAgentSession(projectSlug);
  const sendMessage = useSendAgentMessage();
  const palette = useCommandPalette();

  // A finished run means Hermes has written the turn: drop the optimistic
  // copies and reload the canonical transcript rather than trusting the
  // streamed tokens as history.
  const run = useAgentRun({
    onFinished: (status, runId) => {
      setPending([]);
      void refreshMessages();
      // A run may have written to the vault. Nothing is assumed about what
      // changed — the adapter re-reads the files and the screens follow.
      void refreshVault();

      // How a run ended is known here and nowhere else: the adapter recorded
      // that it started, but only the event stream saw it finish.
      const outcome = RUN_OUTCOMES[status];
      if (outcome) {
        void reportActivity({ type: outcome, project: projectSlug, runId });
      }
    },
  });

  const history = useMemo(
    () => toThreadMessages(transcript?.messages),
    [transcript],
  );
  const messages = useMemo(() => [...history, ...pending], [history, pending]);

  // Features stay off until Hermes says it supports them.
  const supportsRuns = capabilities?.runs === true;
  const canStop = supportsRuns && capabilities?.stop === true;
  const canSteer = supportsRuns && capabilities?.steer === true;

  const projects = useMemo(() => projectsData?.projects ?? [], [projectsData]);
  const project = projects.find((entry) => entry.slug === projectSlug);

  const setProject = useCallback(
    (slug: string | undefined) => {
      setSearchParams(
        (params) => {
          const next = new URLSearchParams(params);
          if (slug) next.set("project", slug);
          else next.delete("project");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const isBusy = run.isRunning || sendMessage.isPending;

  /**
   * One entry point for everything the operator can send.
   *
   * While a run is live and steering is supported, input steers it rather than
   * starting a second conversation. Otherwise it starts a run, or falls back to
   * plain messaging on a Hermes without run support.
   */
  const send = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      if (run.isRunning) {
        if (!canSteer) return;
        setPending((current) => [
          ...current,
          createMessage("system", `Steering: ${trimmed}`),
        ]);
        await run.steer(trimmed).catch(() => undefined);
        return;
      }

      setLastAttempt(trimmed);
      setPending((current) => [...current, createMessage("user", trimmed)]);

      if (supportsRuns) {
        await run.start({ message: trimmed, project: projectSlug }).catch(
          () => undefined,
        );
        return;
      }

      sendMessage.mutate(
        { message: trimmed, project: projectSlug },
        {
          onSuccess: (response) =>
            setPending((current) => [...current, response.message]),
        },
      );
    },
    [canSteer, projectSlug, run, sendMessage, supportsRuns],
  );

  /**
   * Runs a command handed over by the command palette.
   *
   * The parameter is consumed once and stripped from the URL, so a reload or a
   * re-render cannot replay the run. Everything the palette starts goes through
   * `send`, which is the same path the input uses.
   */
  const consumed = useRef<string>(undefined);

  useEffect(() => {
    if (!handedOver || consumed.current === handedOver) return;
    consumed.current = handedOver;

    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        next.delete("run");
        return next;
      },
      { replace: true },
    );

    void send(handedOver);
  }, [handedOver, send, setSearchParams]);

  /**
   * Clears the live run and reloads Hermes' transcript.
   *
   * The streamed output is not folded into the thread by hand — Hermes has
   * already recorded the turn, and reloading keeps one canonical history.
   */
  const commitRun = useCallback(() => {
    run.reset();
    setPending([]);
    void refreshMessages();
    void refreshVault();
  }, [refreshMessages, refreshVault, run]);

  const retry = useCallback(() => {
    if (!lastAttempt) return;
    sendMessage.reset();
    run.reset();
    void send(lastAttempt);
  }, [lastAttempt, run, send, sendMessage]);

  const startFresh = useCallback(() => {
    run.reset();
    setPending([]);
    newSession.mutate();
  }, [newSession, run]);

  const branch = useCallback(() => {
    run.reset();
    setPending([]);
    forkSession.mutate();
  }, [forkSession, run]);

  const failureReason =
    sendMessage.error instanceof AgentRequestError
      ? sendMessage.error.reason
      : sendMessage.isError
        ? "failed"
        : undefined;

  // Kept until cleared, so a finished run always reports its verdict — a
  // cancelled run often has no output at all.
  const hasLiveRun = run.isRunning || run.runId !== undefined;

  const displayState: AgentRunState = run.isRunning
    ? runStateFor(run.state.status)
    : sendMessage.isPending
      ? "thinking"
      : failureReason || run.error
        ? "error"
        : agentStatus && !agentStatus.configured
          ? "unconfigured"
          : "ready";

  const showResumePrompt =
    project !== undefined && messages.length === 0 && !hasLiveRun;


  const approval =
    capabilities?.approvals === true ? run.state.approval : undefined;

  /**
   * The change Hermes says it will make, read out of its reply.
   *
   * A proposal and a system approval are two different questions — whether the
   * edit is right, and whether Hermes may run the command that makes it. When
   * there is a proposal it asks both, in one place, so approving a safe command
   * is never mistaken for agreeing with the change it performs.
   */
  const proposal = useMemo(
    () => readProposal(run.state.output),
    [run.state.output],
  );

  const decide = useCallback(
    (decision: ApprovalDecision) => {
      void run.respond(decision).catch(() => undefined);
    },
    [run],
  );

  return (
    <AppShell
      navigationItems={navigationItems}
      pageId="agent"
      activeHref="/agent"
      agentState={
        run.isRunning
          ? shellStateFor(run.state.status)
          : sendMessage.isPending
            ? "running"
            : "idle"
      }
      agentLabel={
        run.isRunning
          ? `Agent / ${run.state.status.replace(/_/g, " ")}`
          : sendMessage.isPending
            ? "Agent / running"
            : "Agent / idle"
      }
      contextLabel={project ? `Context / ${project.name}` : undefined}
      modelLabel={`Model / ${agentStatus?.model ?? "Hermes"}`}
    >
      <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
        <header className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3 border-b border-os-border pb-6">
          <div>
            <h1 className="text-[clamp(1.75rem,3vw,2rem)] leading-[1.05] font-normal tracking-[-0.03em]">
              Agent
            </h1>
            <p className="mt-2 text-[15px] leading-6 text-os-muted">
              Hermes operator console
            </p>
          </div>
          <AgentStatus state={displayState} />
        </header>

        <AgentContext
          projects={projects}
          value={projectSlug}
          onChange={setProject}
          className="mt-8"
        />

        <AgentSessionBar
          session={session}
          messageCount={history.length}
          onNewSession={startFresh}
          onForkSession={capabilities?.runs ? branch : undefined}
          isBusy={isBusy || newSession.isPending || forkSession.isPending}
          className="mt-8 border-t border-os-border pt-6"
        />

        <div className="mt-8 min-h-64 flex-1 overflow-y-auto">
          {showResumePrompt ? (
            <HairlineCard className="max-w-[62ch] p-5 md:p-6">
              <SectionLabel>{project.name}</SectionLabel>
              <p className="mt-4 text-[15px] leading-6 text-os-muted">
                Ready to resume this project.
              </p>
              <div className="mt-6">
                <CommandButton
                  variant="primary"
                  icon={ArrowRight}
                  onClick={() => void send(`/work-on ${project.slug}`)}
                >
                  Work on {project.name}
                </CommandButton>
              </div>
            </HairlineCard>
          ) : (
            <>
              <AgentThread
                messages={messages}
                isThinking={sendMessage.isPending}
              />

              {hasLiveRun ? (
                <section className="mt-6 border-t border-os-border pt-6">
                  <SectionLabel className="text-os-amber">Hermes</SectionLabel>

                  <AgentActivityPanel
                    state={run.state}
                    isRunning={run.isRunning}
                    showUnrecognised
                    className="mt-4"
                  />

                  {/* With a proposal parsed out, only Hermes' reasoning is
                      prose — the change itself is rendered by the card below,
                      not repeated here as raw markdown. */}
                  {proposal ? (
                    proposal.preamble ? (
                      <Markdown content={proposal.preamble} className="mt-6" />
                    ) : null
                  ) : run.state.output ? (
                    <Markdown content={run.state.output} className="mt-6" />
                  ) : run.isRunning ? (
                    <p className="mt-6 text-[15px] leading-6 text-os-subtle">
                      Working on your request…
                    </p>
                  ) : null}

                  {proposal ? (
                    // The substantive decision: is this change to AgentOS
                    // state correct? A proposal can only ever be approved for
                    // this one action — never for a session, never forever.
                    <ProposalCard
                      proposal={proposal}
                      approval={approval}
                      onApply={() => decide("once")}
                      onReject={() => decide("deny")}
                      isResponding={run.isResponding}
                      error={run.approvalError}
                      className="mt-6"
                    />
                  ) : approval ? (
                    <ApprovalCard
                      request={approval}
                      onRespond={decide}
                      isResponding={run.isResponding}
                      error={run.approvalError}
                      className="mt-6"
                    />
                  ) : null}

                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    {run.isRunning && canStop ? (
                      <CommandButton
                        variant="danger"
                        icon={Square}
                        iconPosition="start"
                        disabled={run.state.status === "stopping"}
                        onClick={() => void run.stop()}
                      >
                        {run.state.status === "stopping" ? "Stopping" : "Stop run"}
                      </CommandButton>
                    ) : null}

                    {!run.isRunning ? (
                      <>
                        <span className="os-meta text-os-subtle">
                          {run.state.status === "cancelled"
                            ? "Run cancelled"
                            : run.state.status === "failed"
                              ? "Run failed"
                              : "Run complete"}
                        </span>
                        <CommandButton
                          variant="quiet"
                          onClick={commitRun}
                        >
                          Clear
                        </CommandButton>
                      </>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </>
          )}
        </div>

        {failureReason || run.error ? (
          <ErrorState
            label="Hermes unavailable"
            title={
              failureReason
                ? (FAILURE_COPY[failureReason]?.title ?? "Hermes failed.")
                : "The run could not be started."
            }
            detail={sendMessage.error?.message ?? run.error}
            hint={failureReason ? FAILURE_COPY[failureReason]?.hint : undefined}
            onRetry={lastAttempt ? retry : undefined}
            isRetrying={isBusy}
            className="mt-6"
          />
        ) : null}

        <div className="mt-6 shrink-0 border-t border-os-border pt-6">
          <AgentInput
            onSubmit={(value) => void send(value)}
            skills={skillsData?.skills}
            projectSlug={projectSlug}
            projectName={project?.name}
            running={sendMessage.isPending}
            isSteering={run.isRunning && canSteer}
            disabled={run.isRunning && !canSteer}
          />
          <AgentQuickActions
            skills={skillsData?.skills}
            discovered={skillsData?.discovered ?? !skillsUnavailable}
            project={projectSlug}
            onRun={(command) => void send(command)}
            onBrowse={palette.open}
            disabled={isBusy}
            className="mt-8"
          />
        </div>
      </div>
    </AppShell>
  );
}
