import { Check, Heart, PenLine, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  DesignAsset,
  DesignAssetType,
  DesignBoard,
  ProjectSummary,
} from "@shared/agentos-types";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton } from "@/components/paper";
import { cn } from "@/lib/utils";
import { formatAdded, typeLabel } from "./designs-model";

/** The same toggle chip `PaperFilterBar` draws, for choices inside a panel. */
const CHIP =
  "inline-flex min-h-8 cursor-pointer items-center rounded-[4px] border px-3 text-[13px] font-medium transition-colors duration-150 " +
  PAPER_FOCUS;
const CHIP_ON = "border-paper-moss bg-paper-moss text-paper-white";
const CHIP_OFF = "border-paper-mist text-paper-char hover:bg-paper-linen hover:text-paper-moss";

const TYPES: readonly DesignAssetType[] = [
  "uploaded",
  "generated",
  "reference",
  "screenshot",
];

export interface AssetLightboxProps {
  asset: DesignAsset;
  boards: DesignBoard[];
  projects: ProjectSummary[];
  onClose: () => void;
  onPatch: (patch: {
    project?: string | null;
    tags?: string[];
    favorite?: boolean;
    approved?: boolean;
    product?: string | null;
    notes?: string | null;
    type?: DesignAssetType;
  }) => void;
  onToggleBoard: (boardId: string, member: boolean) => void;
  onDelete: () => void;
}

/**
 * One asset, at full size, with everything that is known about it.
 *
 * The image gets the room; the panel beside it is where an asset stops being a
 * picture and becomes part of a project — assigned, tagged, collected. Editing
 * happens in place, and each change is saved as it is made.
 */
export function AssetLightbox({
  asset,
  boards,
  projects,
  onClose,
  onPatch,
  onToggleBoard,
  onDelete,
}: AssetLightboxProps) {
  const [tagDraft, setTagDraft] = useState(asset.tags.join(", "));
  const [notesDraft, setNotesDraft] = useState(asset.notes ?? "");
  const [productDraft, setProductDraft] = useState(asset.product ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [shownAssetId, setShownAssetId] = useState(asset.id);

  // Stepping to a different asset is a different set of drafts. Adjusted
  // during render rather than in an effect, so the fields never paint once
  // with the previous asset's text.
  if (shownAssetId !== asset.id) {
    setShownAssetId(asset.id);
    setTagDraft(asset.tags.join(", "));
    setNotesDraft(asset.notes ?? "");
    setProductDraft(asset.product ?? "");
    setConfirmingDelete(false);
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const commitTags = () => {
    const tags = tagDraft
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    if (tags.join(",") !== asset.tags.join(",")) onPatch({ tags });
  };

  const commitNotes = () => {
    const notes = notesDraft.trim();
    if (notes !== (asset.notes ?? "")) onPatch({ notes: notes || null });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-paper-moss/60"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={asset.filename}
        className="relative flex max-h-full w-[min(96vw,80rem)] flex-col overflow-hidden rounded-[6px] border border-paper-moss bg-paper-white font-paper-ui text-paper-moss lg:flex-row"
      >
        <div className="flex min-h-0 flex-1 items-center justify-center bg-paper-linen p-4 md:p-8">
          <img
            src={asset.url}
            alt={asset.filename}
            className="max-h-[45vh] max-w-full object-contain lg:max-h-[80vh]"
          />
        </div>

        <div className="flex w-full shrink-0 flex-col gap-8 overflow-y-auto border-t border-paper-mist p-5 md:p-6 lg:w-96 lg:border-t-0 lg:border-l">
          <header className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="truncate font-paper-display text-[17px] leading-6 font-bold tracking-[-0.01em] text-paper-moss">
                {asset.filename}
              </h2>
              <p className="mt-1 text-[12.5px] text-paper-sage">
                Added {formatAdded(asset.createdAt)}
                {asset.width && asset.height
                  ? ` · ${asset.width}×${asset.height}`
                  : ""}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <IconButton
                label={asset.favorite ? "Remove favourite" : "Favourite"}
                onClick={() => onPatch({ favorite: !asset.favorite })}
                active={asset.favorite}
              >
                <Heart
                  className={cn("size-4", asset.favorite && "fill-current")}
                  strokeWidth={1.5}
                />
              </IconButton>
              {/* Liking a concept and choosing it are different claims, so
                  they are different controls. Approved is the one that means
                  "this is the design". */}
              <IconButton
                label={asset.approved ? "Withdraw approval" : "Approve design"}
                onClick={() => onPatch({ approved: !asset.approved })}
                active={asset.approved}
              >
                <Check className="size-4" strokeWidth={1.5} />
              </IconButton>
              <IconButton label="Close" onClick={onClose}>
                <X className="size-4" strokeWidth={1.5} />
              </IconButton>
            </div>
          </header>

          <Field label="Project">
            <ChoiceRow
              options={[
                { value: "", label: "None" },
                ...projects.map((project) => ({
                  value: project.slug,
                  label: project.name,
                })),
              ]}
              value={asset.project ?? ""}
              onChange={(value) => onPatch({ project: value || null })}
            />
          </Field>

          <Field label="Type">
            <ChoiceRow
              options={TYPES.map((type) => ({
                value: type,
                label: typeLabel(type),
              }))}
              value={asset.type}
              onChange={(value) => onPatch({ type: value as DesignAssetType })}
            />
          </Field>

          <Field label="Tags">
            <input
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              onBlur={commitTags}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              placeholder="mobile, nutrition, dark"
              className={cn(PAPER_INPUT, "w-full")}
            />
          </Field>

          <Field label="Boards">
            {boards.length === 0 ? (
              <p className="text-[13.5px] leading-5 text-paper-sage">
                No boards yet. Create one from the Boards screen.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {boards.map((board) => {
                  const member = asset.boardIds.includes(board.id);

                  return (
                    <button
                      key={board.id}
                      type="button"
                      aria-pressed={member}
                      onClick={() => onToggleBoard(board.id, !member)}
                      className={cn(
                        CHIP,
                        member ? CHIP_ON : CHIP_OFF,
                      )}
                    >
                      {board.name}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>

          {asset.source === "higgsfield" || asset.model || asset.prompt ? (
            <Field label="How it was made">
              <p className="text-[13px] text-paper-sage">
                {asset.source === "higgsfield" ? "Higgsfield" : asset.source}
                {asset.model ? ` · ${asset.model}` : ""}
                {asset.referenceAssetIds.length > 0
                  ? ` · ${asset.referenceAssetIds.length} reference${asset.referenceAssetIds.length === 1 ? "" : "s"}`
                  : ""}
              </p>
              {asset.prompt ? (
                <p className="mt-2 max-w-[48ch] text-[13.5px] leading-5 text-paper-char">{asset.prompt}</p>
              ) : null}
            </Field>
          ) : null}

          <Field label="Product">
            <input
              value={productDraft}
              onChange={(event) => setProductDraft(event.target.value)}
              onBlur={() => {
                const next = productDraft.trim();
                if (next !== (asset.product ?? "")) onPatch({ product: next || null });
              }}
              placeholder="chef"
              className={cn(PAPER_INPUT, "w-full")}
            />
          </Field>

          <Field label="Notes">
            <textarea
              value={notesDraft}
              onChange={(event) => setNotesDraft(event.target.value)}
              onBlur={commitNotes}
              rows={3}
              placeholder="What this reference is for."
              className={cn(PAPER_INPUT, "w-full resize-y py-2 leading-5")}
            />
          </Field>

          <div className="mt-auto flex flex-col gap-3 border-t border-paper-mist pt-6">
            {/* Stubbed deliberately: Hermes review is its own step, and a
                button that pretended to work would be worse than one that
                says what it is waiting for. */}
            <PaperButton variant="ghost" disabled title="Hermes visual review is not built yet">
              <PenLine className="size-3.5" aria-hidden="true" />
              Review with Hermes
            </PaperButton>
            <p className="text-[12.5px] text-paper-sage">Coming in a later step</p>

            {confirmingDelete ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <PaperButton variant="danger" onClick={onDelete}>
                  Delete for good
                </PaperButton>
                <PaperButton variant="quiet" onClick={() => setConfirmingDelete(false)}>
                  Keep
                </PaperButton>
              </div>
            ) : (
              <PaperButton variant="quiet" className="mt-3 self-start" onClick={() => setConfirmingDelete(true)}>
                <Trash2 className="size-3.5" aria-hidden="true" />
                Delete
              </PaperButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <div>{children}</div>
    </div>
  );
}

interface ChoiceRowProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}

function ChoiceRow({ options, value, onChange }: ChoiceRowProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const isSelected = option.value === value;

        return (
          <button
            key={option.value || "none"}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onChange(option.value)}
            className={cn(
              CHIP,
              isSelected ? CHIP_ON : CHIP_OFF,
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  active = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex size-9 cursor-pointer items-center justify-center rounded-[4px] transition-colors duration-150 hover:bg-paper-stone",
        PAPER_FOCUS,
        active ? "text-paper-amber-deep" : "text-paper-sage hover:text-paper-moss",
      )}
    >
      {children}
    </button>
  );
}
