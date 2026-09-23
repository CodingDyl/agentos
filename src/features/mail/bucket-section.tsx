import type { MailThread } from "@shared/mail-types";
import { ThreadRow } from "./thread-row";

export type MailBucketTone = "needs" | "fyi" | "low";

interface BucketSectionProps {
  label: string;
  tone: MailBucketTone;
  threads: MailThread[];
}

/** One labelled group of threads. Renders nothing when the bucket is empty. */
export function BucketSection({ label, tone, threads }: BucketSectionProps) {
  if (threads.length === 0) return null;

  return (
    <div className="mail-bucket">
      <div className={`mail-bucket-label mail-bucket-label--${tone}`}>
        {label} <span className="mail-bucket-count">{threads.length}</span>
      </div>
      {threads.map((thread) => (
        <ThreadRow key={thread.threadId} thread={thread} tone={tone} />
      ))}
    </div>
  );
}
