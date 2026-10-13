import { useState } from "react";
import { formatBytes, REMOTE_ITEMS, type CleanupCandidate, type CleanupItem, type CleanupItemId, type CleanupPreview, type CleanupResult } from "@shared/client-cleanup";
import { DedsecLoader } from "@/components/os";
import { FieldLabel, PAPER_INPUT, PaperButton, PaperCard, PaperEmpty, PaperSection, Tag } from "@/components/paper";
import { useCleanupCandidates, useCleanupPreview, useRunCleanup } from "@/lib/agentos/cleanup";
import { cn } from "@/lib/utils";

/**
 * Clean up: the work built for businesses that never showed interest.
 *
 * Nothing is deleted until you have seen exactly what would go and how big it
 * is. What stays on your machine is ticked for you; GitHub and Vercel never
 * are, and need the company's name typed. The business's record and every
 * email you sent are always kept. Hidden entirely when there is nothing to
 * clean up.
 */
type Finished = { company: string; preview: CleanupPreview; result: CleanupResult };

export function CleanUpSection() {
  const candidates = useCleanupCandidates();
  const [openId, setOpenId] = useState<string>();
  // A business drops off the list the moment it is cleaned up, so what was done is kept here.
  const [finished, setFinished] = useState<Finished[]>([]);
  const list = candidates.data ?? [];
  if (list.length === 0 && finished.length === 0) return null;

  return (
    <PaperSection label="Clean up" count={list.length}>
      {finished.map((entry, index) => (
        <PaperCard key={`${entry.company}-${index}`} className="mb-4 p-4">
          <p className="text-[14px] font-semibold text-paper-moss">{entry.company}</p>
          <Result data={entry.preview} result={entry.result} onDone={() => setFinished((current) => current.filter((_, at) => at !== index))} />
        </PaperCard>
      ))}
      <p className="-mt-2 mb-3 max-w-[70ch] text-[13px] leading-5 text-paper-sage">
        Work built for businesses that never showed interest: the site folder, the workspace and the rebuild history. Deleting it frees disk space. Their record and every email you sent
        are kept. You see exactly what goes, and its size, before anything is deleted.
      </p>
      <ul className="space-y-3">
        {list.map((candidate) => (
          <li key={candidate.prospectId} className="border border-paper-mist bg-paper-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold text-paper-moss">{candidate.company}</h3>
                <p className="text-[13px] text-paper-char">{candidate.reason}</p>
              </div>
              <PaperButton
                variant={openId === candidate.prospectId ? "ghost" : "amber"}
                onClick={() => setOpenId(openId === candidate.prospectId ? undefined : candidate.prospectId)}
                aria-expanded={openId === candidate.prospectId}
                aria-label={`${openId === candidate.prospectId ? "Close" : "Review"} the clean-up for ${candidate.company}`}
              >
                {openId === candidate.prospectId ? "Close" : "Review clean-up"}
              </PaperButton>
            </div>
            {openId === candidate.prospectId ? (
              <CleanupPanel
                candidate={candidate}
                onCleaned={(preview, result) => {
                  setFinished((current) => [...current, { company: candidate.company, preview, result }]);
                  setOpenId(undefined);
                }}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </PaperSection>
  );
}

const STATE_NOTE: Record<CleanupItem["state"], string> = {
  ready: "",
  blocked: "Will not be deleted",
  unavailable: "Cannot be checked right now",
  not_found: "Nothing there",
};

function CleanupPanel({ candidate, onCleaned }: { candidate: CleanupCandidate; onCleaned: (preview: CleanupPreview, result: CleanupResult) => void }) {
  const preview = useCleanupPreview(candidate.prospectId, true);
  const run = useRunCleanup();
  const [choice, setChoice] = useState<Partial<Record<CleanupItemId, boolean>>>({});
  const [typed, setTyped] = useState("");
  const [armed, setArmed] = useState(false);

  if (preview.isPending) return <DedsecLoader variant="compact" className="mt-4" />;
  if (preview.error) {
    return (
      <p role="alert" className="mt-4 text-[13px] text-paper-flame-deep">
        {preview.error.message}
      </p>
    );
  }
  const data: CleanupPreview = preview.data;

  if (!data.eligible) {
    return (
      <PaperCard className="mt-4 p-4">
        <p className="text-[14px] font-semibold text-paper-moss">This one cannot be cleaned up right now.</p>
        <ul className="mt-2 list-disc pl-5 text-[13px] text-paper-char">
          {data.ineligibleReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </PaperCard>
    );
  }

  const checked = (entry: CleanupItem) => entry.state === "ready" && (choice[entry.id] ?? entry.defaultChecked);
  const selected = data.items.filter(checked);
  const wantsRemote = selected.some((entry) => REMOTE_ITEMS.includes(entry.id));
  const freed = selected.filter((entry) => !entry.remote).reduce((sum, entry) => sum + (entry.bytes ?? 0), 0);
  const approximate = selected.some((entry) => entry.approximate);
  const nameOk = !wantsRemote || typed.trim().toLowerCase() === data.company.toLowerCase();
  const local = data.items.filter((entry) => !entry.remote);
  const remote = data.items.filter((entry) => entry.remote);
  const anythingToDelete = data.items.some((entry) => entry.state === "ready");

  const toggle = (entry: CleanupItem) => {
    setArmed(false);
    setChoice((current) => ({ ...current, [entry.id]: !checked(entry) }));
  };

  return (
    <div className="mt-4 space-y-5 border-t border-paper-mist pt-4">
      {!anythingToDelete ? <PaperEmpty description="Nothing is left to clean up for this business." /> : null}

      <ItemGroup title="On your machine" items={local} checked={checked} onToggle={toggle} />
      {remote.length > 0 ? <ItemGroup title="On GitHub and Vercel: cannot be undone" items={remote} checked={checked} onToggle={toggle} danger /> : null}

      <div className="text-[13px] leading-5 text-paper-char">
        <p className="font-semibold text-paper-moss">Always kept</p>
        <ul className="list-disc pl-5">
          {data.keeps.map((keep) => (
            <li key={keep}>{keep}</li>
          ))}
        </ul>
      </div>

      {wantsRemote ? (
        <label className="block max-w-[28rem]">
          <FieldLabel>
            Type <span className="font-semibold">{data.company}</span> to delete from GitHub or Vercel
          </FieldLabel>
          <input value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" spellCheck={false} className={cn(PAPER_INPUT, "w-full")} />
        </label>
      ) : null}

      {selected.length > 0 ? (
        <div className="space-y-3">
          <p className="text-[14px] font-semibold text-paper-moss" aria-live="polite">
            {freed > 0 ? `Frees ${approximate ? "at least " : "about "}${formatBytes(freed)} on this machine.` : "Frees no space on this machine."}
          </p>
          {armed ? (
            <div role="alertdialog" aria-label="Confirm the delete" className="space-y-2 border-[1.5px] border-paper-flame-deep px-4 py-3">
              <p className="text-[14px] font-semibold text-paper-flame-deep">This permanently deletes {selected.length === 1 ? "the item" : `the ${selected.length} items`} ticked above. It cannot be undone.</p>
              <div className="flex flex-wrap gap-2">
                <PaperButton
                  variant="danger"
                  disabled={run.isPending}
                  onClick={() =>
                    run.mutate(
                      { prospectId: data.prospectId, items: selected.map((entry) => entry.id), confirm: true, ...(wantsRemote ? { confirmCompany: typed } : {}) },
                      { onSuccess: (result) => onCleaned(data, result) },
                    )
                  }
                >
                  {run.isPending ? "Deleting…" : "Yes, delete them"}
                </PaperButton>
                <PaperButton variant="ghost" disabled={run.isPending} onClick={() => setArmed(false)}>
                  Cancel
                </PaperButton>
              </div>
            </div>
          ) : (
            <PaperButton variant="danger" disabled={!nameOk} onClick={() => setArmed(true)}>
              Delete {selected.length} {selected.length === 1 ? "item" : "items"}…
            </PaperButton>
          )}
          {!nameOk ? <p className="text-[12.5px] text-paper-sage">Type the company's name above to unlock deleting from GitHub or Vercel.</p> : null}
        </div>
      ) : anythingToDelete ? (
        <p className="text-[13px] text-paper-sage">Tick what you want gone.</p>
      ) : null}

      {run.error ? (
        <p role="alert" className="text-[13px] text-paper-flame-deep">
          {run.error.message}
        </p>
      ) : null}
    </div>
  );
}

function ItemGroup({ title, items, checked, onToggle, danger }: { title: string; items: CleanupItem[]; checked: (entry: CleanupItem) => boolean; onToggle: (entry: CleanupItem) => void; danger?: boolean }) {
  return (
    <fieldset className="space-y-2">
      <legend className={cn("mb-1 text-[12px] font-semibold tracking-[0.06em] uppercase", danger ? "text-paper-flame-deep" : "text-paper-char")}>{title}</legend>
      {items.map((entry) => (
        <label key={entry.id} className={cn("flex items-start gap-3 border border-paper-mist px-3 py-2.5", entry.state === "ready" ? "cursor-pointer" : "opacity-80")}>
          <input type="checkbox" className="mt-1" checked={checked(entry)} disabled={entry.state !== "ready"} onChange={() => onToggle(entry)} />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-semibold text-paper-moss">{entry.label}</span>
              {entry.state !== "ready" ? <Tag tone={entry.state === "blocked" ? "flame" : "muted"}>{STATE_NOTE[entry.state]}</Tag> : null}
              {entry.bytes !== undefined ? (
                <span className="text-[12.5px] text-paper-sage tabular-nums">
                  {entry.approximate ? "at least " : ""}
                  {formatBytes(entry.bytes)}
                  {entry.files !== undefined ? ` · ${entry.files.toLocaleString("en-GB")} files` : ""}
                </span>
              ) : null}
            </span>
            <span className="block text-[12px] break-all text-paper-sage">{entry.location}</span>
            {entry.reason ? <span className="mt-0.5 block text-[12.5px] leading-5 text-paper-char">{entry.reason}</span> : null}
            {entry.warnings.map((warning) => (
              <span key={warning} className="mt-0.5 block text-[12.5px] leading-5 text-paper-amber-deep">
                {warning}
              </span>
            ))}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function Result({ data, result, onDone }: { data: CleanupPreview; result: CleanupResult; onDone: () => void }) {
  const labels = new Map(data.items.map((entry) => [entry.id, entry.label]));
  return (
    <div className="mt-4 space-y-3 border-t border-paper-mist pt-4" role="status">
      <p className="text-[14px] font-semibold text-paper-moss">{result.bytesFreed > 0 ? `Freed ${formatBytes(result.bytesFreed)} on this machine.` : "Done."}</p>
      <ul className="space-y-1.5">
        {result.results.map((entry) => (
          <li key={entry.id} className="text-[13px] leading-5">
            <Tag tone={entry.status === "deleted" ? "green" : entry.status === "failed" ? "flame" : "muted"}>{entry.status}</Tag> <span className="font-semibold text-paper-moss">{labels.get(entry.id) ?? entry.id}</span>
            <span className="block text-paper-char">{entry.detail}</span>
          </li>
        ))}
      </ul>
      <PaperButton variant="ghost" onClick={onDone}>
        Close
      </PaperButton>
    </div>
  );
}
