---
name: website-design-direction
description: Keep rebuilt client sites distinctive and agency grade, even within one niche. Assigns each hero concept its own art direction, composition, navigation, motion and font pair; writes a strategy first; gives each concept real fonts, motion libraries, current references and optional original imagery; measures the result in a browser and has a critic judge screenshots. Used by agentos-website-to-preview at the hero and build stages.
version: 2.0.0
used-by: [agentos-website-to-preview]
---

# Website design direction

Models drift to the average. Ask three times for "a modern law firm hero" and
you get navy, gold, a serif and a boardroom photo three times, and the same
again for the next law firm. A list of good taste alone does not fix that.
What fixes it is **different inputs every run**, **real materials**, and **a
check that looks at the page rather than its code**.

The first version of this skill assigned a look and little else, and the same
page kept coming back in different colours: small label, headline left, one
button, a box on the right, logo left and links right, in fonts that never
loaded. Everything below exists to stop that.

The source of truth for the lists in this skill is
`server/website-rebuild/design-directions.ts` and `compositions.ts`. The files
in `references/`, apart from `craft.md`, are generated from them and a test keeps
them in step: change the code, then the references.

## How AgentOS uses it

1. **Niche.** Detected from the target market, then the company name
   (`references/niche-cliches.md`). Unknown niches use the general clichés.
2. **Assignment.** Each concept gets five things, chosen deterministically from
   the run id and its generation, avoiding what earlier runs in the niche used:
   - an **art direction** (`references/directions.md`): the look. Concept C is
     always a wildcard, and each niche lists what would be a costume there;
   - a **font pair**, one of several per direction;
   - a **composition** (`references/compositions.md`): the page's structure. One
     comes from each family, image, type and interaction;
   - a **navigation** and a **motion signature**.
3. **Strategy.** One job writes `design/STRATEGY.md` before anyone designs: who
   really hires this client, the moment they arrive, what only this client can
   say, and a different idea and headline for each concept.
4. **Materials.** AgentOS puts these in place first: self-hosted fonts from
   Fontsource, GSAP and Lenis in `design/kit/`, screenshots of live reference
   sites for each composition taken today, and, if the run has an image budget,
   original imagery from the strategy's art plan. Nothing is generated at a zero
   budget.
5. **Three independent jobs.** Each concept is its own worker job with fresh
   context, and turns are taken between two models. One job writing all three
   gives all three its one skeleton.
6. **Rendered audit.** AgentOS opens each hero in Chromium at 1440px and 390px
   and measures whether its fonts loaded, its assigned composition and navigation
   are there, it makes outside requests, it scrolls sideways, and it occupies the
   screen like another concept or an earlier one. Impeccable's detector flags
   slop patterns. These are facts, and they send a concept back on their own.
7. **Critique gate.** A second model judges **screenshots** against
   `references/rubric.md`. Below **32/40**, a "not presentable", or a measured
   failure sends a concept back for **one** automatic revision, as its own job.
   After that it goes to the person with its score shown.
8. **New concepts.** The person can throw all three away. They move to history,
   and the next generation avoids them as if another run had used them. A request
   for changes keeps the assignment; a note on one concept redoes only that one.
9. **Build.** The build ports the approved hero as it is, with its fonts and
   motion, and carries its navigation and character to every page. The build
   review scores the whole site on the same rubric.

## Rules for a worker following this skill

- Read `references/craft.md` before writing any code.
- Commit to the whole assignment: direction, composition, navigation, motion and
  fonts. One of the five is not a concept, it is a theme.
- Study the direction's reference domain and the live screenshots for how they
  work. Never copy a layout, words or a mark.
- Avoid everything in `references/anti-patterns.md` and the niche's entry in
  `references/niche-cliches.md`, unless it is the client's real brand.
- Distinct is not the same as unsuitable: the client must be able to show this to
  their own clients, and the offer, place and next step must be obvious in five
  seconds.
- Never invent facts, reviews, numbers or awards to fill a layout. Generated
  imagery is illustrative and never passes as the client's people or premises.
- Everything that looks interactive works, on clearly marked sample data if it has
  no real data yet.

## References

- `references/craft.md`: how to make a hero look finished. Read this first.
- `references/directions.md`: the art directions.
- `references/compositions.md`: compositions, navigation and motion.
- `references/anti-patterns.md`: the banned patterns.
- `references/niche-cliches.md`: what each niche usually looks like, its wildcards and what would be a costume.
- `references/rubric.md`: the 40-point rubric and the critique format.

## Credits and licences

The approach draws on ideas from public work on steering models away from
generic UI: Anthropic's `frontend-design` skill (avoid generic aesthetics,
commit to a bold direction), Paul Bakaus's Impeccable (an explicit "do not"
list of default fonts, purple gradients, centred hero plus feature cards and
nested cards, and audit, critique and polish passes) and Hallmark (MIT;
distinct themes and separate build, audit and redesign steps). AgentOS also runs Impeccable's own detector (Apache-2.0, pinned on npm as
`impeccable`) as a program, and ships GSAP (no-charge licence) and Lenis (MIT) into
concepts as files. **No text or lists were copied from any of them into this skill.** Every list here was written for
AgentOS, so no third-party licence terms attach to this skill. If text from
one of them is ever added, keep it to MIT or Apache 2.0 sources and credit it
here with its licence.
