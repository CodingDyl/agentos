import { RotateCcw, TriangleAlert, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { VaultConflictError } from "@/lib/agentos/client";
import { WorkspaceFeedbackContext } from "./workspace-feedback-context";
import { useUndoEdit } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";

/**
 * What the workspace says after it writes.
 *
 * Two things, and deliberately only two.
 *
 * **Undo.** Every human mutation leaves a backup, so every one of them can be
 * taken back — and the moment that matters is the few seconds right after, when
 * the operator realises they ticked the wrong box. A bar that appears then is
 * worth more than a history screen they would have to go and find.
 *
 * **Conflict.** The vault is still edited by hand and written by Hermes, so
 * "this file moved under you" is a normal outcome rather than a bug. It gets a
 * different, louder treatment than a failure, because the answer is not to
 * retry — it is to look at what changed.
 *
 * Deliberately not a general toast system. A workspace that popped a
 * confirmation for every successful edit would be noise: the task moving is the
 * confirmation.
 */

/** How long an undo offer stays up before it stops being about this moment. */
const UNDO_MS = 12_000;

interface UndoState {
  label: string;
  undoId: string;
}

interface ConflictState {
  message: string;
  onReload?: () => void;
}

export function WorkspaceFeedbackProvider({ children }: { children: ReactNode }) {
  const [undo, setUndo] = useState<UndoState>();
  const [conflict, setConflict] = useState<ConflictState>();
  const undoEdit = useUndoEdit();

  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const recordEdit = useCallback((label: string, undoId?: string) => {
    // An edit that produced no backup — a create, usually — is still a success;
    // there is simply nothing to offer, and a bar with a dead button would be
    // worse than no bar.
    if (!undoId) return;

    setConflict(undefined);
    setUndo({ label, undoId });

    clearTimeout(timer.current);
    timer.current = setTimeout(() => setUndo(undefined), UNDO_MS);
  }, []);

  const reportFailure = useCallback((error: unknown, onReload?: () => void) => {
    setUndo(undefined);

    setConflict({
      message:
        error instanceof VaultConflictError
          ? error.message
          : error instanceof Error
            ? error.message
            : "That change could not be saved.",
      onReload,
    });
  }, []);

  const value = useMemo(
    () => ({ recordEdit, reportFailure }),
    [recordEdit, reportFailure],
  );

  return (
    <WorkspaceFeedbackContext.Provider value={value}>
      {children}

      {conflict ? (
        <Bar tone="warning">
          <TriangleAlert
            className="size-4 shrink-0 text-os-warning"
            strokeWidth={1.5}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 text-[14px] leading-5 text-foreground">
            {conflict.message}
          </span>

          {conflict.onReload ? (
            <BarButton
              onClick={() => {
                conflict.onReload?.();
                setConflict(undefined);
              }}
            >
              Reload
            </BarButton>
          ) : null}

          <BarButton onClick={() => setConflict(undefined)} icon={X} label="Dismiss" />
        </Bar>
      ) : undo ? (
        <Bar tone="quiet">
          <span className="min-w-0 flex-1 text-[14px] leading-5 text-os-muted">
            {undo.label}
          </span>

          <BarButton
            icon={RotateCcw}
            disabled={undoEdit.isPending}
            onClick={() => {
              undoEdit.mutate(undo.undoId);
              setUndo(undefined);
            }}
          >
            Undo
          </BarButton>
        </Bar>
      ) : null}
    </WorkspaceFeedbackContext.Provider>
  );
}

function Bar({
  tone,
  children,
}: {
  tone: "quiet" | "warning";
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed inset-x-4 bottom-14 z-40 mx-auto flex max-w-[42rem] items-center gap-3 rounded-lg border px-4 py-3",
        "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2",
        tone === "warning"
          ? "border-os-warning/40 bg-os-surface-raised"
          : "border-os-border-strong bg-os-surface-raised",
      )}
    >
      {children}
    </div>
  );
}

function BarButton({
  children,
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  children?: ReactNode;
  icon?: typeof RotateCcw;
  label?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "os-focus-ring os-meta inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-2 rounded-md border border-os-border px-3",
        "text-os-muted transition-colors duration-150 hover:border-os-border-strong hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-45",
      )}
    >
      {Icon ? <Icon className="size-3.5" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
