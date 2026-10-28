import { ExternalLink } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { PLACES_SEARCH_REQUESTS, type PlaceCandidate, type PlaceNiche, type PlacesSearchReply } from "@shared/places-types";
import type { Prospect } from "@shared/traction-types";
import { FieldLabel, PAPER_FOCUS, PAPER_INPUT, PaperButton, PaperEmpty, PaperPagination, PaperSection, Tag } from "@/components/paper";
import { useCheckSites, usePlacesNiches, useSearchPlaces } from "@/lib/agentos/places";
import { useCreateProspect } from "@/lib/agentos/traction";
import { usePagination } from "@/lib/use-pagination";
import { cn } from "@/lib/utils";
import { alreadyListed, checksByWebsite, orderCandidates, prospectFromCandidate, reviewsByWebsite, searchBlocker, WEBSITE_KIND_LABEL } from "./traction-places-model";

/**
 * Find by niche: pick a high-ticket niche, an area and a radius, and see the
 * businesses Google Places knows there, weakest web presence first.
 *
 * Searching spends Places requests against a monthly cap, so it waits for the
 * Search button, shows what it will cost and what is left, and says plainly
 * when it cannot run. Importing a business adds it to "To check"; nothing is
 * written to anyone, and nothing from Google is kept except what the business
 * needs to become a prospect.
 */
export function TractionPlacesSearch({ prospects }: { prospects: readonly Prospect[] }) {
  const [open, setOpen] = useState(false);

  return (
    <PaperSection
      label="Find by niche"
      action={
        <PaperButton onClick={() => setOpen((current) => !current)} aria-expanded={open}>
          {open ? "Close" : "Search Google Places"}
        </PaperButton>
      }
    >
      <p className="-mt-2 mb-3 max-w-[70ch] text-[13px] leading-5 text-paper-sage">
        Pick a niche and an area to list businesses near you, then add the ones worth a look. They wait in To check until you have read their website.
      </p>
      {open ? <SearchPanel prospects={prospects} /> : null}
    </PaperSection>
  );
}

function SearchPanel({ prospects }: { prospects: readonly Prospect[] }) {
  const id = useId();
  const niches = usePlacesNiches(true);
  const search = useSearchPlaces();
  const [nicheId, setNicheId] = useState("");
  const [area, setArea] = useState("Sandton");
  const [radiusKm, setRadiusKm] = useState(10);

  const reply = niches.data;
  const niche = reply?.niches.find((entry) => entry.id === (nicheId || reply.niches[0]?.id));
  const blocker = searchBlocker(reply, PLACES_SEARCH_REQUESTS);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!niche || blocker) return;
    search.mutate({ area: area.trim(), nicheId: niche.id, radiusKm });
  };

  if (niches.isPending) return <p className="text-[13px] text-paper-sage">Loading niches…</p>;
  if (niches.error || !reply || !niche) {
    return (
      <p role="alert" className="text-[13px] text-paper-flame-deep">
        {niches.error?.message ?? "The niche list could not be loaded."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="grid gap-3 border border-paper-mist bg-paper-linen p-4" aria-label="Search Google Places">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block" htmlFor={`${id}-niche`}>
            <FieldLabel>Niche</FieldLabel>
            <select id={`${id}-niche`} value={niche.id} onChange={(event) => setNicheId(event.target.value)} className={cn(PAPER_INPUT, "cursor-pointer")}>
              {reply.niches.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block" htmlFor={`${id}-area`}>
            <FieldLabel>Area</FieldLabel>
            <input id={`${id}-area`} value={area} onChange={(event) => setArea(event.target.value)} required minLength={2} maxLength={80} className={PAPER_INPUT} />
          </label>
          <label className="block" htmlFor={`${id}-radius`}>
            <FieldLabel>Radius</FieldLabel>
            <select id={`${id}-radius`} value={radiusKm} onChange={(event) => setRadiusKm(Number(event.target.value))} className={cn(PAPER_INPUT, "cursor-pointer")}>
              {radiusOptions(reply.radius).map((km) => (
                <option key={km} value={km}>
                  {km} km
                </option>
              ))}
            </select>
          </label>
        </div>

        <NicheNote niche={niche} />

        <div className="flex flex-wrap items-center gap-3">
          <PaperButton type="submit" variant="amber" disabled={search.isPending || Boolean(blocker) || area.trim().length < 2}>
            {search.isPending ? "Searching…" : "Search"}
          </PaperButton>
          <span className="text-[12.5px] text-paper-sage">
            Uses {PLACES_SEARCH_REQUESTS} Places requests. {reply.budget.cap > 0 ? `${reply.budget.remaining} of ${reply.budget.cap} left this month.` : "No monthly cap is set."}
          </span>
        </div>

        {blocker ? (
          <p role="alert" className="text-[13px] text-paper-flame-deep">
            {blocker}
          </p>
        ) : null}
        {search.error ? (
          <p role="alert" className="text-[13px] text-paper-flame-deep">
            {search.error.message}
          </p>
        ) : null}
      </form>

      {search.data ? <Results reply={search.data} niche={reply.niches.find((entry) => entry.id === search.data.result.nicheId) ?? niche} prospects={prospects} /> : null}
    </div>
  );
}

/** Whole kilometres from the minimum to the maximum, in steps of five, always including both ends. */
function radiusOptions({ min, max }: { min: number; max: number }): number[] {
  const options: number[] = [];
  for (let km = min; km <= max; km += 5) options.push(km);
  if (options[options.length - 1] !== max) options.push(max);
  return options;
}

function NicheNote({ niche }: { niche: PlaceNiche }) {
  return (
    <div className="text-[12.5px] leading-5 text-paper-char">
      <p>{niche.why}</p>
      {niche.caveat ? <p className="mt-0.5 text-paper-sage">{niche.caveat}</p> : null}
    </div>
  );
}

// ─── Results ────────────────────────────────────────────────────────────────

function Results({ reply, niche, prospects }: { reply: PlacesSearchReply; niche: PlaceNiche; prospects: readonly Prospect[] }) {
  const create = useCreateProspect();
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const { result } = reply;

  // Their own sites are read as soon as the results arrive: it costs no Places requests, and it is what puts the sites that need the most work first.
  const { mutate: readSites, data: read, isPending: reading, error: readError } = useCheckSites();
  const websites = useMemo(() => result.candidates.flatMap((candidate) => (candidate.websiteKind === "own" && candidate.website ? [candidate.website] : [])), [result]);
  // Once per set of results: development's double-run of effects must not read every site twice.
  const requested = useRef<string[] | undefined>(undefined);
  useEffect(() => {
    if (websites.length === 0 || requested.current === websites) return;
    requested.current = websites;
    readSites({ websites, reviews: reviewsByWebsite(result.candidates) });
  }, [readSites, websites, result]);
  const checks = useMemo(() => checksByWebsite(read?.checks), [read]);

  const ordered = useMemo(() => orderCandidates(result.candidates, checks), [result, checks]);
  const pager = usePagination(ordered, `${result.nicheId}|${result.area.name}|${result.radiusKm}|${checks.size}`, 10);

  const add = (candidate: PlaceCandidate) =>
    create.mutate(prospectFromCandidate(candidate, niche, result.area.name, candidate.website ? checks.get(candidate.website) : undefined), {
      onSuccess: () => setAdded((current) => new Set(current).add(candidate.placeId)),
    });

  return (
    <div>
      <p aria-live="polite" className="mb-2 text-[13px] text-paper-char">
        {result.candidates.length === 0
          ? `Nothing found for ${niche.label.toLowerCase()} within ${result.radiusKm} km of ${result.area.name}.`
          : `${result.candidates.length} ${result.candidates.length === 1 ? "business" : "businesses"} within ${result.radiusKm} km of ${result.area.name}, weakest web presence first. Google returns at most 20 per search.`}
        {reading ? ` Reading ${websites.length} ${websites.length === 1 ? "website" : "websites"}…` : ""}
      </p>
      {readError ? (
        <p role="alert" className="mb-2 text-[13px] text-paper-flame-deep">
          The websites could not be read, so the list is ordered by what Google knows. {readError.message}
        </p>
      ) : null}
      {checks.size > 0 ? (
        <p className="mb-2 max-w-[70ch] text-[12.5px] leading-5 text-paper-sage">
          Websites are read from their HTML. The bold lines are where a site loses visitors ready to buy; the rest is what is out of date. A site built with scripts can show gaps a visitor would not see, so treat these as a reason to look, not a verdict.
        </p>
      ) : null}
      {result.candidates.length === 0 ? (
        <PaperEmpty description="Try a wider radius or a different area." />
      ) : (
        <ul className="divide-y divide-paper-mist border-y border-paper-mist">
          {pager.pageItems.map((candidate) => {
            const listed = added.has(candidate.placeId) || alreadyListed(candidate, prospects);
            const siteCheck = candidate.website ? checks.get(candidate.website) : undefined;
            return (
              <li key={candidate.placeId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-paper-moss">{candidate.name}</h3>
                  <p className="text-[12.5px] text-paper-sage">
                    {[candidate.address, `${candidate.distanceKm} km`, candidate.rating !== undefined ? `${candidate.rating} stars (${candidate.ratingCount ?? 0})` : undefined].filter(Boolean).join(" · ")}
                  </p>
                  {siteCheck && siteCheck.leaks.length > 0 ? (
                    <ul aria-label="Where the site loses customers" className="mt-1 max-w-[70ch] space-y-0.5 text-[12.5px] leading-5 font-medium text-paper-moss">
                      {siteCheck.leaks.map((leak) => (
                        <li key={leak}>{leak}</li>
                      ))}
                    </ul>
                  ) : null}
                  {siteCheck && siteCheck.problems.length > 0 ? (
                    <p className="mt-0.5 max-w-[70ch] text-[12.5px] leading-5 text-paper-char">{siteCheck.problems.slice(0, 3).join(" · ")}</p>
                  ) : null}
                  {siteCheck && siteCheck.reachable && siteCheck.problems.length === 0 && siteCheck.leaks.length === 0 ? (
                    <p className="mt-0.5 text-[12.5px] text-paper-sage">Nothing obvious to fix on the site.</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {siteCheck && siteCheck.advertising.length > 0 ? (
                    <Tag tone="blue">Runs {siteCheck.advertising.join(" + ")}</Tag>
                  ) : null}
                  {siteCheck ? <Tag tone={siteCheck.score >= 7 ? "green" : siteCheck.score >= 4 ? "marigold" : "muted"}>{siteCheck.reachable ? `${siteCheck.score}/10 to fix` : "Did not load"}</Tag> : null}
                  <Tag tone={candidate.websiteKind === "none" ? "green" : candidate.websiteKind === "social" ? "marigold" : "muted"}>{WEBSITE_KIND_LABEL[candidate.websiteKind]}</Tag>
                  {candidate.website ? (
                    <a href={candidate.website} target="_blank" rel="noopener noreferrer" className={cn("inline-flex items-center gap-1 px-2 text-[13px] text-paper-blue hover:underline", PAPER_FOCUS)}>
                      Website
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  ) : null}
                  {listed ? (
                    <Tag tone="muted">In your list</Tag>
                  ) : (
                    <PaperButton variant="amber" disabled={create.isPending} onClick={() => add(candidate)} aria-label={`Add ${candidate.name} to To check`}>
                      Add to To check
                    </PaperButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <PaperPagination pager={pager} label="Search result pages" />
      {create.error ? (
        <p role="alert" className="mt-3 text-[13px] text-paper-flame-deep">
          {create.error.message}
        </p>
      ) : null}
    </div>
  );
}
