import { useRef, useState, type ClipboardEvent, type Dispatch, type DragEvent, type SetStateAction } from "react";
import { ImagePlus, Library, X } from "lucide-react";
import { MAX_REFERENCE_IMAGES } from "@shared/design-generation-types";
import type { DesignAsset } from "@shared/agentos-types";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton } from "@/components/paper";
import { useDesignLibrary, useUploadDesignAsset } from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";

/**
 * The references a generation draws from, managed where the prompt is
 * written: upload, drop or paste a new image, pick one already in the
 * library, or take one off. New files land in the library as `reference`
 * assets, so the concept's provenance still points at something real.
 */

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"];
/** Shown in the library picker; a search narrows it. */
const PICKER_LIMIT = 60;

export interface GenerateReferencePickerProps {
  /** The chosen references, in order. */
  references: DesignAsset[];
  onChange: Dispatch<SetStateAction<DesignAsset[]>>;
  /** The workspace the generation is for: uploads are filed under it. */
  project?: string;
}

export function GenerateReferencePicker({ references, onChange, project }: GenerateReferencePickerProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = useUploadDesignAsset();
  const { data: library } = useDesignLibrary();
  const [browsing, setBrowsing] = useState(false);
  const [search, setSearch] = useState("");
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string>();

  const room = MAX_REFERENCE_IMAGES - references.length;
  const chosen = new Set(references.map((asset) => asset.id));

  const add = (files: File[]) => {
    setNotice(undefined);
    const images = files.filter((file) => IMAGE_TYPES.includes(file.type));
    if (images.length < files.length) setNotice("Only PNG, JPEG, WebP, GIF and AVIF images can be references.");
    const accepted = images.slice(0, Math.max(0, room));
    if (images.length > accepted.length) setNotice(`A generation takes at most ${MAX_REFERENCE_IMAGES} references.`);
    // mutateAsync, not mutate: with several files in flight, mutate only reports back for the last one.
    for (const file of accepted) {
      upload
        .mutateAsync({ file, options: { type: "reference", project: project || undefined } })
        // Uploads finish one at a time: each adds to whatever the list is by then.
        .then((asset) => onChange((current) => (current.length < MAX_REFERENCE_IMAGES && !current.some((entry) => entry.id === asset.id) ? [...current, asset] : current)))
        .catch(() => undefined); // Shown through upload.error.
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    // Handled here, not by the library page behind: a file dropped on the panel is meant as a reference.
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    add(Array.from(event.dataTransfer.files));
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    add(files);
  };

  const query = search.trim().toLowerCase();
  const candidates = (library?.assets ?? [])
    .filter((asset) => asset.mediaType === "image" && !chosen.has(asset.id))
    .filter((asset) => !query || [asset.filename, asset.project ?? "", asset.product ?? "", ...asset.tags].some((value) => value.toLowerCase().includes(query)))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, PICKER_LIMIT);

  return (
    <div
      className={cn("mt-6 border border-dashed p-3 transition-colors", dragging ? "border-paper-blue bg-paper-linen" : "border-paper-mist")}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onPaste={onPaste}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <FieldLabel>References</FieldLabel>
        <span className="text-[12px] text-paper-sage">
          {references.length} of {MAX_REFERENCE_IMAGES} · drop, paste or add images the result should follow
        </span>
      </div>

      {references.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Chosen references">
          {references.map((asset) => (
            <li key={asset.id} className="relative">
              <img src={asset.thumbnailUrl} alt={asset.filename} className="size-16 rounded-none object-cover ring-1 ring-paper-mist" />
              <button
                type="button"
                onClick={() => onChange(references.filter((entry) => entry.id !== asset.id))}
                aria-label={`Remove reference ${asset.filename}`}
                className={cn("absolute -top-1.5 -right-1.5 rounded-none bg-paper-white p-0.5 text-paper-sage ring-1 ring-paper-mist hover:text-paper-flame", PAPER_FOCUS)}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            add(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <PaperButton onClick={() => fileInput.current?.click()} disabled={room <= 0 || upload.isPending}>
          <ImagePlus className="size-3.5" aria-hidden="true" /> {upload.isPending ? "Uploading…" : "Upload"}
        </PaperButton>
        <PaperButton onClick={() => setBrowsing((open) => !open)} disabled={room <= 0 && !browsing} aria-expanded={browsing}>
          <Library className="size-3.5" aria-hidden="true" /> {browsing ? "Done" : "From library"}
        </PaperButton>
      </div>

      {notice || upload.error ? (
        <p role="alert" className="mt-2 text-[12.5px] text-paper-flame-deep">
          {notice ?? (upload.error instanceof Error ? upload.error.message : "That file could not be uploaded.")}
        </p>
      ) : null}

      {browsing ? (
        <div className="mt-3 border-t border-paper-mist pt-3">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, tag, workspace or product"
            aria-label="Search the library for a reference"
            className={cn(PAPER_INPUT, "w-full max-w-sm")}
          />
          {candidates.length === 0 ? (
            <p className="mt-2 text-[12.5px] text-paper-sage">{query ? "No images match." : "No other images in the library yet."}</p>
          ) : (
            <ul className="mt-2 grid max-h-64 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6 lg:grid-cols-8" aria-label="Library images">
              {candidates.map((asset) => (
                <li key={asset.id}>
                  <button
                    type="button"
                    disabled={room <= 0}
                    onClick={() => onChange([...references, asset])}
                    aria-label={`Use ${asset.filename} as a reference`}
                    className={cn("block w-full ring-1 ring-paper-mist hover:ring-paper-blue disabled:cursor-not-allowed disabled:opacity-40", PAPER_FOCUS)}
                  >
                    <img src={asset.thumbnailUrl} alt="" className="aspect-square w-full object-cover" loading="lazy" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
