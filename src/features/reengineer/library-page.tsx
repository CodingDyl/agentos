import { Check, ClipboardCopy, Link2, Microscope, Search, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { LIBRARY_KINDS, type LibraryEntry, type ReengineerRunView } from "@shared/reengineer-types";
import { AppShell } from "@/components/os";
import {
  FieldLabel,
  PAPER_FOCUS,
  PAPER_INPUT,
  PaperBackLink,
  PaperButton,
  PaperEmpty,
  PaperIndicator,
  PaperLoading,
  PaperNotice,
  PaperPageHeader,
  PaperSection,
  PaperStage,
  SegmentedControl,
  Tag,
} from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { fetchLibraryBrief, useLibrary, useRecordVerdict, useReengineerReadiness, useReengineerRuns, useStartReengineer } from "@/lib/agentos/reengineer";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Library: what has been taken apart, and what was learned from it.
 *
 * The top is the intake: give a site (later an app or a source), say what to
 * understand, and Claude Code takes it apart with REA. What comes back lands
 * here as entries — components, patterns, motion — and in Knowledge as a
 * teardown note. A person's verdict on an entry (proven, rejected, used) is the
 * part that teaches the next build.
 */

type Filter = "all" | (typeof LIBRARY_KINDS)[number];
type Standing = "all" | "proven" | "candidate" | "rejected";

const STANDING = [
  { value: "all" as const, label: "All" },
  { value: "proven" as const, label: "Proven" },
  { value: "candidate" as const, label: "To judge" },
  { value: "rejected" as const, label: "Rejected" },
];

export function LibraryPage() {
  const navigationItems = useNavigationItems();
  const library = useLibrary();
  const runs = useReengineerRuns();
  const [kind, setKind] = useState<Filter>("all");
  const [standing, setStanding] = useState<Standing>("all");
  const [query, setQuery] = useState("");

  const entries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (library.data ?? []).filter(
      (entry) =>
        (kind === "all" || entry.kind === kind) &&
        (standing === "all" || entry.status === standing) &&
        (!needle || `${entry.title} ${entry.summary} ${entry.tags.join(" ")} ${entry.source.target}`.toLowerCase().includes(needle)),
    );
  }, [library.data, kind, standing, query]);

  return (
    <AppShell navigationItems={navigationItems} pageId="knowledge" activeHref="/knowledge" modelLabel="Model / Claude Code">
      <PaperStage>
        <PaperBackLink to="/knowledge">Knowledge</PaperBackLink>
        <PaperPageHeader
          className="mt-3"
          title="Library"
          description="Take a site apart, keep what worked. Components, patterns and motion learned from other products, with why each works. Mark them proven or rejected: website rebuilds, Motion, Animate and Motion Design read this library before they build, so proven patterns are offered and rejected ones avoided."
        />

        <div className="mt-10 grid gap-x-14 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <div className="min-w-0 space-y-10">
            <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
              <label className="relative block min-w-[14rem] flex-1">
                <FieldLabel>Search</FieldLabel>
                <Search className="pointer-events-none absolute bottom-3 left-3 size-3.5 text-paper-sage" aria-hidden="true" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="sticky header, scroll motion, bosch.co.za" className={cn(PAPER_INPUT, "w-full pl-9")} />
              </label>
              <div>
                <FieldLabel>Standing</FieldLabel>
                <SegmentedControl label="Standing" options={STANDING} value={standing} onChange={setStanding} />
              </div>
            </div>

            <KindFilter value={kind} onChange={setKind} entries={library.data ?? []} />

            {library.isPending ? (
              <PaperLoading title="Library" message="Reading the library from your vault…" />
            ) : entries.length === 0 ? (
              <PaperEmpty
                title={(library.data ?? []).length === 0 ? "Nothing learned yet" : "Nothing matches"}
                description={(library.data ?? []).length === 0 ? "Start a teardown on the right. When it finishes, its components and patterns appear here to judge." : "Try a different filter or search."}
              />
            ) : (
              <ul className="grid gap-4 2xl:grid-cols-2">
                {entries.map((entry) => (
                  <li key={entry.id} className="border border-paper-mist bg-paper-white">
                    <Entry entry={entry} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <aside className="min-w-0 space-y-12">
            <Intake />
            <Runs runs={runs.data ?? []} />
            <CopyBrief />
          </aside>
        </div>
      </PaperStage>
    </AppShell>
  );
}

function KindFilter({ value, onChange, entries }: { value: Filter; onChange: (value: Filter) => void; entries: LibraryEntry[] }) {
  const counts = (kind: string) => entries.filter((entry) => entry.kind === kind).length;
  return (
    <div role="group" aria-label="Kind" className="flex flex-wrap gap-1">
      {(["all", ...LIBRARY_KINDS] as const).map((kind) => {
        const count = kind === "all" ? entries.length : counts(kind);
        if (kind !== "all" && count === 0 && value !== kind) return null;
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={value === kind}
            onClick={() => onChange(kind)}
            className={cn(
              "min-h-8 cursor-pointer px-3 text-[13px] font-medium capitalize transition-colors duration-150",
              PAPER_FOCUS,
              value === kind ? "bg-paper-blue text-paper-white" : "text-paper-sage hover:bg-paper-stone hover:text-paper-moss",
            )}
          >
            {kind} <span className="tabular-nums opacity-70">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

function Entry({ entry }: { entry: LibraryEntry }) {
  const verdict = useRecordVerdict();
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const send = (kind: "proven" | "rejected" | "used" | "candidate", text?: string) => verdict.mutate({ id: entry.id, verdict: kind, note: text || undefined });

  return (
    <article className={cn("flex h-full flex-col", entry.status === "rejected" && "opacity-70")}>
      {entry.screenshotUrl ? <img src={entry.screenshotUrl} alt={`Evidence for ${entry.title}`} loading="lazy" className="aspect-[16/9] w-full bg-paper-moss object-cover object-top" /> : null}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone={entry.status === "proven" ? "green" : entry.status === "rejected" ? "flame" : "muted"}>{entry.status === "candidate" ? "To judge" : entry.status}</Tag>
          <span className="font-paper-utility text-[11.5px] tracking-[0.08em] text-paper-sage uppercase">{entry.kind}</span>
          {entry.uses > 0 ? <span className="text-[12px] text-paper-sage tabular-nums">used {entry.uses}×</span> : null}
        </div>
        <h3 className="font-paper-display text-[16px] leading-6 font-bold tracking-[-0.01em] text-paper-moss">{entry.title}</h3>
        <p className="text-[13.5px] leading-6 text-paper-char">{entry.summary}</p>
        {entry.whyItWorks ? (
          <p className="text-[13px] leading-6 text-paper-moss">
            <span className="font-medium">Why it works. </span>
            {entry.whyItWorks}
          </p>
        ) : null}
        <p className="text-[12px] leading-5 break-words text-paper-sage">
          From {entry.source.target} · {formatRelativeTime(entry.createdAt)}
          {entry.tags.length > 0 ? ` · ${entry.tags.join(", ")}` : ""}
        </p>
        {entry.verdicts.length > 0 && entry.verdicts.at(-1)?.note ? <p className="border-l-2 border-paper-mist pl-3 text-[12.5px] leading-5 text-paper-char">“{entry.verdicts.at(-1)!.note}”</p> : null}

        <div className="mt-auto pt-2">
          {rejecting ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                send("rejected", note.trim());
                setRejecting(false);
                setNote("");
              }}
              className="space-y-2"
            >
              <label className="block">
                <FieldLabel>Why not?</FieldLabel>
                <input value={note} onChange={(event) => setNote(event.target.value)} autoFocus placeholder="Janky on mobile" className={cn(PAPER_INPUT, "w-full")} />
              </label>
              <div className="flex gap-2">
                <PaperButton type="submit" variant="danger" disabled={verdict.isPending}>
                  Reject
                </PaperButton>
                <PaperButton type="button" variant="ghost" onClick={() => setRejecting(false)}>
                  Back
                </PaperButton>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {entry.status !== "proven" ? (
                <PaperButton variant="amber" onClick={() => send("proven")} disabled={verdict.isPending}>
                  <Check className="size-3.5" aria-hidden="true" />
                  Proven
                </PaperButton>
              ) : (
                <PaperButton variant="ghost" onClick={() => send("used")} disabled={verdict.isPending}>
                  Used it
                </PaperButton>
              )}
              {entry.status !== "rejected" ? (
                <PaperButton variant="ghost" onClick={() => setRejecting(true)} disabled={verdict.isPending}>
                  <X className="size-3.5" aria-hidden="true" />
                  Reject
                </PaperButton>
              ) : (
                <PaperButton variant="ghost" onClick={() => send("candidate")} disabled={verdict.isPending}>
                  Reconsider
                </PaperButton>
              )}
            </div>
          )}
          {verdict.isError ? (
            <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
              {verdict.error instanceof Error ? verdict.error.message : "That could not be saved."}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function Intake() {
  const readiness = useReengineerReadiness();
  const start = useStartReengineer();
  const [target, setTarget] = useState("");
  const [question, setQuestion] = useState("");
  const [focus, setFocus] = useState("");

  const missing = readiness.data?.missing ?? [];
  const submit = (event: FormEvent) => {
    event.preventDefault();
    start.mutate(
      { target: target.trim(), question: question.trim() || undefined, focus: focus.split(",").map((part) => part.trim()).filter(Boolean) },
      {
        onSuccess: () => {
          setTarget("");
          setQuestion("");
          setFocus("");
        },
      },
    );
  };

  return (
    <form onSubmit={submit} aria-label="Start a teardown">
      <h2 className="font-paper-display text-[17px] leading-6 font-bold tracking-[-0.01em] text-paper-moss">Take something apart</h2>
      <div className="mt-4 grid gap-4">
        <label className="block">
          <FieldLabel>Website, app or source</FieldLabel>
          <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="https://linear.app" className={cn(PAPER_INPUT, "w-full")} required />
          <span className="mt-1 block text-[12.5px] text-paper-sage">Websites first. Apps and source folders are accepted, with less to go on.</span>
        </label>
        <label className="block">
          <FieldLabel>What do you want to understand? (optional)</FieldLabel>
          <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} placeholder="How does their scroll-driven hero work?" className={cn(PAPER_INPUT, "w-full resize-y py-2 leading-6")} />
        </label>
        <label className="block">
          <FieldLabel>Look especially at (optional)</FieldLabel>
          <input value={focus} onChange={(event) => setFocus(event.target.value)} placeholder="navigation, scroll motion, pricing" className={cn(PAPER_INPUT, "w-full")} />
        </label>
      </div>

      {missing.length > 0 ? <PaperNotice className="mt-4">{missing.join(" ")}</PaperNotice> : null}
      {readiness.data && missing.length === 0 && !readiness.data.browser ? (
        <p className="mt-3 text-[12.5px] leading-5 text-paper-sage">
          No Chrome with remote debugging is listening, so REA will read the site from its files rather than watch it run. For a live look, start Chrome with <span className="font-mono">--remote-debugging-port=9222</span>.
        </p>
      ) : null}
      {start.isError ? (
        <p role="alert" className="mt-3 text-[13.5px] text-paper-flame-deep">
          {start.error instanceof Error ? start.error.message : "The teardown could not be started."}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <PaperButton type="submit" variant="amber" className="min-h-11 px-5" disabled={start.isPending || missing.length > 0 || !target.trim()}>
          <Microscope className="size-3.5" aria-hidden="true" />
          {start.isPending ? "Starting…" : "Start the teardown"}
        </PaperButton>
        <span className="text-[12.5px] text-paper-sage">Runs on your Claude Code plan, about 10 to 30 minutes.</span>
      </div>
    </form>
  );
}

const RUN_TONE = { running: "amber", awaiting_review: "amber", completed: "green", failed: "flame", cancelled: "muted" } as const;
const RUN_LABEL = { running: "Taking it apart", awaiting_review: "Filing the results", completed: "In the library", failed: "Stopped with a problem", cancelled: "Stopped" } as const;

function Runs({ runs }: { runs: ReengineerRunView[] }) {
  return (
    <PaperSection label="Teardowns" count={runs.length || undefined}>
      {runs.length === 0 ? (
        <p className="text-[13.5px] leading-6 text-paper-sage">None yet.</p>
      ) : (
        <ul className="divide-y divide-paper-mist border-y border-paper-mist">
          {runs.map((run) => (
            <li key={run.id} className="py-3">
              <p className="truncate text-[14px] font-semibold text-paper-moss" title={run.target}>
                {run.target}
              </p>
              <p className="mt-0.5 text-[12.5px] text-paper-sage tabular-nums">
                {run.kind} · {formatRelativeTime(run.createdAt)}
                {run.entryIds.length > 0 ? ` · ${run.entryIds.length} entries` : ""}
              </p>
              <PaperIndicator tone={RUN_TONE[run.status]} label={RUN_LABEL[run.status]} className="mt-1.5" />
              {run.error ? <p className="mt-1.5 text-[12.5px] leading-5 text-paper-flame-deep">{run.error}</p> : null}
              <p className="mt-1.5 flex flex-wrap gap-x-4 text-[12.5px]">
                <Link to={run.jobHref} className={cn("inline-flex items-center gap-1 text-paper-blue hover:underline", PAPER_FOCUS)}>
                  <Link2 className="size-3" aria-hidden="true" />
                  Worker job
                </Link>
                {run.notePath ? <span className="text-paper-sage">Note: {run.notePath}</span> : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </PaperSection>
  );
}

/** The library as text, for pasting into a brief or a prompt. */
function CopyBrief() {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  return (
    <PaperSection label="Use it in a build">
      <p className="text-[13px] leading-6 text-paper-char">Builds already read the relevant part of the library on their own. This copies all of it, for a brief or a worker you write by hand: proven patterns, then ones worth trying, with rejected ones named so they aren't reached for.</p>
      <PaperButton
        className="mt-3"
        variant="ghost"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(await fetchLibraryBrief());
            setState("copied");
          } catch {
            setState("error");
          }
          setTimeout(() => setState("idle"), 2000);
        }}
      >
        <ClipboardCopy className="size-3.5" aria-hidden="true" />
        {state === "copied" ? "Copied" : state === "error" ? "Could not copy" : "Copy the library as a brief"}
      </PaperButton>
    </PaperSection>
  );
}
