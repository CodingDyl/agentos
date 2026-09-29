import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type { AgentRunStatus, ApprovalDecision } from "@shared/agentos-types";
import { projectInContext } from "@/features/agent/command-catalog";
import { useAgentRun } from "@/features/agent/hooks/use-agent-run";
import { getAgentSessionMessages, reportActivity } from "@/lib/agentos/client";
import { useAgentCapabilities, useProjects, useRefreshVault, useSendAgentMessage } from "@/lib/agentos/queries";
import { fetchRunOutput, getVoiceStatus, setVoiceEnabled, speakText, transcribeAudio, VoiceRequestError } from "@/lib/agentos/voice";
import { JarvisContext, type JarvisApi } from "./jarvis-store";
import { recoverAnswer } from "./final-answer";
import { describeMicFailure, micSupportFailure, readMicPermission, watchMicPermission, type MicPermission } from "./mic-permission";
import { SpeechQueue } from "./speech-queue";
import { useVoicePlayback } from "./use-voice-playback";
import { useVoiceRecorder } from "./use-voice-recorder";
import { VoiceSession } from "./voice-session";
import { VoiceTimings } from "./voice-timings";
import { toSpeechWav } from "./wav";
import { AUTO_SEND_MS, isSendable, resolveProject, type VoicePhase } from "./voice-model";

/**
 * Jarvis: a voice in front of the existing Hermes command flow.
 *
 * Nothing here decides anything. Speech becomes text, the text goes through
 * the same run flow the Agent screen uses (`useAgentRun`, so the same skills,
 * project sessions, task handling and approvals), and Hermes' answer is shown
 * as text and, when voice is on, spoken. There is no store of its own: what is
 * held here is what is on screen, and a reload forgets it. Hermes keeps the
 * conversation.
 */

const RUN_OUTCOMES = { completed: "run.completed", failed: "run.failed", cancelled: "run.cancelled" } as const;

export function JarvisProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const refreshVault = useRefreshVault();
  const { data: projectsData } = useProjects();
  const { data: capabilities } = useAgentCapabilities();
  const sendMessage = useSendAgentMessage();
  const voiceQuery = useQuery({ queryKey: ["agentos", "voice", "status"], queryFn: getVoiceStatus, staleTime: 60_000, retry: 0 });
  const voice = voiceQuery.data;
  const voiceReady = voice?.enabled === true && voice.configured;

  const [isOpen, setIsOpen] = useState(false);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [transcript, setTranscriptState] = useState("");
  const [autoSendAt, setAutoSendAt] = useState<number>();
  const [error, setError] = useState<string>();
  const [audioNote, setAudioNote] = useState<string>();
  const [project, setProject] = useState<string>();
  const [fallbackReply, setFallbackReply] = useState("");
  // An answer that did not stream and was fetched from Hermes afterwards.
  const [recoveredReply, setRecoveredReply] = useState("");
  const [micPermission, setMicPermission] = useState<MicPermission>("unknown");
  // True while the browser's own permission dialog is open, waiting on you.
  const [askingMic, setAskingMic] = useState(false);
  // The last attempt to record failed at the microphone, so Try again applies.
  const [micFailed, setMicFailed] = useState(false);

  // Follow the browser's microphone setting, so the launcher can say "tap to
  // allow" before the first press, and recover the moment it is switched on.
  useEffect(() => {
    let live = true;
    let unwatch: () => void = () => undefined;
    void readMicPermission().then((state) => {
      if (live) setMicPermission(state);
    });
    void watchMicPermission((state) => setMicPermission(state)).then((stop) => {
      if (live) unwatch = stop;
      else stop();
    });
    return () => {
      live = false;
      unwatch();
    };
  }, []);

  const projects = useMemo(() => projectsData?.projects ?? [], [projectsData]);
  const pageProject = projectInContext(location.pathname, location.search);

  // The run's own callback outlives the render that started it, so it goes
  // through a ref and always sees the current speak/project/voice state.
  const finished = useRef<(status: AgentRunStatus, runId?: string, output?: string) => void>(() => undefined);

  const run = useAgentRun({ onFinished: (status, runId, output) => finished.current(status, runId, output) });

  const playback = useVoicePlayback();

  // What is being said while Hermes is still writing. `muted` lasts until the
  // next question: once you have silenced Jarvis, later text is not spoken.
  const [session] = useState(() => new VoiceSession());
  // Measured on every exchange: which step is slow is otherwise a guess.
  const [timings] = useState(() => new VoiceTimings());

  const [queue] = useState(
    () =>
      new SpeechQueue({
      synthesise: (text) => speakText(text),
      play: playback.play,
      stopPlayback: playback.stop,
      isSkippable: (failure) => failure instanceof VoiceRequestError && failure.reason === "empty",
      onSpeaking: (speaking) => {
        if (speaking) {
          timings.mark("firstAudio");
          setPhase("speaking");
        } else if (session.isWriting()) setPhase("thinking");
      },
      onDrained: () => setPhase("idle"),
      onError: (failure) => {
        console.error("[jarvis] voice failed:", failure);
        // The words are already on screen. Losing the voice must not lose them.
        session.mute();
        setAudioNote(
          failure instanceof VoiceRequestError
            ? `Voice unavailable (${failure.message}) Showing text only.`
            : "The browser would not play audio. Showing text only.",
        );
        setPhase(session.isWriting() ? "thinking" : "idle");
      },
    }),
  );

  /** Silences Jarvis now and for the rest of this answer. */
  const silence = useCallback(() => {
    session.mute();
    queue.reset();
  }, [queue, session]);

  useEffect(() => () => queue.reset(), [queue]);

  const say = useCallback(
    (text: string, final: boolean) => {
      if (session.isMuted() || !voiceReady) return;
      for (const piece of session.feed(text, final)) queue.enqueue(piece);
    },
    [queue, session, voiceReady],
  );

  // Speak each finished sentence as it arrives, not after the whole answer.
  useEffect(() => {
    if (!run.runId || !run.isRunning) return;
    if (run.state.output.length > 0) timings.mark("firstText");
    say(run.state.output, false);
  }, [run.runId, run.isRunning, run.state.output, say, timings]);

  useEffect(() => {
    finished.current = (status, runId, output) => {
      void refreshVault();
      const outcome = RUN_OUTCOMES[status as keyof typeof RUN_OUTCOMES];
      if (outcome) void reportActivity({ type: outcome, project, runId });

      session.end();

      if (status === "failed") {
        queue.reset();
        setError("Hermes could not complete that. Your words are still in the box, so you can send them again.");
        setPhase("error");
        return;
      }
      if (status !== "completed") {
        queue.reset();
        setPhase("idle");
        return;
      }

      console.info("[jarvis] run finished", { status, runId, streamedChars: output?.length ?? 0 });

      if (output?.trim()) {
        // Flush what was still being written, then let the queue run dry.
        if (voiceReady && !session.isMuted()) {
          say(output, true);
          queue.close();
        } else setPhase("idle");
        return;
      }

      // The run finished and nothing streamed. Hermes may have put its answer
      // somewhere else (the run's record, or the saved conversation), and
      // silence is the one outcome that looks like a broken assistant.
      const turn = session.turn();
      setPhase("thinking");
      void recoverAnswer({
        runOutput: () => (runId ? fetchRunOutput(runId) : Promise.resolve(undefined)),
        transcript: async () => (await getAgentSessionMessages(project)).messages,
        sent: session.asked(),
      }).then((answer) => {
        // A newer question has taken over; this one is no longer the story.
        if (session.turn() !== turn) return;

        if (!answer) {
          console.warn("[jarvis] Hermes finished but no text could be found", { runId });
          setError(
            "Hermes finished but sent back no text, and none was in its saved conversation either. Check Hermes is running and answering, or try the same question on the Agent page.",
          );
          setPhase("error");
          return;
        }

        setRecoveredReply(answer);
        if (voiceReady && !session.isMuted()) {
          say(answer, true);
          queue.close();
        } else setPhase("idle");
      });
    };
  });

  const send = useCallback(
    (override?: string) => {
      const text = (override ?? transcript).trim();
      if (!isSendable(text)) return;

      queue.reset();
      session.begin(text);
      setRecoveredReply("");
      // A spoken question carries its earlier marks; a typed one starts fresh.
      if (phase !== "confirming") timings.reset();
      timings.mark("sent");
      setAutoSendAt(undefined);
      setError(undefined);
      setAudioNote(undefined);
      setFallbackReply("");
      const target = resolveProject(text, projects, pageProject);
      setProject(target);
      setTranscriptState(text);
      setPhase("thinking");

      // The same choice the Agent screen makes: a run where Hermes supports
      // them, plain messaging where it does not.
      if (capabilities?.runs === true) {
        run.start({ message: text, project: target }).catch((failure: unknown) => {
          session.end();
          setError(failure instanceof Error ? failure.message : "Hermes could not start the run.");
          setPhase("error");
        });
        return;
      }

      run.reset();
      sendMessage.mutate(
        { message: text, project: target },
        {
          onSuccess: (response) => {
            session.end();
            timings.mark("firstText");
            setFallbackReply(response.message.content);
            void refreshVault();
            if (voiceReady) {
              say(response.message.content, true);
              queue.close();
            } else setPhase("idle");
          },
          onError: (failure) => {
            session.end();
            setError(failure.message);
            setPhase("error");
          },
        },
      );
    },
    [capabilities?.runs, pageProject, phase, projects, queue, refreshVault, run, say, sendMessage, session, timings, transcript, voiceReady],
  );

  // A transcript sends itself unless you touch it. Send goes immediately.
  useEffect(() => {
    if (autoSendAt === undefined || phase !== "confirming") return;
    const timer = window.setTimeout(() => send(), Math.max(0, autoSendAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [autoSendAt, phase, send]);

  const handleRecorded = useCallback(
    async (audio: Blob | null) => {
      if (!audio) {
        setPhase("idle");
        return;
      }
      timings.mark("stopped");
      setPhase("transcribing");
      try {
        // Sent as 16 kHz mono WAV: the one format every recogniser reads.
        const text = await transcribeAudio(await toSpeechWav(audio));
        timings.mark("transcribed");
        setTranscriptState(text);
        setPhase("confirming");
        setAutoSendAt(Date.now() + AUTO_SEND_MS);
      } catch (failure) {
        setError(
          failure instanceof VoiceRequestError && failure.reason === "empty"
            ? "I didn't catch anything. Try again, or type it."
            : `Couldn't transcribe that (${failure instanceof Error ? failure.message : "unknown error"}) You can type instead.`,
        );
        setPhase("error");
      }
    },
    [timings],
  );

  const recorder = useVoiceRecorder((audio) => void handleRecorded(audio));

  const toggleListening = useCallback(() => {
    if (phase === "listening") {
      void recorder.stop().then(handleRecorded);
      return;
    }
    if (phase === "speaking") {
      silence();
      setPhase(session.isWriting() ? "thinking" : "idle");
      return;
    }
    if (phase === "transcribing" || phase === "thinking") return;
    if (!voiceReady) {
      // Nothing to record into yet. Look again (the server may have been
      // restarted since the page loaded) and show why on the panel.
      void voiceQuery.refetch();
      setIsOpen(true);
      return;
    }

    setError(undefined);
    setMicFailed(false);
    timings.reset();
    setAutoSendAt(undefined);
    setTranscriptState("");
    const unsupported = micSupportFailure();
    if (unsupported) {
      setMicFailed(true);
      setError(unsupported.message);
      setPhase("error");
      return;
    }

    // While the browser's answer is still "prompt", this call is what raises
    // its permission dialog. Once blocked it fails at once, and we say where
    // to switch it back on instead.
    setAskingMic(true);
    recorder.start().then(
      () => {
        setAskingMic(false);
        setMicPermission("granted");
        setPhase("listening");
      },
      (failure: unknown) => {
        setAskingMic(false);
        // Ask the browser what it says about this site *now*: a refusal while
        // the site shows "allowed" is the operating system's doing, not the site's.
        void readMicPermission().then((state) => {
          const problem = describeMicFailure(failure, state);
          setMicPermission(state === "unknown" && problem.blocked ? "denied" : state);
          setMicFailed(true);
          setError(problem.detail ? `${problem.message} (${problem.detail})` : problem.message);
          setPhase("error");
        });
      },
    );
  }, [handleRecorded, phase, recorder, session, silence, timings, voiceQuery, voiceReady]);

  /**
   * Speaks one fixed line with Hermes and the microphone out of the picture.
   * If this is silent, the fault is in Fish or the browser's audio; if it
   * speaks, the fault is upstream of it. The timing shown is Fish alone.
   */
  const testVoice = useCallback(() => {
    queue.reset();
    session.begin();
    session.end();
    timings.reset();
    // Only "sent" and the audio: there is no Hermes step, so the total is Fish alone.
    timings.mark("sent");
    setError(undefined);
    setAudioNote(undefined);
    if (!voiceReady) {
      setAudioNote("Voice isn't ready: it is switched off, or the server has no FISH_API_KEY.");
      return;
    }
    queue.enqueue("Good morning, sir. Voice check.");
    queue.close();
  }, [queue, session, timings, voiceReady]);

  const cancelTranscript = useCallback(() => {
    recorder.cancel();
    silence();
    setAutoSendAt(undefined);
    setTranscriptState("");
    setError(undefined);
    setPhase("idle");
  }, [recorder, silence]);

  const stop = useCallback(() => {
    // While Jarvis is talking, stop means stop talking. A second press stops the run.
    if (phase === "speaking") {
      silence();
      setPhase(session.isWriting() ? "thinking" : "idle");
      return;
    }
    silence();
    if (run.isRunning) void run.stop();
    else setPhase("idle");
  }, [phase, run, session, silence]);

  const setVoiceOn = useCallback(
    (enabled: boolean) => {
      if (!enabled) {
        recorder.cancel();
        silence();
      }
      void setVoiceEnabled(enabled).then((next) => queryClient.setQueryData(["agentos", "voice", "status"], next));
    },
    [queryClient, recorder, silence],
  );

  const respond = useCallback(
    (decision: ApprovalDecision) => {
      void run.respond(decision).catch(() => undefined);
    },
    [run],
  );

  const reply = run.runId ? run.state.output || recoveredReply : fallbackReply;

  const api: JarvisApi = {
    isOpen,
    open: () => {
      setIsOpen(true);
      // Opening is a good moment to look again: the server may have been
      // restarted (or its key added) since this page first asked.
      void voiceQuery.refetch();
    },
    close: () => {
      setIsOpen(false);
      // Closing acknowledges an error; the words you said stay in the box.
      if (error) {
        setError(undefined);
        setPhase("idle");
      }
    },
    phase,
    level: recorder.level,
    transcript,
    setTranscript: (text) => {
      setTranscriptState(text);
      setAutoSendAt(undefined);
      if (phase === "confirming") setPhase("idle");
    },
    autoSendAt,
    send,
    cancelTranscript,
    toggleListening,
    stop,
    reply,
    project,
    approval: capabilities?.approvals === true ? run.state.approval : undefined,
    respond,
    isResponding: run.isResponding,
    approvalError: run.approvalError,
    error,
    audioNote,
    timings: timings.summary(),
    testVoice,
    micPermission,
    askingMic,
    micFailed,
    voiceStatusError: voiceQuery.isError,
    voice,
    setVoiceOn,
    run,
  };

  return <JarvisContext.Provider value={api}>{children}</JarvisContext.Provider>;
}
