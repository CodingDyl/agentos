import { useState } from "react";
import { X } from "lucide-react";
import type {
  AspectRatio,
  DesignGeneration,
} from "@shared/design-generation-types";
import { MAX_REFERENCE_IMAGES, MAX_VARIATIONS } from "@shared/design-generation-types";
import type { DesignAsset } from "@shared/agentos-types";
import {
  FieldLabel,
  PAPER_FOCUS,
  PAPER_INPUT,
  PaperButton,
  PaperCard,
  PaperFilterBar,
  Tag,
} from "@/components/paper";
import {
  useDesignLibrary,
  useGenerateDesigns,
  useGenerationCapability,
  useGenerationCost,
  useHiggsfieldAccount,
  useHiggsfieldModels,
  useProjects,
} from "@/lib/agentos/queries";
import { cn } from "@/lib/utils";
import { GenerateReferencePicker } from "./generate-reference-picker";

/**
 * Making concepts from a direction.
 *
 * The panel deliberately does two things a bare prompt box does not. It shows
 * what a click will cost before the click, because each variation is a
 * separate paid job and four of them is not four times as useful as one. And
 * it says who wrote the prompt that was rendered — the operator's sentence and
 * Hermes' reading of it are different things, and only one of them explains
 * the picture that comes back.
 */

const RATIOS: AspectRatio[] = ["1:1", "4:3", "16:9", "9:16"];

/** What one render costs, so the count means something before it is spent. */

export interface GeneratePanelProps {
  /** References chosen from the library, when any were. */
  references: DesignAsset[];
  onClose: () => void;
  onGenerated?: (generation: DesignGeneration) => void;
  /** Pre-fills the prompt, e.g. when regenerating from an existing concept. */
  initialPrompt?: string;
  className?: string;
}

export function GeneratePanel({
  references,
  onClose,
  onGenerated,
  initialPrompt,
  className,
}: GeneratePanelProps) {
  const { data: capability } = useGenerationCapability();
  const { data: projectsData } = useProjects();
  const projects = projectsData?.projects ?? [];

  const generate = useGenerateDesigns();

  // Unassigned by default. Not every image belongs to a project, and a
  // composer that silently attributed a loose experiment to whichever project
  // happened to sort first was filing work under the wrong name.
  const [project, setProject] = useState("");
  const [product, setProduct] = useState("");
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [ratio, setRatio] = useState<AspectRatio>("9:16");
  const [count, setCount] = useState(1);
  const [refine, setRefine] = useState(true);
  const [generation, setGeneration] = useState<DesignGeneration>();
  // Starts from what was selected in the library; changed here from then on.
  // Videos never go to an image model as a reference.
  const [chosenReferences, setChosenReferences] = useState<DesignAsset[]>(() =>
    references.filter((asset) => asset.mediaType === "image").slice(0, MAX_REFERENCE_IMAGES),
  );

  // Products already used in this project, offered as suggestions rather than
  // as a fixed list: what counts as a product is the operator's business.
  const { data: library } = useDesignLibrary();
  const knownProducts = [
    ...new Set(
      (library?.assets ?? [])
        .filter((asset) => !project || asset.project === project)
        .map((asset) => asset.product)
        .filter((entry): entry is string => !!entry),
    ),
  ].sort();

  const account = useHiggsfieldAccount();
  const { data: models } = useHiggsfieldModels();
  const [model, setModel] = useState("");

  const chosenModel = model || capability?.generation.model || "gpt_image_2_5";

  // Priced by Higgsfield, not by a constant: the same count costs a different
  // number of credits on a different model, and the button should say which.
  const cost = useGenerationCost({
    model: chosenModel,
    prompt,
    count,
    enabled: capability?.generation.available === true,
  });

  const available = capability?.generation.available === true;

  const submit = () => {
    if (generate.isPending || prompt.trim().length === 0) return;

    generate.mutate(
      {
        project: project || undefined,
        product: product.trim() || undefined,
        model: chosenModel,
        prompt: prompt.trim(),
        referenceAssetIds: chosenReferences.map((asset) => asset.id),
        aspectRatio: ratio,
        count,
        refinePrompt: refine,
      },
      {
        onSuccess: (result) => {
          setGeneration(result);
          onGenerated?.(result);
        },
      },
    );
  };

  const failure =
    generate.error instanceof Error ? generate.error.message : undefined;

  return (
    <PaperCard className={cn("p-5", className)}>
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="font-paper-display text-[17px] font-bold tracking-[-0.01em] text-paper-moss">Generate visual</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close generate"
            className={cn("rounded-none p-1 text-paper-sage transition-colors hover:bg-paper-stone hover:text-paper-moss", PAPER_FOCUS)}
          >
            <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        {/* Said before anything is attempted, for the same reason the visual
            review says it: a button that starts a job which cannot run is
            worse than one that explains itself. */}
        {!available ? (
          <div className="mt-5 border-t border-paper-mist pt-5">
            <Tag tone="flame">Generation unavailable</Tag>
            <p className="mt-3 max-w-[62ch] text-[13.5px] leading-5 text-paper-char">
              {capability?.generation.reason ??
                "Concepts cannot be rendered on this machine."}
            </p>
          </div>
        ) : (
          <>
            {projects.length > 0 ? (
              <div className="mt-6 flex flex-wrap items-start gap-x-8 gap-y-5">
                <div>
                  <FieldLabel>Workspace</FieldLabel>
                  <PaperFilterBar<string>
                    label="Choose a workspace"
                    value={project}
                    onChange={(next) => {
                      setProject(next);
                      if (!next) setProduct("");
                    }}
                    // `No project` first and selected by default: an image
                    // made to think with does not have to belong to anything.
                    options={[
                      { value: "", label: "No workspace" },
                      ...projects.map((entry) => ({ value: entry.slug, label: entry.name })),
                    ]}
                  />
                </div>

                {/* Only meaningful inside a project: `chef` on its own says
                    nothing about which product's Chef. */}
                {project ? (
                  <label className="block">
                    <FieldLabel>Product</FieldLabel>
                    <input
                      value={product}
                      onChange={(event) => setProduct(event.target.value)}
                      placeholder="chef"
                      list="creative-products"
                      className={cn(PAPER_INPUT, "w-40")}
                    />
                    <datalist id="creative-products">
                      {knownProducts.map((entry) => (
                        <option key={entry} value={entry} />
                      ))}
                    </datalist>
                  </label>
                ) : null}
              </div>
            ) : null}

            <label className="mt-6 block">
              <FieldLabel>Prompt</FieldLabel>
              <textarea
                autoFocus
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={3}
                placeholder="Explore a warmer, more conversational AI Chef screen"
                className={cn(PAPER_INPUT, "w-full resize-y py-2.5 leading-6")}
              />
            </label>

            {/* What the operator typed and what gets rendered are different
                things when this is on, so it is stated rather than implied. */}
            <label className="mt-3 flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={refine && project.length > 0}
                disabled={project.length === 0}
                onChange={(event) => setRefine(event.target.checked)}
                className={cn("mt-0.5 size-3.5 accent-[var(--paper-blue)]", PAPER_FOCUS)}
              />
              <span className="text-[13px] leading-5 text-paper-char">
                {project
                  ? "Let Hermes rewrite this using the project's own context"
                  : "Hermes rewrites prompts from a project's context. Choose a project to use it"}
              </span>
            </label>

            <GenerateReferencePicker
              references={chosenReferences}
              onChange={setChosenReferences}
              project={project}
            />

            <div className="mt-6 flex flex-wrap gap-x-8 gap-y-6">
              <div>
                <FieldLabel>Aspect ratio</FieldLabel>
                <PaperFilterBar<AspectRatio>
                  label="Choose an aspect ratio"
                  value={ratio}
                  onChange={setRatio}
                  options={RATIOS.map((entry) => ({
                    value: entry,
                    label: entry,
                  }))}
                />
              </div>

              <div>
                <FieldLabel>Variations</FieldLabel>
                <PaperFilterBar<string>
                  label="How many variations"
                  value={String(count)}
                  onChange={(value) => setCount(Number(value))}
                  options={Array.from({ length: MAX_VARIATIONS }, (_, index) => ({
                    value: String(index + 1),
                    label: String(index + 1),
                  }))}
                />
              </div>

              {models && models.length > 0 ? (
                <label className="block">
                  <FieldLabel>Model</FieldLabel>
                  <select
                    value={chosenModel}
                    onChange={(event) => setModel(event.target.value)}
                    className={cn(PAPER_INPUT, "w-56")}
                  >
                    <optgroup label="Image">
                      {models.filter((entry) => entry.kind === "image").map((entry) => (
                        <option key={entry.id} value={entry.id}>{entry.name}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Video">
                      {models.filter((entry) => entry.kind === "video").map((entry) => (
                        <option key={entry.id} value={entry.id}>{entry.name}</option>
                      ))}
                    </optgroup>
                  </select>
                </label>
              ) : null}
            </div>

            {/* The number that stops a click being a surprise — and it is the
                number Higgsfield will actually charge, asked for this model
                and this many variations, not a constant that was once close. */}
            <p className="mt-4 text-[13px] text-paper-sage">
              {cost.data?.unavailable
                ? cost.data.unavailable
                : cost.data
                  ? `${cost.data.total} credit${cost.data.total === 1 ? "" : "s"}: ${cost.data.perJob} per variation, each its own job`
                  : "Pricing this generation…"}
              {account.data?.credits !== undefined ? (
                <span className={account.data.credits < (cost.data?.total ?? 0) ? "font-medium text-paper-flame-deep" : undefined}>
                  {" · "}
                  {account.data.credits} remaining
                </span>
              ) : null}
            </p>

            <div className="mt-5">
              <PaperButton
                variant="amber"
                onClick={submit}
                disabled={prompt.trim().length === 0 || generate.isPending}
              >
                {generate.isPending ? "Generating…" : "Generate"}
              </PaperButton>
            </div>
          </>
        )}

        {generation ? (
          <GenerationResult className="mt-6" generation={generation} />
        ) : null}

        {failure ? (
          <p role="alert" className="mt-5 text-[13.5px] leading-5 text-paper-flame-deep">{failure}</p>
        ) : null}
      </div>
    </PaperCard>
  );
}

/**
 * What one generation produced.
 *
 * A failed generation is shown as fully as a successful one. The reason a
 * render was refused — a plan, a session, a model — is the actionable part,
 * and hiding it behind a toast would make the same failure a mystery twice.
 */
export function GenerationResult({
  generation,
  className,
}: {
  generation: DesignGeneration;
  className?: string;
}) {
  const failed = generation.status === "failed";

  return (
    <div className={cn("border-t border-paper-mist pt-5", className)}>
      <div className="flex flex-wrap items-center gap-3">
        <Tag tone={failed ? "flame" : "green"}>
          {failed
            ? "Generation failed"
            : `${generation.results.length} result${
                generation.results.length === 1 ? "" : "s"
              }`}
        </Tag>
        {generation.promptBy ? (
          <span className="text-[13px] text-paper-sage">
            Prompt by {generation.promptBy}
          </span>
        ) : null}
      </div>

      {generation.error ? (
        <p className="mt-3 max-w-[62ch] text-[13.5px] leading-5 text-paper-char">
          {generation.error}
        </p>
      ) : null}

      {/* The rendered prompt, not the typed one. When Hermes rewrote it, this
          is the only record of what actually made the picture. */}
      {generation.finalPrompt &&
      generation.finalPrompt !== generation.request.prompt ? (
        <div className="mt-4">
          <h3 className="text-[13px] font-semibold text-paper-moss">Rendered prompt</h3>
          <p className="mt-1.5 max-w-[62ch] text-[13.5px] leading-5 text-paper-char">
            {generation.finalPrompt}
          </p>
        </div>
      ) : null}
    </div>
  );
}
