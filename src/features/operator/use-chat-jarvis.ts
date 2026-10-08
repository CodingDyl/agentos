import { useEffect, useRef, useState } from "react";
import type { Chat } from "@shared/chat-types";
import { useJarvis } from "@/features/voice/jarvis-store";
import { approvalPrompt, CONFIRM_WINDOW_MS, confirmPrompt, parseChatVoiceCommand, pendingApproval, spokenSummary } from "./chat-voice";

const NARRATE_KEY = "agentos.chat.narrate";

function readNarrate(): boolean {
  try {
    return window.localStorage.getItem(NARRATE_KEY) === "on";
  } catch {
    return false;
  }
}

/**
 * Puts Jarvis to work for the chat on screen.
 *
 * What Jarvis hears becomes a message to the chat's agent, except a few short
 * commands: "stop", "new chat", and answers to an approval. "Don't allow"
 * declines at once; "allow" reads back what will run, and only "confirm" lets
 * it. With narration on, Jarvis says when an agent stops to ask, and gives a
 * one- or two-sentence version of each reply. Leaving the page hands Jarvis
 * back to Hermes.
 */
export function useChatJarvis({
  chat,
  agentName,
  send,
  stop,
  decide,
  newChat,
}: {
  chat: Chat | undefined;
  agentName: string;
  send: (text: string) => void;
  stop: () => void;
  decide: (approvalId: string, decision: "allow" | "deny") => void;
  newChat: () => void;
}) {
  const jarvis = useJarvis();
  const [narrating, setNarratingState] = useState(readNarrate);
  const pendingConfirm = useRef<{ approvalId: string; until: number } | undefined>(undefined);

  const setNarrating = (on: boolean) => {
    setNarratingState(on);
    try {
      window.localStorage.setItem(NARRATE_KEY, on ? "on" : "off");
    } catch {
      // A per-browser preference; losing it costs nothing.
    }
  };

  const latest = useRef({ chat, agentName, send, stop, decide, newChat, jarvis });
  useEffect(() => {
    latest.current = { chat, agentName, send, stop, decide, newChat, jarvis };
  });

  const { setIntercept } = jarvis;
  useEffect(() => {
    setIntercept({
      label: "Chat",
      handle: (text) => {
        const { chat: current, send: say, stop: halt, decide: answer, newChat: fresh, jarvis: voice } = latest.current;
        const command = parseChatVoiceCommand(text);
        if (!command) return false;
        const waiting = pendingApproval(current?.messages.at(-1));

        switch (command.kind) {
          case "stop":
            pendingConfirm.current = undefined;
            if (current?.status === "running") {
              halt();
              voice.announce("Stopping.");
            } else voice.announce("Nothing is running.");
            return true;

          case "deny":
            pendingConfirm.current = undefined;
            if (!waiting) {
              voice.announce("There's nothing waiting for an answer.");
              return true;
            }
            answer(waiting.id, "deny");
            voice.announce("Declined. It'll carry on without that.");
            return true;

          case "allow":
            if (!waiting) {
              voice.announce("There's nothing waiting for an answer.");
              return true;
            }
            pendingConfirm.current = { approvalId: waiting.id, until: Date.now() + CONFIRM_WINDOW_MS };
            voice.announce(confirmPrompt(waiting));
            return true;

          case "confirm": {
            const pending = pendingConfirm.current;
            pendingConfirm.current = undefined;
            if (!pending || pending.until < Date.now() || waiting?.id !== pending.approvalId) {
              voice.announce("There's nothing to confirm. Say allow first.");
              return true;
            }
            answer(pending.approvalId, "allow");
            voice.announce("Confirmed.");
            return true;
          }

          case "new-chat":
            pendingConfirm.current = undefined;
            fresh();
            voice.announce("New chat.");
            return true;

          case "message":
            if (current?.status === "running") {
              voice.announce("It's still answering. Say stop first, or wait for it.");
              return true;
            }
            say(command.text);
            return true;
        }
      },
    });
    return () => setIntercept(undefined);
  }, [setIntercept]);

  // Say when an agent stops to ask, and give the gist of each finished reply.
  const { announce } = jarvis;
  const last = chat?.messages.at(-1);
  const waiting = pendingApproval(last);
  const announcedApproval = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!narrating || !waiting || announcedApproval.current === waiting.id) return;
    announcedApproval.current = waiting.id;
    announce(approvalPrompt(agentName, waiting));
  }, [narrating, waiting, agentName, announce]);

  const wasRunning = useRef(chat?.status === "running");
  useEffect(() => {
    const running = chat?.status === "running";
    const finished = wasRunning.current && !running;
    wasRunning.current = running;
    if (!narrating || !finished || last?.role !== "assistant") return;
    const line = spokenSummary(last);
    if (line) announce(line);
  }, [chat?.status, last, narrating, announce]);

  return { narrating, setNarrating, jarvis };
}
