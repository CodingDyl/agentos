import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PAPER_FOCUS } from "@/components/paper";
import { cn } from "@/lib/utils";
import { DownloadToastContext, type DownloadToast, type DownloadToastTone } from "./download-toast-context";

/**
 * The Creative download bar.
 *
 * Same shape as the workspace undo/conflict bar: a fixed strip at the bottom
 * of the window, spoken as a status, gone on its own after a success. Errors
 * stay until they are dismissed.
 */

const SUCCESS_MS = 4_000;

interface ToastState {
  tone: DownloadToastTone;
  label: string;
  percent?: number;
}

export function DownloadToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    setToast(undefined);
  }, []);

  const reportProgress = useCallback<DownloadToast["reportProgress"]>((label, percent) => {
    clearTimeout(timer.current);
    setToast({ tone: "progress", label, percent });
  }, []);

  const reportSuccess = useCallback<DownloadToast["reportSuccess"]>((label) => {
    setToast({ tone: "success", label });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(undefined), SUCCESS_MS);
  }, []);

  const reportError = useCallback<DownloadToast["reportError"]>((label) => {
    clearTimeout(timer.current);
    setToast({ tone: "error", label });
  }, []);

  const value = useMemo<DownloadToast>(
    () => ({ reportProgress, reportSuccess, reportError, clear }),
    [reportProgress, reportSuccess, reportError, clear],
  );

  return (
    <DownloadToastContext.Provider value={value}>
      {children}
      {toast ? (
        <div
          role={toast.tone === "error" ? "alert" : "status"}
          aria-live={toast.tone === "error" ? "assertive" : "polite"}
          className={cn(
            "fixed inset-x-4 bottom-14 z-40 mx-auto flex max-w-[42rem] items-center gap-3 border px-4 py-3",
            toast.tone === "error"
              ? "border-paper-flame-deep bg-paper-white text-paper-flame-deep"
              : "border-paper-mist bg-paper-white text-paper-moss",
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="text-[14px] leading-5">{toast.label}</p>
            {toast.tone === "progress" && toast.percent !== undefined ? (
              <div
                className="mt-2 h-1 overflow-hidden bg-paper-stone"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={toast.percent}
                aria-label="Download progress"
              >
                <div className="h-full bg-paper-blue" style={{ width: `${toast.percent}%` }} />
              </div>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={clear}
            className={cn(
              "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center text-paper-sage hover:text-paper-moss",
              PAPER_FOCUS,
            )}
          >
            <X className="size-3.5" strokeWidth={1.5} />
          </button>
        </div>
      ) : null}
    </DownloadToastContext.Provider>
  );
}
