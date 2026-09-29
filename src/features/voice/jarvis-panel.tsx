import { Mic, Send, Square, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { withoutEmDashes } from "@shared/plain-text";
import { CommandButton, Markdown, SectionLabel } from "@/components/os";
import { ApprovalCard } from "@/features/agent/approval-card";
import { ProposalCard } from "@/features/agent/proposal-card";
import { readProposal } from "@/features/agent/proposal";
import { useProjects } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { useJarvis } from "./jarvis-store";
import { AUTO_SEND_MS, PHASE_LABEL } from "./voice-model";

/**
 * The conversation surface. Everything Hermes says is text first; audio is an
 * addition that can fail without taking the answer with it.
 */
export function JarvisPanel() {
  const jarvis = useJarvis();
  const { data: projectsData } = useProjects();
  const projectName = projectsData?.projects.find((entry) => entry.slug === jarvis.project)?.name;
  const proposal = useMemo(() => readProposal(jarvis.reply), [jarvis.reply]);

  useEffect(() => {
    if (!jarvis.isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") jarvis.close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [jarvis]);

  if (!jarvis.isOpen) return null;

  const voiceOn = jarvis.voice?.enabled === true;
  const voiceUsable = voiceOn && jarvis.voice?.configured === true;
  const working = jarvis.phase === "thinking" || jarvis.run.isRunning;
  const listening = jarvis.phase === "listening";

  return (
    <section
      role="dialog"
      aria-label="Jarvis"
      className="fixed right-4 bottom-14 z-40 flex max-h-[min(80dvh,720px)] w-[min(94vw,440px)] flex-col rounded-md border border-os-border-strong bg-os-surface"
    >
      <header className="flex items-center justify-between gap-3 border-b border-os-border px-4 py-3">
        <div className="flex items-center gap-3">
          <SectionLabel>Jarvis</SectionLabel>
          <span className="os-meta text-os-subtle" role="status" aria-live="polite">
            {PHASE_LABEL[jarvis.phase]}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => jarvis.setVoiceOn(!voiceOn)}
            aria-pressed={voiceOn}
            aria-label={voiceOn ? "Turn voice off" : "Turn voice on"}
            title={voiceOn ? "Voice on" : "Voice off (text only)"}
            className="os-focus-ring inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-os-muted hover:text-foreground"
          >
            {voiceOn ? <Volume2 className="size-4" aria-hidden="true" /> : <VolumeX className="size-4" aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={jarvis.close}
            aria-label="Close Jarvis"
            className="os-focus-ring inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-os-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={jarvis.toggleListening}
            disabled={!voiceUsable || working}
            aria-label={listening ? "Stop listening" : jarvis.phase === "speaking" ? "Stop speaking" : "Start listening"}
            className={cn(
              "os-focus-ring relative inline-flex size-16 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40",
              listening ? "border-os-amber text-os-amber" : "border-os-border-strong text-os-muted hover:text-foreground",
            )}
            style={listening ? { boxShadow: `0 0 0 ${Math.round(jarvis.level * 14)}px rgb(255 230 203 / 0.08)` } : undefined}
          >
            {jarvis.phase === "speaking" ? <Square className="size-5" aria-hidden="true" /> : <Mic className="size-6" aria-hidden="true" />}
          </button>
          <p className="text-[13px] leading-5 text-os-subtle">
            {!voiceOn
              ? "Voice is off. Type below; answers stay text only."
              : !jarvis.voice?.configured
                ? "No Fish Audio key on the server. Type below; answers stay text only."
                : listening
                  ? "Listening. It sends when you stop talking."
                  : "Tap to talk, or type below."}
          </p>
        </div>

        <div>
          <label htmlFor="jarvis-transcript" className="os-meta text-os-subtle">
            {jarvis.phase === "confirming" ? "Heard (edit to stop auto-send)" : "Your message"}
          </label>
          <textarea
            id="jarvis-transcript"
            value={jarvis.transcript}
            onChange={(event) => jarvis.setTranscript(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                jarvis.send();
              }
            }}
            rows={2}
            disabled={working || listening || jarvis.phase === "transcribing"}
            placeholder="Give me my morning brief"
            className="os-focus-ring mt-2 w-full resize-none rounded-md border border-os-border bg-os-background p-3 text-[15px] leading-6 text-foreground placeholder:text-os-subtle"
          />
          {jarvis.phase === "confirming" && jarvis.autoSendAt ? <SendCountdown key={jarvis.autoSendAt} /> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <CommandButton variant="primary" icon={Send} disabled={working || listening} onClick={() => jarvis.send()}>
              Send
            </CommandButton>
            <CommandButton variant="quiet" onClick={jarvis.cancelTranscript} disabled={!jarvis.transcript && jarvis.phase === "idle"}>
              Cancel
            </CommandButton>
            {projectName ? <span className="os-meta ml-auto text-os-subtle">Project / {projectName}</span> : null}
          </div>
        </div>

        {jarvis.error ? (
          <p role="alert" className="text-[14px] leading-6 text-os-danger">
            {jarvis.error}
          </p>
        ) : null}

        {working && !jarvis.reply ? <p className="text-[14px] text-os-subtle">Hermes is working on it…</p> : null}

        {proposal ? (
          <>
            {proposal.preamble ? <Markdown content={withoutEmDashes(proposal.preamble)} /> : null}
            <ProposalCard
              proposal={proposal}
              approval={jarvis.approval}
              onApply={() => jarvis.respond("once")}
              onReject={() => jarvis.respond("deny")}
              isResponding={jarvis.isResponding}
              error={jarvis.approvalError}
            />
          </>
        ) : jarvis.reply ? (
          <Markdown content={withoutEmDashes(jarvis.reply)} />
        ) : null}

        {!proposal && jarvis.approval ? (
          <ApprovalCard request={jarvis.approval} onRespond={jarvis.respond} isResponding={jarvis.isResponding} error={jarvis.approvalError} />
        ) : null}

        {jarvis.audioNote ? <p className="text-[13px] leading-5 text-os-subtle">{jarvis.audioNote}</p> : null}
      </div>

      {working || jarvis.phase === "speaking" ? (
        <footer className="border-t border-os-border px-4 py-3">
          <CommandButton variant="danger" icon={Square} iconPosition="start" onClick={jarvis.stop}>
            {jarvis.phase === "speaking" ? "Stop speaking" : "Stop run"}
          </CommandButton>
        </footer>
      ) : null}
    </section>
  );
}

/** A thin bar that empties over the auto-send window. */
function SendCountdown() {
  const [empty, setEmpty] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEmpty(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="mt-2 h-px w-full bg-os-border" aria-hidden="true">
      <div
        className="h-px origin-left bg-os-amber transition-transform ease-linear"
        style={{ transform: empty ? "scaleX(0)" : "scaleX(1)", transitionDuration: `${AUTO_SEND_MS}ms` }}
      />
    </div>
  );
}
