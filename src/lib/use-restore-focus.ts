import { useEffect, useRef, useState } from "react";

/**
 * Returns focus to whatever had it when a dialog opened, once the dialog closes.
 *
 * Read during the first render on purpose: by the time an effect runs,
 * `autoFocus` has already moved focus into the dialog, and restoring to that
 * would leave focus on nothing. The restore waits a microtask because
 * StrictMode runs this cleanup once straight after mounting, and that one must
 * not pull focus out of the dialog that just took it.
 */
export function useRestoreFocus(): void {
  const [previous] = useState(() => (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)));
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current) previous?.focus?.();
      });
    };
  }, [previous]);
}
