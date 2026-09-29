import { MessageSquareText, Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import { useJarvis } from "./jarvis-store";
import { PHASE_LABEL } from "./voice-model";
import { VoiceBars } from "./voice-bars";

/**
 * The small always-there way in, and the visualiser.
 *
 * One press starts recording straight away and the bars follow your voice; the
 * next press (or a pause in your speech) ends it. What you said is sent to
 * Hermes and the answer is spoken back, with no panel in the way. The panel is
 * one press away on the text button, and opens itself only when it has
 * something to ask you: an approval, or an error.
 */
export function VoiceLauncher() {
  const jarvis = useJarvis();
  const busy = jarvis.phase !== "idle" && jarvis.phase !== "error";
  const canRecord = jarvis.voice?.enabled === true && jarvis.voice.configured;
  const caption =
    jarvis.voice?.enabled === false
      ? "Voice off"
      : jarvis.askingMic
        ? "Allow the microphone in the browser prompt"
        : jarvis.phase === "confirming" && jarvis.transcript
        ? `"${jarvis.transcript}"`
        : jarvis.phase === "idle" && canRecord && jarvis.micPermission === "denied"
          ? "Microphone blocked"
          : jarvis.phase === "idle" && canRecord && jarvis.micPermission === "prompt"
            ? "Tap to allow microphone"
            : jarvis.phase === "idle" && canRecord
              ? "Ready. Tap to talk"
              : PHASE_LABEL[jarvis.phase];

  return (
    <div className="flex items-stretch gap-1.5">
      <button
        type="button"
        onClick={() => (canRecord ? jarvis.toggleListening() : jarvis.open())}
        aria-label={`Jarvis, ${PHASE_LABEL[jarvis.phase]}`}
        aria-pressed={jarvis.phase === "listening"}
        className={cn(
          "os-focus-ring flex min-h-14 min-w-0 flex-1 cursor-pointer flex-col justify-center gap-1 rounded-md border px-3 py-2 text-left transition-colors duration-150",
          busy ? "border-os-amber/60" : "border-os-border hover:border-os-border-strong",
        )}
      >
        <span className="flex items-center gap-3">
          <Mic className={cn("size-4 shrink-0", busy ? "text-os-amber" : "text-os-muted")} strokeWidth={1.5} aria-hidden="true" />
          <VoiceBars phase={jarvis.phase} level={jarvis.level} />
        </span>
        <span className="os-meta truncate text-os-subtle" role="status" aria-live="polite">
          {caption}
        </span>
      </button>
      <button
        type="button"
        onClick={jarvis.isOpen ? jarvis.close : jarvis.open}
        aria-label={jarvis.isOpen ? "Hide Jarvis text" : "Show Jarvis text"}
        aria-pressed={jarvis.isOpen}
        title="Text, transcript and approvals"
        className="os-focus-ring inline-flex w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-os-border text-os-muted transition-colors duration-150 hover:border-os-border-strong hover:text-foreground"
      >
        <MessageSquareText className="size-4" strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}
