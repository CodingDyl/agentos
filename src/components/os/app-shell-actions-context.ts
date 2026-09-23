import { createContext, type ReactNode } from "react";

/**
 * Controls every screen's top bar shows, supplied once at the app root.
 *
 * A context rather than a prop because the shell is rendered by a dozen
 * screens and the controls — Quick Create, the palette — belong to none of
 * them. The design system stays ignorant of what the buttons do.
 */
export const AppShellActionsContext = createContext<ReactNode>(null);
