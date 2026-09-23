import { createContext, useContext } from "react";

/** Opening the command palette, from anywhere in the app. */
export interface CommandPaletteControls {
  /** `create` opens showing only the Create group — the shell's `+`. */
  open: (mode?: "all" | "create") => void;
  close: () => void;
  isOpen: boolean;
}

export const CommandPaletteContext = createContext<
  CommandPaletteControls | undefined
>(undefined);

export function useCommandPalette(): CommandPaletteControls {
  const controls = useContext(CommandPaletteContext);

  if (!controls) {
    throw new Error(
      "useCommandPalette must be used inside CommandPaletteProvider",
    );
  }

  return controls;
}
