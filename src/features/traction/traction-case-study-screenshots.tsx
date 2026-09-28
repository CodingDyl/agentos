import { ArrowLeft, ImagePlus, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { MAX_CASE_STUDY_IMAGES } from "@shared/traction-types";
import { FieldLabel, PAPER_FOCUS, PaperButton, SegmentedControl } from "@/components/paper";
import { useDesignLibrary, useUploadDesignAsset } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";

/**
 * A case study's screenshots, chosen from Creative.
 *
 * The images stay in Creative; the study holds their ids in order. Picking
 * starts with the study's own workspace, since that is almost always where
 * its screenshots are, with the whole library one switch away. A new
 * screenshot can be uploaded from here, and lands in Creative tagged with the
 * workspace so it is findable later too.
 */
export function CaseStudyScreenshots({
  assetIds,
  workspace,
  onChange,
}: {
  assetIds: readonly string[];
  workspace?: string;
  onChange: (assetIds: string[]) => void;
}) {
  const { data: library, isPending } = useDesignLibrary();
  const upload = useUploadDesignAsset();
  const [picking, setPicking] = useState(false);
  const [scope, setScope] = useState<"workspace" | "all">(workspace ? "workspace" : "all");
  const fileInput = useRef<HTMLInputElement>(null);

  const images = (library?.assets ?? []).filter((asset) => asset.mediaType !== "video");
  const byId = new Map(images.map((asset) => [asset.id, asset]));
  const choices = images.filter((asset) => scope === "all" || asset.project === workspace);
  const full = assetIds.length >= MAX_CASE_STUDY_IMAGES;

  const toggle = (id: string) =>
    onChange(assetIds.includes(id) ? assetIds.filter((entry) => entry !== id) : full ? [...assetIds] : [...assetIds, id]);
  const moveEarlier = (index: number) => {
    if (index === 0) return;
    const next = [...assetIds];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next);
  };

  return (
    <div>
      <FieldLabel>
        Screenshots <span className="font-normal text-paper-ash">(shown after "What we built", in this order)</span>
      </FieldLabel>

      {assetIds.length > 0 ? (
        <ol className="mb-3 flex flex-wrap gap-3">
          {assetIds.map((id, index) => {
            const asset = byId.get(id);
            return (
              <li key={id} className="w-36">
                <div className="relative overflow-hidden rounded-[4px] border border-paper-mist bg-paper-linen">
                  {asset ? (
                    <img src={asset.thumbnailUrl} alt={asset.notes ?? asset.filename} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="grid aspect-[4/3] place-items-center px-2 text-center text-[12px] text-paper-sage">
                      {isPending ? "Loading…" : "No longer in Creative"}
                    </div>
                  )}
                  <span className="absolute top-1 left-1 rounded-[3px] bg-paper-white/90 px-1.5 text-[11px] font-semibold text-paper-moss tabular-nums">{index + 1}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-1">
                  <span className="min-w-0 truncate text-[11.5px] text-paper-sage">{asset?.filename ?? id.slice(0, 8)}</span>
                  <span className="flex shrink-0">
                    <button
                      type="button"
                      onClick={() => moveEarlier(index)}
                      disabled={index === 0}
                      aria-label={`Move screenshot ${index + 1} earlier`}
                      className={cn("cursor-pointer rounded-[3px] p-1 text-paper-sage hover:text-paper-moss disabled:cursor-default disabled:opacity-30", PAPER_FOCUS)}
                    >
                      <ArrowLeft className="size-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle(id)}
                      aria-label={`Remove screenshot ${index + 1}`}
                      className={cn("cursor-pointer rounded-[3px] p-1 text-paper-sage hover:text-paper-flame-deep", PAPER_FOCUS)}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mb-3 text-[13px] text-paper-sage">None yet. A before, an after, and one detail that sells it is usually enough.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <PaperButton onClick={() => setPicking((open) => !open)} aria-expanded={picking}>
          <ImagePlus className="size-3.5" aria-hidden="true" />
          {picking ? "Done choosing" : "Choose from Creative"}
        </PaperButton>
        <PaperButton disabled={upload.isPending || full} onClick={() => fileInput.current?.click()}>
          <Upload className="size-3.5" aria-hidden="true" />
          {upload.isPending ? "Uploading…" : "Upload screenshot"}
        </PaperButton>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            upload.mutate(
              { file, options: { project: workspace, type: "screenshot" } },
              { onSuccess: (asset) => onChange([...assetIds, asset.id].slice(0, MAX_CASE_STUDY_IMAGES)) },
            );
          }}
        />
        {full ? <span className="text-[12.5px] text-paper-sage">{MAX_CASE_STUDY_IMAGES} is the most a study holds.</span> : null}
      </div>
      {upload.error ? (
        <p role="alert" className="mt-2 text-[13px] text-paper-flame-deep">
          {upload.error.message}
        </p>
      ) : null}

      {picking ? (
        <div className="mt-3 rounded-[4px] border border-paper-mist bg-paper-cream p-3">
          {workspace ? (
            <div className="mb-3">
              <SegmentedControl
                label="Which images"
                value={scope}
                onChange={setScope}
                options={[
                  { value: "workspace", label: "This workspace" },
                  { value: "all", label: "All of Creative" },
                ]}
              />
            </div>
          ) : null}
          {choices.length === 0 ? (
            <p className="text-[13px] text-paper-sage">
              {isPending ? "Reading Creative…" : scope === "workspace" ? "No images for this workspace. Try All of Creative, or upload one." : "Creative has no images yet."}
            </p>
          ) : (
            <ul className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5 lg:grid-cols-6">
              {choices.map((asset) => {
                const selected = assetIds.includes(asset.id);
                return (
                  <li key={asset.id}>
                    <button
                      type="button"
                      onClick={() => toggle(asset.id)}
                      disabled={!selected && full}
                      aria-pressed={selected}
                      aria-label={`${selected ? "Remove" : "Add"} ${asset.filename}`}
                      className={cn(
                        "block w-full cursor-pointer overflow-hidden rounded-[4px] border-2 disabled:cursor-not-allowed disabled:opacity-40",
                        selected ? "border-paper-blue" : "border-transparent hover:border-paper-mist",
                        PAPER_FOCUS,
                      )}
                    >
                      <img src={asset.thumbnailUrl} alt="" className="aspect-[4/3] w-full object-cover" loading="lazy" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
