import { createContext, type ReactNode } from "react";

/**
 * The media corner — the focus session and the mini-player — supplied once
 * at the app root and shown in the sidebar, so it survives navigation.
 */
export const AppShellMediaContext = createContext<ReactNode>(null);
