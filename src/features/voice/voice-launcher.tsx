import { MicOff } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useJarvis } from "./jarvis-store";
import { useVoiceControl } from "./use-voice-control";
import { PHASE_LABEL, VOICE_TOGGLE_EVENT } from "./voice-model";
import { VoiceBars } from "./voice-bars";

/**
 * Voice in the top bar: nothing while idle, then what Jarvis is doing, as a
 * labelled control that stops it. Also where the palette's voice command lands.
 */
export function VoiceLauncher() {
  const jarvis = useJarvis();
  const control = useVoiceControl();
  const { toggle } = control;
  const busy = jarvis.phase !== "idle" && jarvis.phase !== "error";

  useEffect(() => {
    const onToggle = () => toggle();
    window.addEventListener(VOICE_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(VOICE_TOGGLE_EVENT, onToggle);
  }, [toggle]);

  // Always present, so a state change is announced as it happens.
  return (
    <span className="contents">
      <span className="sr-only" role="status" aria-live="polite">
        {busy ? control.caption : ""}
      </span>
      {busy ? (
        <button
          type="button"
          onClick={toggle}
          aria-pressed={control.listening}
          aria-label={`Jarvis, ${PHASE_LABEL[jarvis.phase]}`}
          title={control.caption}
          className={cn(
            "os-focus-ring inline-flex min-h-10 max-w-52 cursor-pointer items-center gap-2 rounded-md bg-selected px-2.5 text-[13px] leading-5 text-foreground transition-colors duration-150",
          )}
        >
          <MicOff className="size-[18px] shrink-0" strokeWidth={1.5} aria-hidden="true" />
          <VoiceBars phase={jarvis.phase} level={jarvis.level} width={48} height={18} />
          <span className="truncate max-lg:hidden">{PHASE_LABEL[jarvis.phase]}</span>
        </button>
      ) : null}
    </span>
  );
}
