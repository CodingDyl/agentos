import type { RebuildDesignConcept } from "@shared/website-rebuild-types";
import { Tag } from "@/components/paper";
import { critiqueStatus } from "./concept-critique-model";

/** The concept's assigned art direction and its critique score, under its name on the hero stage. */
export function ConceptCritique({ entry }: { entry: RebuildDesignConcept | undefined }) {
  if (!entry) return null;
  const status = critiqueStatus(entry);
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] text-paper-sage">
      <span>{entry.directionName}</span>
      {entry.wildcard ? <Tag tone="blue">Wildcard</Tag> : null}
      <Tag tone={status.tone}>
        <span className="sr-only">Design score: </span>
        {status.text}
      </Tag>
      {entry.escalated && entry.reason ? <span className="w-full text-paper-char">{entry.reason}</span> : null}
    </span>
  );
}
