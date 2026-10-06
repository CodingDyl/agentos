import { useId, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ImagePlus, Plus, Trash2 } from "lucide-react";
import { BrandColorRoleSchema, type BrandColor, type BrandFont, type BrandKit, type RebuildRun } from "@shared/website-rebuild-types";
import { FieldLabel, PAPER_INPUT, PaperButton } from "@/components/paper";
import { useUpdateBrandKit, useUploadBrandAsset } from "@/lib/agentos/rebuilds";
import { cn } from "@/lib/utils";

/**
 * The client's branding as capture found it: tick off what the new site
 * should use, put the right logo first, add files the site didn't have, and
 * correct the colours and fonts. The next hero or build revision uses it.
 */

type EditableColor = Pick<BrandColor, "hex" | "role">;
const COLOR_ROLES = BrandColorRoleSchema.options;
const FONT_ROLES: BrandFont["role"][] = ["body", "heading"];

interface Draft {
  order: { id: string; include: boolean }[];
  colors: EditableColor[];
  fonts: BrandFont[];
}

const draftOf = (kit: BrandKit): Draft => ({
  order: kit.assets.map((asset) => ({ id: asset.id, include: asset.include })),
  colors: kit.colors.map(({ hex, role }) => ({ hex, role })),
  fonts: kit.fonts.map((font) => ({ ...font })),
});

export function BrandKitPanel({ run }: { run: RebuildRun }) {
  const id = useId();
  const kit = run.brandKit;
  const save = useUpdateBrandKit(run.id);
  const upload = useUploadBrandAsset(run.id);
  // The server's kit until someone edits; then their copy, until it is saved or discarded.
  const [editing, setEditing] = useState<Draft | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  if (!kit) return null;
  const draft = editing ?? draftOf(kit);
  const dirty = editing !== null;
  const change = (next: Draft) => setEditing(next);
  const assets = draft.order.map((entry) => ({ ...entry, asset: kit.assets.find((asset) => asset.id === entry.id) })).filter((entry) => entry.asset);
  const href = (artifactId: string) => run.artifacts.find((artifact) => artifact.id === artifactId)?.href;
  const heroStarted = run.stages.some((stage) => stage.id === "hero" && stage.revision > 0);

  const move = (index: number, by: -1 | 1) => {
    const order = [...draft.order];
    const target = index + by;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    change({ ...draft, order });
  };

  const send = (file: File | undefined, kind: "logo" | "photo") => {
    if (!file) return;
    // Unsaved edits would be lost when the upload refreshes the kit, so save them with it.
    const uploadFile = () => upload.mutate({ file, kind }, { onSuccess: () => setEditing(null) });
    if (dirty) save.mutate({ assets: draft.order, colors: draft.colors, fonts: draft.fonts.filter((font) => font.family.trim()) }, { onSuccess: uploadFile });
    else uploadFile();
  };

  const error = save.error ?? upload.error;
  const included = draft.order.filter((entry) => entry.include).length;

  return (
    <section className="mt-4 border-t border-paper-mist pt-4" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`${id}-title`} className="text-[14px] font-semibold text-paper-moss">
          Brand kit
        </h3>
        <p className="text-[12px] text-paper-sage">
          {included} of {draft.order.length} images used{kit.source === "edited" ? " · edited" : ""}
        </p>
      </div>
      <p className="mt-1 max-w-[80ch] text-[12.5px] leading-5 text-paper-sage">
        Taken from their current site. The first ticked logo is the main one. {heroStarted ? "Changes apply from the next hero or build revision." : "The hero concepts will use what is ticked here."} Photos may be licensed to the client only: check before the preview is shared widely.
      </p>

      {assets.length === 0 ? (
        <p className="mt-3 text-[13px] text-paper-sage">No usable logo or photos were found. Add the client's logo if you have it.</p>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Brand images">
          {assets.map(({ asset, include }, index) =>
            asset ? (
              <li key={asset.id} className={cn("border-[1.5px] p-2", include ? "border-paper-blue bg-paper-white" : "border-paper-mist opacity-60")}>
                <div className="flex aspect-[4/3] items-center justify-center bg-paper-linen">
                  {href(asset.artifactId) ? (
                    <img src={href(asset.artifactId)} alt={asset.alt || `${asset.kind} ${asset.id}`} className="max-h-full max-w-full object-contain" loading="lazy" />
                  ) : (
                    <span className="text-[12px] text-paper-sage">No preview</span>
                  )}
                </div>
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12.5px] text-paper-char">
                  <input
                    type="checkbox"
                    checked={include}
                    onChange={(event) => change({ ...draft, order: draft.order.map((entry) => (entry.id === asset.id ? { ...entry, include: event.target.checked } : entry)) })}
                  />
                  <span className="font-semibold capitalize">{asset.kind}</span>
                  <span className="truncate text-paper-sage">{asset.sourceUrl === "uploaded" ? "uploaded" : asset.width && asset.height ? `${asset.width}×${asset.height}` : ""}</span>
                </label>
                <div className="mt-1 flex gap-1">
                  <button type="button" className="p-1 text-paper-sage hover:text-paper-moss disabled:opacity-30" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${asset.id} earlier`}>
                    <ArrowLeft className="size-3.5" aria-hidden="true" />
                  </button>
                  <button type="button" className="p-1 text-paper-sage hover:text-paper-moss disabled:opacity-30" onClick={() => move(index, 1)} disabled={index === assets.length - 1} aria-label={`Move ${asset.id} later`}>
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ) : null,
          )}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml,image/x-icon,.svg,.ico" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => { send(event.target.files?.[0], "logo"); event.target.value = ""; }} />
        <input ref={photoInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => { send(event.target.files?.[0], "photo"); event.target.value = ""; }} />
        <PaperButton onClick={() => logoInput.current?.click()} disabled={upload.isPending}>
          <ImagePlus className="size-3.5" aria-hidden="true" /> {upload.isPending ? "Uploading…" : "Add a logo"}
        </PaperButton>
        <PaperButton onClick={() => photoInput.current?.click()} disabled={upload.isPending}>
          <ImagePlus className="size-3.5" aria-hidden="true" /> Add a photo
        </PaperButton>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <fieldset>
          <legend>
            <FieldLabel>Colours</FieldLabel>
          </legend>
          <ul className="mt-1 grid gap-2">
            {draft.colors.map((color, index) => (
              <li key={index} className="flex flex-wrap items-center gap-2">
                <input
                  type="color"
                  value={color.hex}
                  aria-label={`Colour ${index + 1}`}
                  className="h-8 w-10 cursor-pointer border border-paper-mist bg-transparent"
                  onChange={(event) => change({ ...draft, colors: draft.colors.map((entry, at) => (at === index ? { ...entry, hex: event.target.value.toLowerCase() } : entry)) })}
                />
                <code className="w-[7ch] text-[12.5px] text-paper-char">{color.hex}</code>
                <select
                  className={cn(PAPER_INPUT, "w-auto")}
                  value={color.role}
                  aria-label={`What colour ${index + 1} is for`}
                  onChange={(event) => change({ ...draft, colors: draft.colors.map((entry, at) => (at === index ? { ...entry, role: event.target.value as BrandColor["role"] } : entry)) })}
                >
                  {COLOR_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
                <button type="button" className="p-1 text-paper-sage hover:text-paper-flame" onClick={() => change({ ...draft, colors: draft.colors.filter((_, at) => at !== index) })} aria-label={`Remove colour ${color.hex}`}>
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          {draft.colors.length < 12 ? (
            <PaperButton className="mt-2" onClick={() => change({ ...draft, colors: [...draft.colors, { hex: "#000000", role: "accent" }] })}>
              <Plus className="size-3.5" aria-hidden="true" /> Add a colour
            </PaperButton>
          ) : null}
        </fieldset>

        <fieldset>
          <legend>
            <FieldLabel>Fonts</FieldLabel>
          </legend>
          <ul className="mt-1 grid gap-2">
            {draft.fonts.map((font, index) => (
              <li key={index} className="flex flex-wrap items-center gap-2">
                <input
                  className={cn(PAPER_INPUT, "w-48")}
                  value={font.family}
                  maxLength={60}
                  aria-label={`Font ${index + 1}`}
                  onChange={(event) => change({ ...draft, fonts: draft.fonts.map((entry, at) => (at === index ? { ...entry, family: event.target.value } : entry)) })}
                />
                <select
                  className={cn(PAPER_INPUT, "w-auto")}
                  value={font.role}
                  aria-label={`What font ${index + 1} is for`}
                  onChange={(event) => change({ ...draft, fonts: draft.fonts.map((entry, at) => (at === index ? { ...entry, role: event.target.value as BrandFont["role"] } : entry)) })}
                >
                  {FONT_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
                <button type="button" className="p-1 text-paper-sage hover:text-paper-flame" onClick={() => change({ ...draft, fonts: draft.fonts.filter((_, at) => at !== index) })} aria-label={`Remove font ${font.family}`}>
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          {draft.fonts.length < 6 ? (
            <PaperButton className="mt-2" onClick={() => change({ ...draft, fonts: [...draft.fonts, { family: "", role: "heading" }] })}>
              <Plus className="size-3.5" aria-hidden="true" /> Add a font
            </PaperButton>
          ) : null}
        </fieldset>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-[12.5px] text-paper-flame-deep">
          {error.message}
        </p>
      ) : null}
      {dirty ? (
        <div className="mt-3 flex flex-wrap gap-3">
          <PaperButton
            variant="amber"
            disabled={save.isPending}
            onClick={() => save.mutate({ assets: draft.order, colors: draft.colors, fonts: draft.fonts.filter((font) => font.family.trim()) }, { onSuccess: () => setEditing(null) })}
          >
            {save.isPending ? "Saving…" : "Save brand kit"}
          </PaperButton>
          <PaperButton
            disabled={save.isPending}
            onClick={() => setEditing(null)}
          >
            Discard changes
          </PaperButton>
        </div>
      ) : null}
    </section>
  );
}
