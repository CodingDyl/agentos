import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { CHAT_PANEL_ID, ChatPanelContext, type ChatPanelValue } from "./chat-panel-context";

/** Holds the ⌘J chat's state for every screen: see chat-panel-context.ts. */

const REMEMBERED_CHAT = "agentos.chat.panel";

function readRemembered(): string | undefined {
  try {
    return window.localStorage.getItem(REMEMBERED_CHAT) ?? undefined;
  } catch {
    return undefined;
  }
}

function pageSelection(): string | undefined {
  const selection = window.getSelection();
  const text = selection?.toString().trim();
  if (!text) return undefined;
  const anchor = selection?.anchorNode;
  const panel = document.getElementById(CHAT_PANEL_ID);
  if (panel && anchor && panel.contains(anchor)) return undefined;
  return text.slice(0, 4_000);
}

export function ChatPanelProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [chatId, setChatIdState] = useState<string | undefined>(readRemembered);
  const [selection, setSelection] = useState<string>();
  const [detailMap, setDetailMap] = useState<Record<string, string>>({});
  const location = useLocation();
  // Operator is the chat already: the panel would be a second copy of it.
  const onOperator = location.pathname.startsWith("/operator");

  const setChatId = useCallback((id: string | undefined) => {
    setChatIdState(id);
    try {
      if (id) window.localStorage.setItem(REMEMBERED_CHAT, id);
      else window.localStorage.removeItem(REMEMBERED_CHAT);
    } catch {
      // Blocked storage: the panel just starts fresh next time.
    }
  }, []);

  const open = useCallback(() => {
    setSelection(pageSelection());
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => {
    if (isOpen) setOpen(false);
    else open();
  }, [isOpen, open]);

  const setDetail = useCallback((key: string, detail: string | undefined) => {
    setDetailMap((previous) => {
      if (previous[key] === detail) return previous;
      const next = { ...previous };
      if (detail) next[key] = detail;
      else delete next[key];
      return next;
    });
  }, []);

  useEffect(() => {
    if (onOperator) return;
    // ⌘J from anywhere, including from inside a text field.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "j" && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        toggle();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onOperator, toggle]);

  const value = useMemo<ChatPanelValue>(
    () => ({
      isOpen: isOpen && !onOperator,
      open,
      close,
      toggle,
      chatId,
      setChatId,
      selection,
      clearSelection: () => setSelection(undefined),
      details: Object.values(detailMap),
      setDetail,
    }),
    [isOpen, onOperator, open, close, toggle, chatId, setChatId, selection, detailMap, setDetail],
  );

  return <ChatPanelContext.Provider value={value}>{children}</ChatPanelContext.Provider>;
}

