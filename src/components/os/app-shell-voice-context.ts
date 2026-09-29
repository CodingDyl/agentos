import { createContext, type ReactNode } from "react";

/**
 * The voice launcher, supplied once at the app root and shown in the sidebar.
 * A context for the same reason as the top-bar actions: every screen renders
 * the shell, and none of them owns the microphone.
 */
export const AppShellVoiceContext = createContext<ReactNode>(null);
