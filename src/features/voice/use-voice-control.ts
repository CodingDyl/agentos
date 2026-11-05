import { useJarvis } from "./jarvis-store";
import { PHASE_LABEL } from "./voice-model";

/**
 * Voice capture's controls, for the Capture menu: one press starts recording
 * and the next (or a pause in your speech) ends it. What you said goes to
 * Hermes and the answer is spoken back; the text panel opens itself only when
 * it has something to ask you. With voice unavailable, the press opens the
 * panel, which says why.
 */
export function useVoiceControl() {
  const jarvis = useJarvis();
  const canRecord = jarvis.voice?.enabled === true && jarvis.voice.configured;
  const caption =
    jarvis.voice?.enabled === false
      ? "Voice off"
      : jarvis.voiceStatusError
        ? "Voice server unreachable"
        : jarvis.voice && !jarvis.voice.configured
          ? "No FISH_API_KEY on server"
          : jarvis.audioNote && jarvis.phase === "idle"
            ? "Voice failed. Open text for why"
            : jarvis.holding && jarvis.phase === "listening"
              ? "Listening. Let go of Ctrl to send"
            : jarvis.askingMic
        ? "Allow the microphone in the browser prompt"
        : jarvis.phase === "confirming" && jarvis.transcript
        ? `"${jarvis.transcript}"`
        : jarvis.phase === "idle" && canRecord && jarvis.micPermission === "denied"
          ? "Microphone blocked"
          : jarvis.phase === "idle" && canRecord && jarvis.micPermission === "prompt"
            ? "Tap to allow microphone"
            : jarvis.phase === "idle" && canRecord
              ? jarvis.pushToTalk
                ? "Ready. Hold Ctrl to talk"
                : jarvis.target
                  ? `Ready. Tell ${jarvis.target} what to do`
                  : "Ready. Tap to talk"
              : PHASE_LABEL[jarvis.phase];


  return {
    caption,
    listening: jarvis.phase === "listening",
    panelOpen: jarvis.isOpen,
    toggle: () => (canRecord ? jarvis.toggleListening() : jarvis.open()),
    togglePanel: jarvis.isOpen ? jarvis.close : jarvis.open,
  };
}
