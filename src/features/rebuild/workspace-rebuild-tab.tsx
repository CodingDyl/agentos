import { useRebuildForWorkspace } from "@/lib/agentos/rebuilds";
import { RebuildView } from "./rebuild-page";

/** A client rebuild's workspace shows the rebuild itself as a tab, live while stages run. */
export function WorkspaceRebuildTab({ slug }: { slug: string }) {
  const rebuild = useRebuildForWorkspace(slug);
  if (rebuild.isPending) return <p role="status">Loading the rebuild…</p>;
  if (rebuild.error) {
    return (
      <p role="alert" className="border border-paper-flame-deep p-3 text-paper-flame-deep">
        {rebuild.error.message}
      </p>
    );
  }
  if (!rebuild.data) return <p className="text-[13.5px] text-paper-sage">This workspace has no website rebuild.</p>;
  return <RebuildView run={rebuild.data} inWorkspace />;
}
