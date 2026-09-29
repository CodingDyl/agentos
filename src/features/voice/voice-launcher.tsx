import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import { useJarvis } from "./jarvis-store";
import { PHASE_LABEL } from "./voice-model";

/**
 * The small always-there way in. One press starts recording straight away; the
 * next press ends it. Only when voice is off or has no key does it just open
 * the panel, because there is nothing to record.
 */
export function VoiceLauncher() {
  const jarvis = useJarvis();
  const busy = jarvis.phase !== "idle" && jarvis.phase !== "error";
  const canRecord = jarvis.voice?.enabled === true && jarvis.voice.configured;

  return (
    <button
      type="button"
      onClick={() => (canRecord ? jarvis.toggleListening() : jarvis.open())}
      aria-label={`Jarvis, ${PHASE_LABEL[jarvis.phase]}`}
      aria-pressed={jarvis.phase === "listening"}
      className={cn(
        "os-focus-ring flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-md border px-3 text-left transition-colors duration-150",
        busy ? "border-os-amber/60 text-os-amber" : "border-os-border text-os-muted hover:border-os-border-strong hover:text-foreground",
      )}
    >
      <span className="relative inline-flex size-5 items-center justify-center">
        {busy ? <span className="absolute inset-0 animate-ping rounded-full bg-os-amber/30 motion-reduce:hidden" aria-hidden="true" /> : null}
        <Mic className="relative size-4" strokeWidth={1.5} aria-hidden="true" />
      </span>
      <span className="os-meta">Jarvis</span>
      <span className="os-meta ml-auto text-os-subtle">{jarvis.voice?.enabled === false ? "Voice off" : PHASE_LABEL[jarvis.phase]}</span>
    </button>
  );
}
