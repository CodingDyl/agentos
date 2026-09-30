import { Check, Clapperboard, ImageOff } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { DesignAsset } from "@shared/agentos-types";
import {
  MOTION_FORMATS,
  MOTION_MAX_REFERENCES,
  type MotionEffort,
  type MotionFormat,
  type MotionJob,
  type MotionPromptSource,
  type MotionTemplate,
  type MotionTemplateId,
} from "@shared/motion-types";
import { AppShell } from "@/components/os";
import {
  FieldLabel,
  PAPER_FOCUS,
  PAPER_INPUT,
  PaperBackLink,
  PaperButton,
  PaperEmpty,
  PaperError,
  PaperLoading,
  PaperNotice,
  PaperPageHeader,
  PaperSection,
  PaperStage,
  SegmentedControl,
} from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { useDesignLibrary, useProjects } from "@/lib/agentos/queries";
import { useCreateMotionJob, useMotionJobs, useMotionStudio } from "@/lib/agentos/motion";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { sourceLabel } from "./designs-model";
import { MotionStatus, PromptBlock } from "./motion-status";

/**
 * The motion studio: write a brief, and Claude Code makes the film.
 *
 * The brief is built from the prompts in the vault's `motion_and_video` notes,
 * so the page says which note each part came from. Everything past the brief —
 * the review rounds, the render — happens on the film's own page.
 */

const LENGTHS = [
  { value: "10", label: "10s" },
  { value: "15", label: "15s" },
  { value: "20", label: "20s" },
  { value: "30", label: "30s" },
] as const;

const EFFORTS: readonly { value: MotionEffort; label: string }[] = [
  { value: "high", label: "High" },
  { value: "xhigh", label: "X-High" },
  { value: "max", label: "Max" },
];

/** A format drawn as its own shape, so the choice reads before the label does. */
const FORMAT_SHAPE: Record<MotionFormat, string> = { "9:16": "h-5 w-3", "1:1": "size-4", "16:9": "h-3 w-5" };
const FORMAT_NAME: Record<MotionFormat, string> = { "9:16": "Vertical", "1:1": "Square", "16:9": "Landscape" };

export function MotionPage() {
  const navigationItems = useNavigationItems();
  const [searchParams] = useSearchParams();
  const studio = useMotionStudio();
  const jobs = useMotionJobs();
  const { data: library } = useDesignLibrary();

  const assetsById = useMemo(() => new Map((library?.assets ?? []).map((asset) => [asset.id, asset])), [library]);

  return (
    <AppShell navigationItems={navigationItems} pageId="designs" activeHref="/designs" modelLabel="Model / Claude Code">
      <PaperStage>
        <PaperBackLink to="/designs">Creative</PaperBackLink>
        <PaperPageHeader
          className="mt-3"
          title="Motion"
          description="Claude Code writes the film, reviews one frame per beat until every score is 8 or better, then renders it into Creative. It runs on your Claude Code plan, one film at a time."
        />

        {studio.isPending ? (
          <PaperLoading className="mt-10" title="Motion" message="Reading the studio prompts from your vault…" />
        ) : !studio.data ? (
          <PaperError
            title="The motion studio could not be read."
            detail={studio.error?.message}
            onRetry={() => void studio.refetch()}
            isRetrying={studio.isFetching}
          />
        ) : (
          <div className="mt-10 grid gap-x-14 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
            <BriefComposer
              templates={studio.data.templates}
              rulesSource={studio.data.rules.source}
              rulesText={studio.data.rules.text}
              missing={studio.data.readiness.missing}
              initialProject={searchParams.get("project") ?? undefined}
              images={(library?.assets ?? []).filter((asset) => asset.mediaType !== "video")}
            />

            <PaperSection label="Films" count={jobs.data?.length}>
              {jobs.data && jobs.data.length > 0 ? (
                <ul className="divide-y divide-paper-mist border-y border-paper-mist">
                  {jobs.data.map((job) => (
                    <FilmRow key={job.id} job={job} poster={job.assetIds.map((id) => assetsById.get(id)).find(Boolean)} />
                  ))}
                </ul>
              ) : (
                <PaperEmpty
                  title="No films yet"
                  description="Your first brief lands here. You can leave the page while Claude works; the film keeps going."
                />
              )}
            </PaperSection>
          </div>
        )}
      </PaperStage>
    </AppShell>
  );
}

function FilmRow({ job, poster }: { job: MotionJob; poster?: DesignAsset }) {
  return (
    <li>
      <Link
        to={`/designs/motion/${job.id}`}
        className={cn("group flex cursor-pointer items-center gap-4 py-3 transition-colors duration-150 hover:bg-paper-linen", PAPER_FOCUS)}
      >
        <div className="grid h-16 w-12 shrink-0 place-items-center overflow-hidden bg-paper-stone">
          {poster ? (
            <img src={poster.thumbnailUrl} alt="" className="size-full object-cover" loading="lazy" />
          ) : (
            <Clapperboard className="size-4 text-paper-sage" strokeWidth={1.5} aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-paper-moss group-hover:text-paper-blue">{job.title}</p>
          <p className="mt-0.5 text-[12.5px] text-paper-sage tabular-nums">
            {job.request.durationSec}s · {job.request.formats.join(" + ")} · {formatRelativeTime(job.createdAt)}
          </p>
          <MotionStatus job={job} className="mt-1.5" />
        </div>
      </Link>
    </li>
  );
}

function BriefComposer({
  templates,
  rulesSource,
  rulesText,
  missing,
  initialProject,
  images,
}: {
  templates: MotionTemplate[];
  rulesSource: MotionPromptSource;
  rulesText: string;
  missing: string[];
  initialProject?: string;
  images: DesignAsset[];
}) {
  const navigate = useNavigate();
  const create = useCreateMotionJob();
  const { data: projectsData } = useProjects();
  const projects = projectsData?.projects ?? [];

  const [templateId, setTemplateId] = useState<MotionTemplateId>("showreel");
  const [product, setProduct] = useState("");
  const [url, setUrl] = useState("");
  const [metric, setMetric] = useState("");
  const [cta, setCta] = useState("");
  const [brief, setBrief] = useState("");
  const [length, setLength] = useState<(typeof LENGTHS)[number]["value"]>("15");
  const [formats, setFormats] = useState<MotionFormat[]>(["9:16"]);
  const [project, setProject] = useState(initialProject ?? "");
  const [references, setReferences] = useState<string[]>([]);
  const [effort, setEffort] = useState<MotionEffort>("max");

  const template = templates.find((entry) => entry.id === templateId)!;
  const custom = templateId === "custom";
  const brand = templateId === "brand";

  // Brand material from the film's own workspace first; everything when none is chosen.
  const candidates = useMemo(
    () => (project ? images.filter((asset) => asset.project === project) : images).slice(0, 48),
    [images, project],
  );

  const toggleFormat = (format: MotionFormat) =>
    setFormats((current) =>
      current.includes(format) ? (current.length > 1 ? current.filter((entry) => entry !== format) : current) : [...current, format],
    );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(
      {
        template: templateId,
        product: product.trim() || undefined,
        url: url.trim() || undefined,
        metric: brand ? metric.trim() || undefined : undefined,
        cta: brand ? cta.trim() || undefined : undefined,
        brief: brief.trim() || undefined,
        durationSec: Number(length),
        formats,
        project: project || undefined,
        referenceAssetIds: references,
        effort,
      },
      { onSuccess: (job) => navigate(`/designs/motion/${job.id}`) },
    );
  };

  const ready = missing.length === 0;
  const canSubmit = ready && !create.isPending && (custom ? brief.trim().length > 0 : product.trim().length > 0);

  return (
    <form onSubmit={submit} className="min-w-0" aria-label="Motion brief">
      <h2 className="font-paper-display text-[17px] leading-6 font-bold tracking-[-0.01em] text-paper-moss">New film</h2>

      <fieldset className="mt-4">
        <legend className="sr-only">Kind of film</legend>
        <div role="radiogroup" className="grid gap-px border border-paper-mist bg-paper-mist sm:grid-cols-3">
          {templates.map((entry) => {
            const selected = entry.id === templateId;
            return (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setTemplateId(entry.id)}
                className={cn(
                  "relative flex cursor-pointer flex-col items-start gap-1.5 p-4 text-left transition-colors duration-150",
                  PAPER_FOCUS,
                  selected ? "bg-paper-blue text-paper-white" : "bg-paper-white text-paper-moss hover:bg-paper-linen",
                )}
              >
                <span className="font-paper-display text-[15px] font-bold tracking-[-0.01em]">{entry.label}</span>
                <span className={cn("text-[12.5px] leading-[18px]", selected ? "text-paper-white/85" : "text-paper-sage")}>
                  {entry.description}
                </span>
                <span className={cn("mt-auto pt-1 font-paper-utility text-[11px] tracking-[0.08em] uppercase", selected ? "text-paper-white/70" : "text-paper-sage")}>
                  {entry.id === "custom" ? "Studio rules apply" : sourceLabel(entry.source)}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <label className="block">
          <FieldLabel>{custom ? "Title (optional)" : "Product or brand"}</FieldLabel>
          <input
            value={product}
            onChange={(event) => setProduct(event.target.value)}
            placeholder="Pantry Pilot"
            className={cn(PAPER_INPUT, "w-full")}
            required={!custom}
          />
        </label>
        <label className="block">
          <FieldLabel>Site (optional)</FieldLabel>
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            type="url"
            placeholder="https://"
            className={cn(PAPER_INPUT, "w-full")}
          />
        </label>

        {brand ? (
          <>
            <label className="block">
              <FieldLabel>The one number that proves it</FieldLabel>
              <input
                value={metric}
                onChange={(event) => setMetric(event.target.value)}
                placeholder="Leave empty rather than invent one"
                className={cn(PAPER_INPUT, "w-full")}
              />
            </label>
            <label className="block">
              <FieldLabel>Call to action</FieldLabel>
              <input value={cta} onChange={(event) => setCta(event.target.value)} placeholder="Become a tester" className={cn(PAPER_INPUT, "w-full")} />
            </label>
          </>
        ) : null}

        <label className="block sm:col-span-2">
          <FieldLabel>{custom ? "Brief" : "Direction (optional)"}</FieldLabel>
          <textarea
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            rows={custom ? 6 : 3}
            placeholder={custom ? "What the film is, who it is for, what has to be in it." : "Anything the template does not say: a mood, a scene to include, something to avoid."}
            className={cn(PAPER_INPUT, "w-full resize-y py-2 leading-6")}
            required={custom}
          />
        </label>
      </div>

      <div className="mt-8 flex flex-wrap items-start gap-x-10 gap-y-6">
        <div>
          <FieldLabel>Length</FieldLabel>
          <SegmentedControl label="Length" options={LENGTHS} value={length} onChange={setLength} />
        </div>

        <div>
          <FieldLabel>Formats · the first is the master</FieldLabel>
          <div className="flex gap-2" role="group" aria-label="Formats">
            {MOTION_FORMATS.map((format) => {
              const order = formats.indexOf(format);
              const on = order >= 0;
              return (
                <button
                  key={format}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleFormat(format)}
                  className={cn(
                    "inline-flex min-h-11 cursor-pointer items-center gap-2.5 border px-3 text-[13px] font-medium transition-colors duration-150",
                    PAPER_FOCUS,
                    on ? "border-paper-blue bg-paper-linen text-paper-moss" : "border-paper-mist text-paper-sage hover:border-paper-ash hover:text-paper-moss",
                  )}
                >
                  <span className="grid size-5 place-items-center" aria-hidden="true">
                    <span className={cn("block border-[1.5px]", FORMAT_SHAPE[format], on ? "border-paper-blue bg-paper-blue/15" : "border-current")} />
                  </span>
                  <span>
                    {FORMAT_NAME[format]} <span className="text-paper-sage tabular-nums">{format}</span>
                  </span>
                  {order === 0 && formats.length > 1 ? (
                    <span className="font-paper-utility text-[10.5px] tracking-[0.08em] text-paper-blue uppercase">Master</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <FieldLabel>Effort</FieldLabel>
          <SegmentedControl label="Effort" options={EFFORTS} value={effort} onChange={setEffort} />
        </div>
      </div>

      {projects.length > 0 ? (
        <label className="mt-8 block max-w-sm">
          <FieldLabel>Workspace (optional)</FieldLabel>
          <select
            value={project}
            onChange={(event) => {
              setProject(event.target.value);
              setReferences([]);
            }}
            className={cn(PAPER_INPUT, "w-full cursor-pointer")}
          >
            <option value="">No workspace</option>
            {projects.map((entry) => (
              <option key={entry.slug} value={entry.slug}>
                {entry.name}
              </option>
            ))}
          </select>
          <span className="mt-1.5 block text-[12.5px] leading-5 text-paper-sage">
            The workspace's own notes go into the brief, and the film is filed under it.
          </span>
        </label>
      ) : null}

      <div className="mt-8">
        <FieldLabel>
          Brand material · {references.length} of {MOTION_MAX_REFERENCES}
        </FieldLabel>
        {candidates.length > 0 ? (
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
            {candidates.map((asset) => {
              const on = references.includes(asset.id);
              return (
                <button
                  key={asset.id}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${on ? "Remove" : "Use"} ${asset.filename}`}
                  title={asset.filename}
                  onClick={() =>
                    setReferences((current) =>
                      on ? current.filter((id) => id !== asset.id) : current.length >= MOTION_MAX_REFERENCES ? current : [...current, asset.id],
                    )
                  }
                  className={cn(
                    "relative aspect-square cursor-pointer overflow-hidden bg-paper-linen ring-1 transition-[box-shadow] duration-150",
                    PAPER_FOCUS,
                    on ? "ring-2 ring-paper-blue" : "ring-paper-mist hover:ring-paper-sage",
                  )}
                >
                  <img src={asset.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover" />
                  {on ? (
                    <span className="absolute top-1 right-1 grid size-4 place-items-center bg-paper-blue text-paper-white" aria-hidden="true">
                      <Check className="size-3" strokeWidth={2.5} />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="flex items-center gap-2 text-[13px] text-paper-sage">
            <ImageOff className="size-3.5" aria-hidden="true" />
            {project ? "This workspace has no images in Creative yet. Claude will find the brand itself." : "No images in Creative yet. Claude will find the brand itself."}
          </p>
        )}
      </div>

      <details className="group mt-8 border-t border-paper-mist pt-4">
        <summary className={cn("cursor-pointer text-[13px] font-medium text-paper-char marker:text-paper-sage hover:text-paper-moss", PAPER_FOCUS)}>
          What Claude is told
        </summary>
        <div className="mt-4 space-y-5">
          {!custom ? (
            <PromptBlock label={`${template.label} · ${sourceLabel(template.source)}`} text={template.text} />
          ) : null}
          <PromptBlock label={`Studio rules · ${sourceLabel(rulesSource)}`} text={rulesText} />
          <p className="text-[12.5px] leading-5 text-paper-sage">
            AgentOS adds where to save each round's contact sheet and scores, where finished films go, and that no metric or testimonial may be invented.
            Edit the notes in Obsidian to change the next film.
          </p>
        </div>
      </details>

      {!ready ? (
        <PaperNotice className="mt-8">
          Films can't be made on this machine yet. {missing.join(" ")}
        </PaperNotice>
      ) : null}

      {create.isError ? (
        <p role="alert" className="mt-6 text-[13.5px] leading-5 text-paper-flame-deep">
          {create.error instanceof Error ? create.error.message : "The film could not be started."}
        </p>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <PaperButton type="submit" variant="amber" disabled={!canSubmit} className="min-h-11 px-5">
          <Clapperboard className="size-3.5" aria-hidden="true" />
          {create.isPending ? "Setting up the studio…" : "Make the film"}
        </PaperButton>
        <span className="text-[12.5px] leading-5 text-paper-sage">Usually 20 to 40 minutes. You can leave this page.</span>
      </div>
    </form>
  );
}
