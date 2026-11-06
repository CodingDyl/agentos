---
name: website-design-direction
description: Keep rebuilt client sites distinctive, even within one niche. Assigns each hero concept a forced art direction from outside web templates, bans the patterns that make sites read as generated, maps each niche's clichés, and scores concepts against a 40-point rubric. Used by agentos-website-to-preview at the hero and build stages.
version: 1.0.0
used-by: [agentos-website-to-preview]
---

# Website design direction

Models drift to the average. Ask three times for "a modern law firm hero" and
you get navy, gold, a serif and a boardroom photo three times, and the same
again for the next law firm. A list of good taste alone does not fix that.
What fixes it is **different inputs every run** and **a critique that rejects
the average**.

The source of truth for every list in this skill is
`server/website-rebuild/design-directions.ts`. The files in `references/` are
generated from it and a test keeps them in step: change the code, then the
references.

## How AgentOS uses it

1. **Niche.** The run's niche is detected from the target market, then the
   company name (`references/niche-cliches.md`). Unknown niches use the general
   clichés.
2. **Assignment.** Before the hero stage, each of the three concepts gets a
   different direction from `references/directions.md`, chosen
   deterministically from the run id. Directions, font pairs and dominant
   palette families that earlier runs in the same niche or target market used
   are excluded while unused ones remain; after that the least used come
   first. **Concept C is always a wildcard**: a direction listed as far from
   the niche. With a brand kit, A stays faithful to the client's colours and
   fonts inside its direction's layout and imagery, B evolves, C is bold.
3. **Fingerprint.** Every DESIGN.md ends with an `agentos-fingerprint` block
   (direction, display and text font, dominant hex colours, hero layout).
   AgentOS stores it per run and concept in `website-rebuild.db`
   (`design_fingerprints`), so the next run in the niche avoids it and the
   brief lists the font pairs and colours already used.
4. **Critique gate.** A second model scores each concept against
   `references/rubric.md`. A concept below **28/40**, or one that repeats an
   earlier run (same direction and same font pair), goes back for **one**
   automatic revision. After that it goes to the person with its score shown,
   never round again on its own.
5. **Build.** The build brief carries the approved concept's direction and the
   anti-patterns to every page. The build review scores the whole site against
   the same rubric (`Design score: NN/40`); below the bar its slop findings
   are Major findings that the next revision must answer.

## Rules for a worker following this skill

- Commit to the assigned direction in all four of type, colour, layout grammar
  and imagery. One of the four is not a direction, it is a theme.
- Study the direction's reference domain (a newspaper, a datasheet, a sea
  chart), not other websites in the niche.
- Avoid everything in `references/anti-patterns.md` and the niche's entry in
  `references/niche-cliches.md`, unless it is the client's real brand.
- Distinct is not the same as unsuitable: a wildcard must still make the
  client's offer, place and next step obvious in five seconds.
- Never invent facts, reviews, numbers or awards to fill a layout. A
  data-forward concept uses only real figures from the capture.
- Accessibility is part of the score: contrast of 4.5:1 for text, visible
  focus, semantic landmarks, 390px to 1440px.

## References

- `references/directions.md`: the direction library (15 directions).
- `references/anti-patterns.md`: the banned patterns.
- `references/niche-cliches.md`: what each niche usually looks like, and its wildcards.
- `references/rubric.md`: the 40-point rubric and the critique format.

## Credits and licences

The approach draws on ideas from public work on steering models away from
generic UI: Anthropic's `frontend-design` skill (avoid generic aesthetics,
commit to a bold direction), Paul Bakaus's Impeccable (an explicit "do not"
list of default fonts, purple gradients, centred hero plus feature cards and
nested cards, and audit, critique and polish passes) and Hallmark (MIT;
distinct themes and separate build, audit and redesign steps). **No text,
lists or code were copied from any of them.** Every list here was written for
AgentOS, so no third-party licence terms attach to this skill. If text from
one of them is ever added, keep it to MIT or Apache 2.0 sources and credit it
here with its licence.
