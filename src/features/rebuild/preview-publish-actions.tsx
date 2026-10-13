import { useId, useState } from "react";
import { Loader2, Rocket, Search, Stamp } from "lucide-react";
import { FieldLabel, PAPER_INPUT, PaperButton } from "@/components/paper";
import { useForcePreviewDeploy, useMarkPreviewDeployed, useRecheckPreview } from "@/lib/agentos/rebuilds";
import { previewPublishOverridesVisible } from "./preview-publish-model";

/**
 * When the Vercel preview is stuck on a stale rate-limit error, the operator
 * can force one API deploy, resync from Vercel, or paste a READY deployment.
 */
export function PreviewPublishActions({ runId, stage, busy }: { runId: string; stage: { id: string; status: string }; busy: boolean }) {
  const id = useId();
  const force = useForcePreviewDeploy(runId);
  const recheck = useRecheckPreview(runId);
  const mark = useMarkPreviewDeployed(runId);
  const [markOpen, setMarkOpen] = useState(false);
  const [deployment, setDeployment] = useState("");
  if (!previewPublishOverridesVisible(stage)) return null;

  const pending = busy || force.isPending || recheck.isPending || mark.isPending;
  const error = force.error ?? recheck.error ?? mark.error;

  return (
    <div className="basis-full grid gap-3 border-t border-paper-flame/30 pt-3">
      <p className="text-[12.5px] text-paper-sage">If a later Vercel deploy of this commit already succeeded, re-check it. Or force one new deploy, or paste a READY deployment id.</p>
      <div className="flex flex-wrap items-center gap-2">
        <PaperButton variant="amber" disabled={pending} onClick={() => force.mutate()}>
          {force.isPending ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Rocket className="size-3.5" aria-hidden="true" />}
          {force.isPending ? "Deploying…" : "Deploy now (force)"}
        </PaperButton>
        <PaperButton disabled={pending} onClick={() => recheck.mutate()}>
          {recheck.isPending ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Search className="size-3.5" aria-hidden="true" />}
          {recheck.isPending ? "Checking Vercel…" : "Re-check Vercel"}
        </PaperButton>
        <PaperButton disabled={pending} onClick={() => setMarkOpen((open) => !open)}>
          <Stamp className="size-3.5" aria-hidden="true" /> Mark as deployed
        </PaperButton>
      </div>
      {markOpen ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const value = deployment.trim();
            if (!value || pending) return;
            mark.mutate({ deployment: value });
          }}
        >
          <label htmlFor={`${id}-deployment`} className="grid min-w-[16rem] flex-1 gap-1">
            <FieldLabel>Vercel deployment URL or id</FieldLabel>
            <input
              id={`${id}-deployment`}
              className={PAPER_INPUT}
              value={deployment}
              onChange={(event) => setDeployment(event.target.value)}
              placeholder="dpl_… or https://….vercel.app"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <PaperButton variant="amber" disabled={pending || !deployment.trim()} type="submit">
            {mark.isPending ? "Saving…" : "Save as live preview"}
          </PaperButton>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-[12.5px] text-paper-flame-deep">
          {error.message}
        </p>
      ) : null}
    </div>
  );
}
