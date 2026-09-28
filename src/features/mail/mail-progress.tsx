import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { MailProgress } from "@shared/mail-types";
import { agentosKeys, useMailProgress } from "@/lib/agentos/queries";

function progressLabel(progress: MailProgress): string {
  if (progress.kind === "reprofile") return "Jev is re-reading your mail";
  if (progress.phase === "profiling") return "Jev is sorting new mail";
  if (progress.phase === "fetching" && progress.total > 0) return "Fetching new mail from Gmail";
  return "Checking Gmail for new mail";
}

/**
 * The bar between the controls and the list while Jev works through mail.
 * The list refreshes as each thread is sorted, so rows move into place
 * under the bar instead of all at once at the end.
 */
export function MailProgressBar() {
  const queryClient = useQueryClient();
  const { data: progress } = useMailProgress();
  const done = progress?.running ? progress.done : undefined;

  useEffect(() => {
    if (done !== undefined && done > 0) {
      void queryClient.invalidateQueries({ queryKey: agentosKeys.mail() });
    }
  }, [done, queryClient]);

  // A single "Ask Jev again" from a row menu is over before a bar would mean anything.
  if (!progress?.running || (progress.kind === "reprofile" && progress.total <= 1)) return null;

  const determinate = progress.total > 0;
  const percent = determinate ? Math.round((progress.done / progress.total) * 100) : 0;
  const label = progressLabel(progress);

  return (
    <div className="mail-progress">
      <div className="mail-progress-text">
        <span className="mail-progress-label">{label}</span>
        {determinate ? (
          <span className="mail-progress-count">
            {progress.done} of {progress.total}
            {progress.failed > 0 ? ` · ${progress.failed} couldn't be sorted` : ""}
          </span>
        ) : null}
      </div>
      <div
        className={`mail-progress-track${determinate ? "" : " mail-progress-track--indeterminate"}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={determinate ? progress.total : undefined}
        aria-valuenow={determinate ? progress.done : undefined}
      >
        <div className="mail-progress-fill" style={determinate ? { width: `${percent}%` } : undefined} />
      </div>
    </div>
  );
}
