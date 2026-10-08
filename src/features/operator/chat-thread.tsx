import { Check, ChevronRight, CircleAlert, Loader2, ShieldAlert, ShieldCheck, ShieldX, Wrench } from "lucide-react";
import { useState } from "react";
import type { ChatApprovalPart, ChatMessage, ChatToolPart } from "@shared/chat-types";
import { Markdown } from "@/components/os/markdown";
import { PAPER_FOCUS, PaperButton } from "@/components/paper";
import { cn } from "@/lib/utils";
import { RunReply } from "./operator-thread";

/**
 * One chat, as a conversation: you on the right, the agent on the left.
 *
 * The agent's reply is everything it did, in order: what it said, each tool
 * it used and how that went, and any action it stopped to ask about. Tool
 * calls are collapsed to one line each, so the conversation stays readable;
 * the output is a click away when you want it.
 */

export function ChatThread({
  messages,
  running,
  onDecide,
  deciding,
  onOpenRun,
  onRunAgain,
}: {
  messages: readonly ChatMessage[];
  running: boolean;
  onDecide: (approvalId: string, decision: "allow" | "deny") => void;
  deciding: boolean;
  /** A planned run started from the chat: open its full record. */
  onOpenRun: (runId: string) => void;
  onRunAgain: (input: string) => void;
}) {
  return (
    <ol className="space-y-8" aria-label="Messages">
      {messages.map((message, index) =>
        message.role === "user" ? (
          <UserMessage key={message.id} message={message} />
        ) : (
          <AssistantMessage
            key={message.id}
            message={message}
            // Only the reply being written can still be waiting on something.
            live={running && index === messages.length - 1}
            onDecide={onDecide}
            deciding={deciding}
            onOpenRun={onOpenRun}
            onRunAgain={onRunAgain}
          />
        ),
      )}
    </ol>
  );
}

function UserMessage({ message }: { message: ChatMessage }) {
  const text = message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
  return (
    <li className="flex justify-end" aria-label="You said">
      <p className="max-w-[min(85%,640px)] bg-paper-blue px-4 py-3 text-[15px] leading-6 break-words whitespace-pre-wrap text-paper-white">{text}</p>
    </li>
  );
}

function Typing() {
  return (
    <span role="status" aria-label="Thinking" className="inline-flex gap-1 py-2 align-middle">
      {[0, 1, 2].map((dot) => (
        <span key={dot} className="size-1.5 rounded-full bg-paper-sage motion-safe:animate-pulse" style={{ animationDelay: `${dot * 180}ms` }} />
      ))}
    </span>
  );
}

function AssistantMessage({
  message,
  live,
  onDecide,
  deciding,
  onOpenRun,
  onRunAgain,
}: {
  message: ChatMessage;
  live: boolean;
  onDecide: (approvalId: string, decision: "allow" | "deny") => void;
  deciding: boolean;
  onOpenRun: (runId: string) => void;
  onRunAgain: (input: string) => void;
}) {
  const waiting = live && message.parts.every((part) => part.type !== "text" || !part.text.trim());
  // A run reply is Operator's card, which shows its own model and progress.
  const isRun = message.parts.some((part) => part.type === "run");

  return (
    <li className="max-w-[min(100%,720px)]" aria-label="Reply" aria-busy={live}>
      <div className="space-y-3">
        {message.parts.map((part, index) => {
          if (part.type === "text") return part.text.trim() ? <Markdown key={index} content={part.text} tone="paper" /> : null;
          if (part.type === "tool") return <ToolRow key={part.id} part={part} />;
          if (part.type === "run") return <RunReply key={part.runId} runId={part.runId} onOpen={onOpenRun} onRunAgain={onRunAgain} />;
          return <ApprovalCard key={part.id} part={part} onDecide={onDecide} deciding={deciding} />;
        })}
        {waiting ? <Typing /> : null}
      </div>

      {message.error ? (
        <p role="alert" className="mt-3 flex items-start gap-2 text-[13.5px] leading-5 text-paper-flame-deep">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {message.error}
        </p>
      ) : null}

      {!live && !isRun && (message.model || message.costUsd !== undefined) ? (
        <p className="mt-2 font-paper-utility text-[11.5px] tracking-[0.08em] text-paper-sage uppercase tabular-nums">
          {message.model}
          {message.costUsd !== undefined ? ` · $${message.costUsd.toFixed(message.costUsd < 0.01 ? 4 : 2)}` : ""}
        </p>
      ) : null}
    </li>
  );
}

const TOOL_STATUS: Record<ChatToolPart["status"], { label: string; className: string }> = {
  running: { label: "Running", className: "text-paper-blue" },
  done: { label: "Done", className: "text-paper-green" },
  error: { label: "Failed", className: "text-paper-flame-deep" },
  denied: { label: "You declined", className: "text-paper-sage" },
};

function ToolStatusIcon({ status }: { status: ChatToolPart["status"] }) {
  if (status === "running") return <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />;
  if (status === "done") return <Check className="size-3.5" aria-hidden="true" />;
  if (status === "denied") return <ShieldX className="size-3.5" aria-hidden="true" />;
  return <CircleAlert className="size-3.5" aria-hidden="true" />;
}

function ToolRow({ part }: { part: ChatToolPart }) {
  const [open, setOpen] = useState(false);
  const status = TOOL_STATUS[part.status];
  const expandable = Boolean(part.output);

  const row = (
    <>
      <Wrench className="size-3.5 shrink-0 text-paper-sage" aria-hidden="true" />
      <span className="shrink-0 font-paper-utility text-[12px] font-medium tracking-[0.08em] text-paper-moss uppercase">{part.name}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-paper-char">{part.summary}</code>
      <span className={cn("inline-flex shrink-0 items-center gap-1 text-[12px]", status.className)}>
        <ToolStatusIcon status={part.status} />
        <span className="hidden sm:inline">{status.label}</span>
      </span>
      {expandable ? <ChevronRight className={cn("size-3.5 shrink-0 text-paper-sage transition-transform", open && "rotate-90")} aria-hidden="true" /> : null}
    </>
  );

  return (
    <div className="border border-paper-mist bg-paper-white">
      {expandable ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={`${part.name}: ${part.summary}. ${status.label}. ${open ? "Hide" : "Show"} output`}
          className={cn("flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left hover:bg-paper-cream", PAPER_FOCUS)}
        >
          {row}
        </button>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2" aria-label={`${part.name}: ${part.summary}. ${status.label}`}>
          {row}
        </div>
      )}
      {open && part.output ? (
        <pre className="max-h-64 overflow-auto border-t border-paper-stone bg-paper-cream px-3 py-2 font-mono text-[12px] leading-5 whitespace-pre-wrap text-paper-char">{part.output}</pre>
      ) : null}
    </div>
  );
}

function ApprovalCard({
  part,
  onDecide,
  deciding,
}: {
  part: ChatApprovalPart;
  onDecide: (approvalId: string, decision: "allow" | "deny") => void;
  deciding: boolean;
}) {
  if (part.status !== "pending") {
    const settled = {
      allowed: { icon: ShieldCheck, text: "You allowed", className: "text-paper-green" },
      denied: { icon: ShieldX, text: "You declined", className: "text-paper-sage" },
      expired: { icon: ShieldX, text: "No longer needed", className: "text-paper-sage" },
    }[part.status];
    const Icon = settled.icon;
    return (
      <p className={cn("flex items-center gap-2 text-[12.5px]", settled.className)}>
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        <span>
          {settled.text}: <code className="font-mono text-paper-char">{part.summary || part.tool}</code>
        </span>
      </p>
    );
  }

  return (
    <div role="alertdialog" aria-label={`Approve ${part.tool}?`} aria-describedby={`${part.id}-reason`} className="border-[1.5px] border-paper-marigold bg-paper-cream p-4">
      <p className="flex items-center gap-2 font-paper-utility text-[12px] font-medium tracking-[0.12em] text-paper-moss uppercase">
        <ShieldAlert className="size-4 text-paper-marigold" aria-hidden="true" />
        Needs your OK
      </p>
      <p id={`${part.id}-reason`} className="mt-2 text-[14px] leading-6 text-paper-moss">
        {part.reason}
      </p>
      <pre className="mt-2 max-h-40 overflow-auto bg-paper-white px-3 py-2 font-mono text-[12.5px] leading-5 whitespace-pre-wrap text-paper-char">
        <span className="text-paper-sage">{part.tool} </span>
        {part.summary}
      </pre>
      <div className="mt-3 flex flex-wrap gap-2">
        <PaperButton variant="amber" disabled={deciding} onClick={() => onDecide(part.id, "allow")}>
          Allow
        </PaperButton>
        <PaperButton variant="ghost" disabled={deciding} onClick={() => onDecide(part.id, "deny")}>
          Don&apos;t allow
        </PaperButton>
      </div>
    </div>
  );
}
