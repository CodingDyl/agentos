import { ChevronDown, MessageSquare, MessageSquareText, Mic, PenLine, Plus, Search } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { ActionMenu, ActionMenuItem } from "@/components/os";
import { projectInContext } from "@/features/agent/command-catalog";
import { useCommandPalette } from "@/features/agent/command-palette-context";
import { useChatPanel } from "@/features/chat-panel/chat-panel-context";
import { useVoiceControl } from "@/features/voice/use-voice-control";
import { formatShortcut } from "@/lib/shortcuts";
import { useQuickCreate } from "./quick-create-context";

const NEUTRAL =
  "os-focus-ring inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md bg-os-surface-raised text-[14px] leading-5 font-medium text-foreground transition-colors duration-150 hover:bg-os-surface-active";

/**
 * The controls in every screen's top bar: search, chat, capture.
 *
 * Search is the command palette. Capture is split on purpose: the main half
 * files a note with nothing in between, because a thought noticed on the way
 * somewhere is gone by the time a menu opens. Voice and the rest of Create sit
 * behind the chevron. Shortcuts are printed on the controls, for this platform.
 */
export function ShellActions() {
  const palette = useCommandPalette();
  const quickCreate = useQuickCreate();
  const chat = useChatPanel();
  const voice = useVoiceControl();
  const location = useLocation();
  // Operator is the chat itself.
  const onOperator = location.pathname.startsWith("/operator");
  const project = projectInContext(location.pathname, location.search);
  const keys = useMemo(
    () => ({ search: formatShortcut("K"), chat: formatShortcut("J"), capture: formatShortcut("⇧C") }),
    [],
  );

  useEffect(() => {
    // ⌘⇧C from anywhere, including from inside a text field: capturing is
    // exactly what someone halfway through typing something else wants.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "c" && event.shiftKey && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        quickCreate.open("capture", { project });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [project, quickCreate]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => palette.open("all")}
        className={`${NEUTRAL} px-2.5 text-os-muted hover:text-foreground xl:w-56`}
        aria-label="Search AgentOS"
        aria-keyshortcuts="Meta+K Control+K"
        title={`Search AgentOS (${keys.search})`}
      >
        <Search className="size-[18px] shrink-0" strokeWidth={1.5} aria-hidden="true" />
        <span className="hidden flex-1 text-left font-normal xl:inline">Search</span>
        <kbd className="os-mono hidden text-os-subtle sm:inline">{keys.search}</kbd>
      </button>

      {onOperator ? null : (
        <button
          type="button"
          onClick={chat.toggle}
          aria-pressed={chat.isOpen}
          className={`${NEUTRAL} px-2.5 aria-pressed:bg-selected`}
          aria-label="Chat"
          aria-keyshortcuts="Meta+J Control+J"
          title={`Ask about this screen, or anything (${keys.chat})`}
        >
          <MessageSquare className="size-[18px] shrink-0" strokeWidth={1.5} aria-hidden="true" />
          <span className="hidden sm:inline">Chat</span>
        </button>
      )}

      <div className="flex items-center gap-px">
        <button
          type="button"
          onClick={() => quickCreate.open("capture", { project })}
          className={`${NEUTRAL} rounded-r-none px-2.5`}
          aria-label="Capture a note"
          title={`Capture a note (${keys.capture})`}
        >
          <PenLine className="size-[18px] shrink-0" strokeWidth={1.5} aria-hidden="true" />
          <span className="hidden sm:inline">Capture</span>
        </button>
        <ActionMenu
          trigger={
            <button type="button" className={`${NEUTRAL} rounded-l-none px-1.5`} aria-label="More ways to capture">
              <ChevronDown className="size-4" strokeWidth={1.5} aria-hidden="true" />
            </button>
          }
        >
          <ActionMenuItem onSelect={() => quickCreate.open("capture", { project })} shortcut={keys.capture}>
            <PenLine className="size-[18px] shrink-0 text-os-muted" strokeWidth={1.5} aria-hidden="true" />
            Note
          </ActionMenuItem>
          <ActionMenuItem onSelect={voice.toggle} hint={voice.caption}>
            <Mic className="size-[18px] shrink-0 text-os-muted" strokeWidth={1.5} aria-hidden="true" />
            {voice.listening ? "Stop listening" : "Voice"}
          </ActionMenuItem>
          <ActionMenuItem onSelect={voice.togglePanel} hint="Transcript, text and approvals">
            <MessageSquareText className="size-[18px] shrink-0 text-os-muted" strokeWidth={1.5} aria-hidden="true" />
            {voice.panelOpen ? "Hide Jarvis text" : "Show Jarvis text"}
          </ActionMenuItem>
          <ActionMenuItem onSelect={() => palette.open("create")} hint="Task, workspace, decision or document">
            <Plus className="size-[18px] shrink-0 text-os-muted" strokeWidth={1.5} aria-hidden="true" />
            Quick create
          </ActionMenuItem>
        </ActionMenu>
      </div>
    </div>
  );
}
