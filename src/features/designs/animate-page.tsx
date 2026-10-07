import { Check, Clapperboard, ImageOff, Sparkles } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ANIMATE_STAGE_LABEL, type AnimateJob, type AnimateSkillState, type AnimateStyle } from "@shared/animate-types";
import type { DesignAsset } from "@shared/agentos-types";
import { MOTION_FORMATS, MOTION_MAX_REFERENCES, type MotionFormat } from "@shared/motion-types";
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
import { useAnimateJobs, useAnimateStudio, useCreateAnimateJob } from "@/lib/agentos/animate";
import { useDesignLibrary, useProjects } from "@/lib/agentos/queries";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AnimateStatus } from "./animate-status";

/**
 * Claude Motion: the Animate skill, from Creative.
 *
 * The page is Animate's intake — what the video is about, the look, the
 * length — in place of the questions the skill would ask in a chat. Everything
 * after it (story, look, storyboard, build) happens on the video's own page,
 * with a review gate at each of the first three.
 */

const LENGTHS = [
  { value: "15", label: "15s" },
  { value: "20", label: "20s" },
  { value: "30", label: "30s" },
  { value: "45", label: "45s" },
] as const;

const FORMAT_SHAPE: Record<MotionFormat, string> = { "9:16": "h-5 w-3", "1:1": "size-4", "16:9": "h-3 w-5" };
const FORMAT_NAME: Record<MotionFormat, string> = { "9:16": "Vertical", "1:1": "Square", "16:9": "Landscape" };

/** The steps Animate takes, in order, with the three a person signs off on. */
const FLOW = [
  { label: "Intake", gate: false, note: "This page" },
  { label: ANIMATE_STAGE_LABEL.story, gate: true, note: "Idea and beats" },
  { label: ANIMATE_STAGE_LABEL.look, gate: true, note: "2 to 4 style frames" },
  { label: ANIMATE_STAGE_LABEL.storyboard, gate: true, note: "Every beat, with sound" },
  { label: "Build", gate: false, note: "Animate, score, render" },
  { label: "Delivery", gate: false, note: "Video and measured checks" },
] as const;

export function AnimatePage() {
  const navigationItems = useNavigationItems();
  const [searchParams] = useSearchParams();
  const studio = useAnimateStudio();
  const jobs = useAnimateJobs();
  const { data: library } = useDesignLibrary();
  const assetsById = useMemo(() => new Map((library?.assets ?? []).map((asset) => [asset.id, asset])), [library]);

  return (
    <AppShell navigationItems={navigationItems} pageId="designs" activeHref="/designs" modelLabel="Model / Claude Code">
      <PaperStage>
        <PaperBackLink to="/designs">Creative</PaperBackLink>
        <PaperPageHeader
          className="mt-3"
          title="Claude Motion"
          description="Storyboard, build, deliver. Claude Code runs the Animate skill: you approve the story, the look and the storyboard here, then it builds the video and files it in Creative."
        />

        <FlowStrip />

        {studio.isPending ? (
          <PaperLoading className="mt-10" title="Claude Motion" message="Looking for the Animate skill…" />
        ) : !studio.data ? (
          <PaperError title="Claude Motion could not be read." detail={studio.error?.message} onRetry={() => void studio.refetch()} isRetrying={studio.isFetching} />
        ) : (
          <div className="mt-10 grid gap-x-14 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
            {studio.data.skill.state === "ready" ? (
              <Intake
                styles={studio.data.styles}
                missing={studio.data.missing}
                initialProject={searchParams.get("project") ?? undefined}
                images={(library?.assets ?? []).filter((asset) => asset.mediaType !== "video")}
              />
            ) : (
              <SkillMissing skill={studio.data.skill} />
            )}

            <PaperSection label="Videos" count={jobs.data?.length}>
              {jobs.data && jobs.data.length > 0 ? (
                <ul className="divide-y divide-paper-mist border-y border-paper-mist">
                  {jobs.data.map((job) => (
                    <VideoRow key={job.id} job={job} poster={job.assetIds.map((id) => assetsById.get(id)).find(Boolean)} />
                  ))}
                </ul>
              ) : (
                <PaperEmpty title="No videos yet" description="Your first intake lands here. Claude stops at each review gate and waits for you, so you can leave and come back." />
              )}
            </PaperSection>
          </div>
        )}
      </PaperStage>
    </AppShell>
  );
}

function FlowStrip() {
  return (
    <ol aria-label="How Claude Motion works" className="mt-8 grid grid-cols-2 gap-px border border-paper-mist bg-paper-mist sm:grid-cols-3 lg:grid-cols-6">
      {FLOW.map((step, index) => (
        <li key={step.label} className="bg-paper-white px-3 py-2.5">
          <p className="font-paper-utility text-[11.5px] tracking-[0.08em] text-paper-sage uppercase tabular-nums">
            {String(index + 1).padStart(2, "0")}
            {step.gate ? <span className="text-paper-blue"> · You review</span> : null}
          </p>
          <p className="mt-0.5 text-[13.5px] font-semibold text-paper-moss">{step.label}</p>
          <p className="text-[12px] leading-4 text-paper-sage">{step.note}</p>
        </li>
      ))}
    </ol>
  );
}

/** Animate isn't ready: say which of the four states it is in, and the one thing to do. */
function SkillMissing({ skill }: { skill: Exclude<AnimateSkillState, { state: "ready" }> }) {
  const content = {
    missing: {
      title: "Animate isn't installed",
      description: (
        <>
          Claude Motion runs the Animate skill. Install it from Skills: choose <span className="font-mono text-[12.5px]">Install from GitHub</span> and paste{" "}
          <span className="font-mono text-[12.5px]">cth9191/animate</span>.
        </>
      ),
      cta: "Install Animate from Skills",
    },
    disabled: {
      title: "Animate is switched off",
      description: `${"name" in skill ? skill.name : "Animate"} is installed but disabled, so agents can't use it. Turn it on in Skills.`,
      cta: "Turn on Animate in Skills",
    },
    broken: {
      title: "Animate has problems",
      description: "errors" in skill ? skill.errors.join(" ") : "",
      cta: "Open Skills",
    },
  }[skill.state];

  return (
    <div className="min-w-0">
      <PaperEmpty
        title={content.title}
        description={content.description}
        action={
          <Link
            to="/connectors"
            className={cn("inline-flex min-h-11 cursor-pointer items-center gap-2 bg-primary px-5 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-[var(--color-accent-hover)]", PAPER_FOCUS)}
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
            {content.cta}
          </Link>
        }
      />
    </div>
  );
}

function VideoRow({ job, poster }: { job: AnimateJob; poster?: DesignAsset }) {
  return (
    <li>
      <Link to={`/designs/animate/${job.id}`} className={cn("group flex cursor-pointer items-center gap-4 py-3 transition-colors duration-150 hover:bg-paper-linen", PAPER_FOCUS)}>
        <div className="grid h-16 w-12 shrink-0 place-items-center overflow-hidden bg-paper-stone">
          {poster ? <img src={poster.thumbnailUrl} alt="" className="size-full object-cover" loading="lazy" /> : <Clapperboard className="size-4 text-paper-sage" strokeWidth={1.5} aria-hidden="true" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-paper-moss group-hover:text-paper-blue">{job.title}</p>
          <p className="mt-0.5 text-[12.5px] text-paper-sage tabular-nums">
            {job.request.durationSec}s · {job.request.formats.join(" + ")} · {formatRelativeTime(job.createdAt)}
          </p>
          <AnimateStatus job={job} className="mt-1.5" />
        </div>
      </Link>
    </li>
  );
}

function Intake({ styles, missing, initialProject, images }: { styles: AnimateStyle[]; missing: string[]; initialProject?: string; images: DesignAsset[] }) {
  const navigate = useNavigate();
  const create = useCreateAnimateJob();
  const { data: projectsData } = useProjects();
  const projects = projectsData?.projects ?? [];

  const [topic, setTopic] = useState("");
  const [brief, setBrief] = useState("");
  const [style, setStyle] = useState("");
  const [length, setLength] = useState<(typeof LENGTHS)[number]["value"]>("20");
  const [formats, setFormats] = useState<MotionFormat[]>(["9:16"]);
  const [project, setProject] = useState(initialProject ?? "");
  const [references, setReferences] = useState<string[]>([]);

  const candidates = useMemo(() => (project ? images.filter((asset) => asset.project === project) : images).slice(0, 48), [images, project]);
  const toggleFormat = (format: MotionFormat) =>
    setFormats((current) => (current.includes(format) ? (current.length > 1 ? current.filter((entry) => entry !== format) : current) : [...current, format]));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(
      {
        topic: topic.trim(),
        brief: brief.trim() || undefined,
        style: style || undefined,
        durationSec: Number(length),
        formats,
        project: project || undefined,
        referenceAssetIds: references,
      },
      { onSuccess: (job) => navigate(`/designs/animate/${job.id}`) },
    );
  };

  const ready = missing.length === 0;
  const canSubmit = ready && !create.isPending && topic.trim().length > 0;

  return (
    <form onSubmit={submit} className="min-w-0" aria-label="Claude Motion intake">
      <h2 className="font-paper-display text-[17px] leading-6 font-bold tracking-[-0.01em] text-paper-moss">New video</h2>

      <div className="mt-4 grid gap-5">
        <label className="block">
          <FieldLabel>What is it about?</FieldLabel>
          <input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="How a bill becomes a law" className={cn(PAPER_INPUT, "w-full")} required maxLength={240} />
        </label>
        <label className="block">
          <FieldLabel>Anything Animate should know (optional)</FieldLabel>
          <textarea
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            rows={3}
            placeholder="Who it's for, the tone, facts that must be in it, things to avoid."
            className={cn(PAPER_INPUT, "w-full resize-y py-2 leading-6")}
          />
        </label>
      </div>

      <fieldset className="mt-8">
        <legend className="mb-1.5 block text-[12.5px] font-medium text-paper-char">Look</legend>
        <div role="radiogroup" aria-label="Look" className="grid grid-cols-2 gap-px border border-paper-mist bg-paper-mist sm:grid-cols-3">
          <StyleChoice selected={style === ""} onSelect={() => setStyle("")} name="Let Claude choose" blurb="It picks the style that fits the story, and says why at the story check." />
          {styles.map((entry) => (
            <StyleChoice key={entry.id} selected={style === entry.id} onSelect={() => setStyle(entry.id)} name={entry.name} blurb={entry.blurb} sampleUrl={entry.sampleUrl} />
          ))}
        </div>
      </fieldset>

      <div className="mt-8 flex flex-wrap items-start gap-x-10 gap-y-6">
        <div>
          <FieldLabel>Length</FieldLabel>
          <SegmentedControl label="Length" options={LENGTHS} value={length} onChange={setLength} />
        </div>
        <div>
          <FieldLabel>Formats · the first is the master</FieldLabel>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Formats">
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
                  {order === 0 && formats.length > 1 ? <span className="font-paper-utility text-[12px] tracking-[0.08em] text-paper-blue uppercase">Master</span> : null}
                </button>
              );
            })}
          </div>
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
          <span className="mt-1.5 block text-[12.5px] leading-5 text-paper-sage">The workspace's notes go into the brief, and the video is filed under it.</span>
        </label>
      ) : null}

      <div className="mt-8">
        <FieldLabel>
          Reference images · {references.length} of {MOTION_MAX_REFERENCES}
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
                  onClick={() => setReferences((current) => (on ? current.filter((id) => id !== asset.id) : current.length >= MOTION_MAX_REFERENCES ? current : [...current, asset.id]))}
                  className={cn("relative aspect-square cursor-pointer overflow-hidden bg-paper-linen ring-1 transition-[box-shadow] duration-150", PAPER_FOCUS, on ? "ring-2 ring-paper-blue" : "ring-paper-mist hover:ring-paper-sage")}
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
            No images in Creative yet. Animate will draw everything itself.
          </p>
        )}
        <span className="mt-1.5 block text-[12.5px] leading-5 text-paper-sage">Screenshots and logos Animate may use, or a look for it to match.</span>
      </div>

      {!ready ? <PaperNotice className="mt-8">Videos can't be made on this machine yet. {missing.join(" ")}</PaperNotice> : null}

      {create.isError ? (
        <p role="alert" className="mt-6 text-[13.5px] leading-5 text-paper-flame-deep">
          {create.error instanceof Error ? create.error.message : "Claude Motion could not be started."}
        </p>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <PaperButton type="submit" variant="amber" disabled={!canSubmit} className="min-h-11 px-5">
          <Clapperboard className="size-3.5" aria-hidden="true" />
          {create.isPending ? "Setting up the studio…" : "Start with the story"}
        </PaperButton>
        <span className="text-[12.5px] leading-5 text-paper-sage">The story check takes a few minutes. Nothing is built until you approve the storyboard.</span>
      </div>
    </form>
  );
}

function StyleChoice({ selected, onSelect, name, blurb, sampleUrl }: { selected: boolean; onSelect: () => void; name: string; blurb: string; sampleUrl?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn("relative flex cursor-pointer flex-col items-stretch text-left transition-colors duration-150", PAPER_FOCUS, selected ? "bg-paper-blue text-paper-white" : "bg-paper-white text-paper-moss hover:bg-paper-linen")}
    >
      {sampleUrl ? (
        <img src={sampleUrl} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover object-top" />
      ) : (
        <span className={cn("grid aspect-[4/3] w-full place-items-center", selected ? "bg-paper-white/10" : "bg-paper-stone")} aria-hidden="true">
          <Sparkles className="size-5" strokeWidth={1.5} />
        </span>
      )}
      <span className="flex flex-1 flex-col gap-1 p-3">
        <span className="font-paper-display text-[14px] font-bold tracking-[-0.01em]">{name}</span>
        <span className={cn("line-clamp-3 text-[12px] leading-[17px]", selected ? "text-paper-white/85" : "text-paper-sage")}>{blurb}</span>
      </span>
    </button>
  );
}
