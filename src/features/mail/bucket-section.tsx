import type { MailBucketTone, MailRow } from "./mail-model";
import { ThreadRow, type ThreadRowActions } from "./thread-row";
import { LOW_PRIORITY_TTL_HOURS } from "@shared/mail-types";

export type { MailBucketTone } from "./mail-model";

interface BucketSectionProps {
  label: string;
  tone: MailBucketTone;
  rows: MailRow[];
  /** The whole bucket's size under the current filter — not just the rows on this page. */
  total: number;
  canModify: boolean;
  canReprofile: boolean;
  actions: ThreadRowActions;
}

/** One labelled group of threads. Renders nothing when the bucket is empty. */
export function BucketSection({ label, tone, rows, total, canModify, canReprofile, actions }: BucketSectionProps) {
  if (rows.length === 0) return null;

  return (
    <div className="mail-bucket">
      <div className={`mail-bucket-label mail-bucket-label--${tone}`}>
        {label} <span className="mail-bucket-count">{total}</span>
      </div>
      {tone === "low" && canModify ? (
        <p className="mail-bucket-note">
          Moves to Gmail Trash {LOW_PRIORITY_TTL_HOURS} hours after landing here. Keep anything worth holding on to.
        </p>
      ) : null}
      {rows.map(({ thread }) => (
        <ThreadRow
          key={thread.threadId}
          thread={thread}
          tone={tone}
          canModify={canModify}
          canReprofile={canReprofile}
          actions={actions}
        />
      ))}
    </div>
  );
}
