import { createContext, useContext, useEffect, useId } from "react";

/**
 * The ⌘J chat: a conversation that slides in over whatever screen you are on.
 *
 * This holds what outlives the panel being shut: whether it is open, which
 * chat it shows (kept across reloads, so ⌘J picks up where you left off),
 * the text you had selected when you opened it, and what the screen says is
 * open on it. Screens add that last part with `useChatPageDetail`.
 */

/** The panel's element id: a selection inside the panel itself is not page context. */
export const CHAT_PANEL_ID = "agentos-chat-panel";

export interface ChatPanelValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** The chat the panel shows; undefined is a new one. */
  chatId?: string;
  setChatId: (id: string | undefined) => void;
  /** Text selected on the page when the panel was opened. */
  selection?: string;
  clearSelection: () => void;
  /** What screens say is open on them right now. */
  details: string[];
  setDetail: (key: string, detail: string | undefined) => void;
}

export const ChatPanelContext = createContext<ChatPanelValue | undefined>(undefined);

export function useChatPanel(): ChatPanelValue {
  const value = useContext(ChatPanelContext);
  if (!value) throw new Error("useChatPanel must be used inside ChatPanelProvider.");
  return value;
}

/**
 * Tells the ⌘J chat what is open on this screen ("Email 'Quote' from Sam"),
 * for as long as the calling component shows it. Undefined says nothing.
 */
export function useChatPageDetail(detail: string | undefined): void {
  const key = useId();
  const setDetail = useContext(ChatPanelContext)?.setDetail;
  useEffect(() => {
    if (!setDetail) return;
    setDetail(key, detail);
    return () => setDetail(key, undefined);
  }, [key, detail, setDetail]);
}
