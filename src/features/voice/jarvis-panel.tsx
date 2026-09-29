import { Send, Square, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { withoutEmDashes } from "@shared/plain-text";
import { Markdown } from "@/components/os";
import { PAPER_FOCUS, PaperButton } from "@/components/paper";
import { ApprovalCard } from "@/features/agent/approval-card";
import { ProposalCard } from "@/features/agent/proposal-card";
import { readProposal } from "@/features/agent/proposal";
import { useProjects } from "@/lib/agentos/queries";
import { useJarvis } from "./jarvis-store";
import { JarvisOrb } from "./jarvis-orb";
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
  const [typing, setTyping] = useState(false);

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
  // Speaking is the point, so the box stays out of the way until there is a
  // transcript to check, an error to recover from, or you ask to type.
  const showComposer =
    typing || !voiceUsable || jarvis.transcript !== "" || jarvis.error !== undefined || jarvis.reply !== "" || jarvis.phase === "confirming";

  const hint = !voiceOn
    ? "Voice is off. Type below; answers stay text only."
    : !jarvis.voice?.configured
      ? "FISH_API_KEY isn't set on the server (restart it after editing .env). Type below; answers stay text only."
      : listening
        ? "Listening. It sends when you stop talking."
        : jarvis.phase === "speaking"
          ? "Speaking. Tap to stop."
          : "Tap the orb to talk.";

  return (
    <section
      role="dialog"
      aria-label="Jarvis"
      className="fixed right-4 bottom-14 z-40 flex max-h-[min(84dvh,760px)] w-[min(94vw,440px)] flex-col overflow-hidden rounded-[6px] border border-paper-moss bg-paper-linen font-paper-ui text-paper-moss"
    >
      <header className="flex items-center justify-between gap-3 px-4 pt-3">
        <div className="flex items-baseline gap-2">
          <h2 className="font-paper-display text-[17px] font-bold tracking-[-0.01em]">Jarvis</h2>
          <span className="text-[12.5px] text-paper-sage" role="status" aria-live="polite">
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
            className={`inline-flex size-9 cursor-pointer items-center justify-center rounded-[4px] text-paper-char hover:bg-paper-stone ${PAPER_FOCUS}`}
          >
            {voiceOn ? <Volume2 className="size-4" aria-hidden="true" /> : <VolumeX className="size-4" aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={jarvis.close}
            aria-label="Close Jarvis"
            className={`inline-flex size-9 cursor-pointer items-center justify-center rounded-[4px] text-paper-char hover:bg-paper-stone ${PAPER_FOCUS}`}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pt-1 pb-4">
        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={jarvis.toggleListening}
            disabled={!voiceUsable || working}
            aria-label={listening ? "Stop listening" : jarvis.phase === "speaking" ? "Stop speaking" : "Start listening"}
            className={`cursor-pointer rounded-full disabled:cursor-not-allowed disabled:opacity-50 ${PAPER_FOCUS}`}
          >
            <JarvisOrb phase={jarvis.phase} level={jarvis.level} />
          </button>
          <p className="text-center text-[13px] leading-5 text-paper-sage">{hint}</p>
        </div>

        {!showComposer ? (
          <button
            type="button"
            onClick={() => setTyping(true)}
            className={`mx-auto block cursor-pointer rounded-[4px] px-2 py-1 text-[13px] text-paper-sage underline-offset-2 hover:text-paper-moss hover:underline ${PAPER_FOCUS}`}
          >
            Type instead
          </button>
        ) : null}

        {showComposer ? (
        <div>
          <label htmlFor="jarvis-transcript" className="text-[12.5px] font-medium text-paper-char">
            {jarvis.phase === "confirming" ? "Heard. Edit to stop it sending." : "Your message"}
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
            className={`mt-1.5 w-full resize-none rounded-[4px] border border-paper-mist bg-paper-white p-3 text-[15px] leading-6 text-paper-moss placeholder:text-paper-ash ${PAPER_FOCUS}`}
          />
          {jarvis.phase === "confirming" && jarvis.autoSendAt ? <SendCountdown key={jarvis.autoSendAt} /> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <PaperButton variant="amber" disabled={working || listening} onClick={() => jarvis.send()}>
              Send
              <Send className="size-3.5" aria-hidden="true" />
            </PaperButton>
            <PaperButton variant="quiet" onClick={jarvis.cancelTranscript} disabled={!jarvis.transcript && jarvis.phase === "idle"}>
              Cancel
            </PaperButton>
            {projectName ? <span className="ml-auto text-[12.5px] text-paper-sage">Project: {projectName}</span> : null}
          </div>
        </div>
        ) : null}

        {jarvis.error ? (
          <p role="alert" className="text-[14px] leading-6 font-medium text-paper-flame-deep">
            {jarvis.error}
          </p>
        ) : null}

        {working && !jarvis.reply ? <p className="text-[14px] text-paper-sage">Hermes is working on it…</p> : null}

        {/* Hermes' words and its decisions keep the console look they have
            everywhere else: the approval cards are drawn for that surface. */}
        {jarvis.reply || jarvis.approval ? (
          <div className="os-environment space-y-4 rounded-[4px] p-4">
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
          </div>
        ) : null}

        {jarvis.audioNote ? <p className="text-[13px] leading-5 text-paper-sage">{jarvis.audioNote}</p> : null}
      </div>

      {working || jarvis.phase === "speaking" ? (
        <footer className="border-t border-paper-mist px-4 py-3">
          <PaperButton variant="ghost" onClick={jarvis.stop}>
            <Square className="size-3.5" aria-hidden="true" />
            {jarvis.phase === "speaking" ? "Stop speaking" : "Stop run"}
          </PaperButton>
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
    <div className="mt-2 h-0.5 w-full bg-paper-mist" aria-hidden="true">
      <div
        className="h-0.5 origin-left bg-paper-flame transition-transform ease-linear"
        style={{ transform: empty ? "scaleX(0)" : "scaleX(1)", transitionDuration: `${AUTO_SEND_MS}ms` }}
      />
    </div>
  );
}
