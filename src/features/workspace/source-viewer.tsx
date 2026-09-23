import { FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { SectionLabel, TabBar } from "@/components/os";
import { useProjectSource } from "@/lib/agentos/queries";

/**
 * The markdown underneath.
 *
 * AgentOS is a better way to operate the vault, not a replacement for it, and
 * hiding the files would quietly make it one. Being able to read exactly what a
 * mutation wrote is what makes the whole editable layer trustworthy — the first
 * time a task moves and the file looks wrong, this is where that gets settled.
 *
 * Read-only. Editing raw markdown through a textarea would bypass every
 * protection in the mutation layer — the revision check, the validation, the
 * backup — and an editor already exists for that job.
 */

const FILES = [
  { value: "PROJECT.md", label: "Project" },
  { value: "STATUS.md", label: "Status" },
  { value: "TASKS.md", label: "Tasks" },
  { value: "DECISIONS.md", label: "Decisions" },
] as const;

type SourceFile = (typeof FILES)[number]["value"];

export function SourceViewer({
  project,
  initialFile = "TASKS.md",
  onClose,
}: {
  project: string;
  initialFile?: SourceFile;
  onClose: () => void;
}) {
  const [file, setFile] = useState<SourceFile>(initialFile);
  const { data, isPending } = useProjectSource(project, file, true);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[8vh] pb-8">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-os-background/88"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${project} source`}
        className="relative flex max-h-full w-[min(94vw,56rem)] flex-col overflow-hidden rounded-xl border border-os-border-strong bg-os-surface"
      >
        <header className="border-b border-os-border px-5 pt-4">
          <div className="flex items-center gap-2.5">
            <FileText
              className="size-3.5 text-os-subtle"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <SectionLabel>{project} · source</SectionLabel>
          </div>

          <TabBar<SourceFile>
            options={FILES.map(({ value, label }) => ({ value, label }))}
            value={file}
            onChange={setFile}
            label="Project files"
            className="mt-3 border-b-0"
          />
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {isPending ? (
            <p className="text-[15px] leading-6 text-os-muted">Reading…</p>
          ) : data?.contents ? (
            <pre className="font-mono text-[12px] leading-[1.7] whitespace-pre-wrap break-words text-os-muted">
              {data.contents}
            </pre>
          ) : (
            <p className="text-[15px] leading-6 text-os-subtle">
              This project has no {file}.
            </p>
          )}
        </div>

        {data?.revision ? (
          <footer className="border-t border-os-border px-5 py-3">
            <span className="os-meta text-os-subtle">{data.revision}</span>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
