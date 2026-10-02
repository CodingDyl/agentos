import { MessageSquareText, Volume2, VolumeX } from "lucide-react";
import { Link } from "react-router-dom";
import { PAPER_FOCUS, PaperSwitch } from "@/components/paper";
import { cn } from "@/lib/utils";
import { JarvisOrb } from "@/features/voice/jarvis-orb";
import { useJarvis } from "@/features/voice/jarvis-store";
import { PHASE_LABEL } from "@/features/voice/voice-model";

const SAY = ["Plan a landing page for Virtara", "Approve", "Confirm", "Stop", "Status", "Read me the plan"];

/**
 * Jarvis, at the top of Operator.
 *
 * The orb is the main control: press, say what you want done, and it becomes
 * a run. What Jarvis says about the run is always written here too, so a muted
 * or voiceless Jarvis still narrates, just silently.
 */
export function JarvisConsole({ narrating, onNarratingChange }: { narrating: boolean; onNarratingChange: (on: boolean) => void }) {
  const jarvis = useJarvis();
  const voiceOn = jarvis.voice?.enabled === true;
  const usable = voiceOn && jarvis.voice?.configured === true;
  const busy = jarvis.phase === "transcribing" || (jarvis.phase === "thinking" && jarvis.target !== "Operator");

  const unavailable = jarvis.voiceStatusError
    ? "The voice server can't be reached. Type below; Jarvis still writes what's happening."
    : !voiceOn
      ? "Voice is off. Type below; Jarvis still writes what's happening."
      : !jarvis.voice?.configured
        ? "Jarvis has no voice yet: add a Fish Audio key."
        : undefined;

  const caption =
    jarvis.phase === "listening"
      ? "Listening. Press again, or pause, when you're done."
      : jarvis.phase === "confirming"
        ? `Heard: “${jarvis.transcript}”`
        : jarvis.phase === "speaking"
          ? "Speaking. Press to stop."
          : jarvis.askingMic
            ? "Allow the microphone in the browser prompt."
            : jarvis.phase === "idle" && usable && jarvis.micPermission === "denied"
              ? "The microphone is blocked for this site."
              : jarvis.phase === "idle" && usable
                ? "Press and tell me what you want done."
                : PHASE_LABEL[jarvis.phase];

  // Only what Jarvis said for Operator belongs here; a Hermes chat reply stays in his panel.
  const said = jarvis.target === "Operator" ? jarvis.reply : "";

  return (
    <section aria-label="Jarvis" className="mt-6 border-[1.5px] border-paper-blue bg-paper-cream">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5">
        <button
          type="button"
          onClick={() => (usable ? jarvis.toggleListening() : jarvis.open())}
          disabled={busy}
          aria-label={jarvis.phase === "listening" ? "Stop listening" : jarvis.phase === "speaking" ? "Stop Jarvis speaking" : "Talk to Jarvis"}
          aria-pressed={jarvis.phase === "listening"}
          className={cn("mx-auto shrink-0 cursor-pointer rounded-full disabled:cursor-wait sm:mx-0", PAPER_FOCUS)}
        >
          <JarvisOrb phase={jarvis.phase} level={jarvis.level} size={96} />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="font-paper-display text-[18px] font-extrabold tracking-[-0.01em] text-paper-moss uppercase">Jarvis</h2>
            <span className="font-paper-utility text-[12px] tracking-[0.12em] text-paper-sage uppercase">{PHASE_LABEL[jarvis.phase]}</span>
          </div>
          <p className="mt-1 text-[13.5px] text-paper-char" role="status" aria-live="polite">
            {unavailable ?? caption}
            {unavailable && voiceOn && !jarvis.voice?.configured ? (
              <>
                {" "}
                <Link to="/connectors/fish" className={cn("font-medium text-paper-blue underline-offset-2 hover:underline", PAPER_FOCUS)}>
                  Set up Fish Audio
                </Link>
              </>
            ) : null}
          </p>
          {said ? (
            <p aria-live="polite" className="mt-2 border-l-2 border-paper-blue pl-3 text-[14.5px] leading-6 whitespace-pre-line text-paper-moss">
              {said}
            </p>
          ) : null}
          {jarvis.error ? (
            <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
              {jarvis.error}
            </p>
          ) : null}
          {jarvis.audioNote ? <p className="mt-2 text-[12.5px] text-paper-flame-deep">{jarvis.audioNote}</p> : null}
        </div>

        <div className="flex shrink-0 flex-row items-center justify-between gap-3 sm:flex-col sm:items-end">
          <label className="flex items-center gap-2 text-[12.5px] text-paper-char">
            Narrate runs
            <PaperSwitch checked={narrating} onChange={onNarratingChange} label="Jarvis narrates runs" />
          </label>
          <span className="flex gap-1">
            <button
              type="button"
              onClick={() => jarvis.setVoiceOn(!voiceOn)}
              aria-pressed={voiceOn}
              aria-label={voiceOn ? "Turn Jarvis's voice off" : "Turn Jarvis's voice on"}
              className={cn("inline-flex size-9 cursor-pointer items-center justify-center text-paper-char hover:bg-paper-stone", PAPER_FOCUS)}
            >
              {voiceOn ? <Volume2 className="size-4" aria-hidden="true" /> : <VolumeX className="size-4" aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={jarvis.isOpen ? jarvis.close : jarvis.open}
              aria-pressed={jarvis.isOpen}
              aria-label={jarvis.isOpen ? "Hide Jarvis transcript" : "Show Jarvis transcript"}
              className={cn("inline-flex size-9 cursor-pointer items-center justify-center text-paper-char hover:bg-paper-stone", PAPER_FOCUS)}
            >
              <MessageSquareText className="size-4" aria-hidden="true" />
            </button>
          </span>
        </div>
      </div>

      <p className="border-t border-paper-stone px-4 py-2.5 text-[12.5px] text-paper-sage sm:px-5">
        <span className="font-paper-utility tracking-[0.12em] uppercase">Say</span>{" "}
        {SAY.map((line, index) => (
          <span key={line}>
            {index > 0 ? " · " : ""}“{line}”
          </span>
        ))}
      </p>
    </section>
  );
}
