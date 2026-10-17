---
name: motion-site-studio
description: Build a website that moves like a film from the user's references, using Higgsfield images/video (or code-only motion), with a credit-approval gate, ledger, continuity checks and a three-critic design loop.
---
# Motion Site Studio

Build a website that moves like a film and reflects the visual qualities of the user's references. Translate inspiration into observable design rules, preserve motion continuity, and iterate against evidence. Treat the user's feedback as the highest design priority.

## When to use this skill when building websites

- Build a new website with a cinematic hero, 3D product journey, or scroll-controlled film.
- Redesign a website around a mood board or supplied design screenshots.
- Create landing pages, brand sites, portfolios, or product showcases where motion communicates the story.
- Add seamless video loops or continuous camera motion to an existing website.
- Refine a motion website against references and the user's feedback.

For ordinary website tasks without a motion or reference-led design requirement, use the relevant website-building workflow instead of imposing film production.

## Operating rules

- Inspect the existing project, stack, assets, and applicable project instructions before implementation. Reuse the established Next.js App Router TypeScript stack unless a change is justified.
- Honour the model and effort the operator chose in AgentOS. Do not raise them, and do not claim to change settings the environment cannot control.
- Follow available website-building, generation, and deployment tools' instructions. Verify Higgsfield capabilities and command syntax before use; never invent tools or commands.
- Treat this as a standalone instruction skill. It does not include the original downloadable package or scripts. Create project-specific helpers only when needed.
- Confirm current model availability, pricing, frame conditioning, duration, and resolution using official documentation or the authenticated provider before paid jobs.
- Present two concrete concepts and an itemized estimate before spending. Obtain authorization for the selected concept and credit ceiling unless already explicitly authorized.
- Continue authorized work without repeated approval requests. Stop paid generation before exceeding the ceiling; propose a revised budget with a concrete explanation if necessary.
- Offer code-based motion when Higgsfield is unavailable. If live prices cannot be checked, prepare the design and code without describing estimates as exact or submitting unapproved paid jobs.

## 1. Analyze references

Use 3–10 supplied images where possible. Ask what the user likes about each: color, composition, typography, material, lighting, motion, or layout. Accept fewer references when sufficient.

If no references exist, present three relevant visual directions or accessible examples for selection. Mobbin, Refero, Savee, and saved posts can supply inspiration; do not claim to inspect inaccessible content.

Inspect each reference and produce a short teardown covering:

- Composition, hierarchy, spacing, and density.
- Palette, contrast, typography, and visual identity.
- Materials, lighting, depth, camera position, and focal subject.
- Section rhythm, supporting graphics, and conversion intent.
- Visible or evidenced motion qualities; label inferred motion as an inference.

Convert the findings into 5–10 observable rules. Use rules that can be checked in screenshots or clips, such as “keep the product centered during the camera move” or “use one accent color for the primary action.” Avoid vague instructions such as “make it premium.”

Save the teardown and rules in the project. Use them throughout review without copying another brand's identity or unsupported claims.

## 2. Interview and propose

Ask unresolved questions together in one short batch. Reuse answers already given. Accept “you decide” for creative decisions and record the resulting assumptions.

1. **Brand:** What is it called, what does it sell, and who is it for?
2. **Vibe:** What should it feel like, in one line?
3. **Journey:** Where does the camera start, and where does it end?
4. **Sections:** What belongs below the film, and what should each section prove?
5. **Action:** What is the one thing a visitor should do?
6. **Budget:** How many Higgsfield credits may be spent?
7. **Extras:** Is a small character wanted, and where should the site go live?

Prioritize the journey. Define a start frame, end frame, intermediate states, and the purpose of each movement.

Present two concepts. For each, show the hero idea, camera journey, section structure, motion approach, media count, resolutions, and itemized cost. Recommend one with a brief reason. Do not interpret “you decide” about creative choices as unlimited spending authority.

### Budget and ledger

Treat these as source-supplied values labeled October 2026, not independently verified current prices:

| Output | Source-listed model | Source-listed credits |
| --- | --- | ---: |
| One 2K image | Nano Banana Pro | 2 |
| One 5-second 1080p clip | Seedance 2.0 | 45 |
| One 5-second 720p clip | Seedance 2.0 | 22.5 |
| One 5-second 480p draft | Seedance 2.0 | 15 |
| Brand film with sound, 1080p | Seedance 2.5 | 12 per second |

Use the source's packages as planning examples only:

| Plan | Source-listed deliverables | Approximate source estimate |
| --- | --- | ---: |
| Taster | 4 images, 3-clip film at 720p, 1 loop | 100 credits |
| Standard | 6 images, 5-clip film at 1080p, 2 loops | 330 credits |
| Full | 14 images, 7-clip film at 1080p, 4 loops | 525 credits |

Recalculate from live unit prices. Specify loop duration and resolution; the example totals do not establish these. Include draft generations and remakes. Reserve about 15% of the approved ceiling for repairs, and show planned spend, reserve, and maximum authorized spend separately.

Maintain `motion-credit-ledger.csv` in the project. Record every submitted job, including failures and retries, with timestamp, provider job ID, asset purpose, model, settings, quoted credits, actual charged credits when known, status, output path, cumulative spend, and remaining budget. Mark unknown charges as pending and account for them before further submissions.

## 3. Generate and approve key images

Use Nano Banana Pro if currently available and appropriate, or propose an equivalent verified model.

1. Generate the first key image from the visual rules and approved concept.
2. Derive each subsequent image from its predecessor using image conditioning where supported.
3. Preserve scene geometry, subject identity, materials, camera orientation, lens, and framing. Keep deliberate lighting changes gradual.
4. Make one small change at a time: distance, position, environment, or light. Keep camera orientation fixed within a continuous shot.
5. Compare adjacent images side by side. Reject unintended rotation, altered objects, inconsistent geometry, and changes too large to interpolate smoothly.
6. Add an intermediate key image when adjacent states are too far apart.
7. Fix continuity at the image stage before commissioning expensive clips.

Approve the sequence against the brief and reference rules. Store prompts, settings, source-image relationships, and accepted outputs in the project so revisions remain traceable.

## 4. Generate and inspect the film

Prefer a verified model that faithfully supports start and end frame conditioning. The source recommends Seedance 2.0 for continuity and warns that Seedance 2.5 may redraw the first frame; verify this behavior through current documentation and output checks. Consider Seedance 2.5 for a standalone film with audio only when its verified behavior suits the brief.

Generate short clips, initially about five seconds each, subject to supported settings and the approved budget.

### Continuity requirements

- **Joins:** Extract the actual final frame of each accepted clip and use that exact image as the next clip's start input. A planned keyframe alone does not prove the rendered join matches.
- **Endpoints:** Inspect rendered boundary frames even when the provider accepts exact inputs; conditioning does not guarantee exact output.
- **Loops:** Condition start and end on the same image, then verify rendered endpoints and motion speed produce a seamless loop.
- **Small moves:** Make one deliberate change per clip and maintain the established camera orientation.
- **No cuts:** Inspect every clip for cuts, morphing, flashes, geometry drift, and unintended camera turns.

Use ffmpeg or equivalent tools to decode all frames and detect abrupt changes. Inspect adjacent frames around candidate discontinuities, all joins, and loop boundaries. Also review normal playback and slow scrubbing. Do not claim frame-by-frame verification after inspecting only a few samples.

Reject discontinuous clips. Do not conceal jumps with flashes, fades, or crossfades: scrolling may stop on any frame. Create an intermediate image and regenerate the affected transition within budget. Recheck downstream joins if its endpoint changes.

Keep compatible dimensions, aspect ratios, frame rates, and encoding across the sequence. Retain accepted source clips and export a web-ready film or frame sequence suited to reliable seeking.

## 5. Build the website and run the design loop

The project is a **Next.js App Router + TypeScript** app. AgentOS seeds `app/`, `components/scroll-film.tsx` and `components/scene.tsx`. Extend those files. Do not replace the app with a standalone `index.html`.

Required motion libraries, already listed in `package.json`:

- **GSAP** with **ScrollTrigger**. Register the plugin only on the client, inside `useGSAP` or `useEffect` — never at module top-level (the App Router renders on the server, where `window` does not exist).
- **Three.js** through `@react-three/fiber` (and `@react-three/drei` where it helps). Keep the canvas in a client component.
- **Framer Motion** for UI entrance and page transitions.

A static `index.html` with CDN script tags is the usual reason slide animations never play: opening it via `file://` has no HTTP origin, ScrollTrigger is often not registered, scripts load in the wrong order, and there is no pin/`end` distance for the scroller. Serve with `npm run dev` or `npm run build && npm start`.

Implement the approved page with readable content, responsive layouts, clear navigation, and one primary conversion action.

- Map scroll progress deterministically to video time or image-sequence frames. Check forward scrolling, reverse scrolling, and stopping at joins.
- Pin the film section (`ScrollTrigger.create({ pin: true, end: "+=…" })`) so there is scroll distance to scrub.
- Give each section a purposeful supporting motion graphic where it helps the story. Use restrained code-based motion when extra video adds little value.
- Make the hero readable before media loads. Provide a poster or static fallback, staged media loading, and suitable mobile assets.
- Respect reduced-motion preferences with a useful static or low-motion experience. Support keyboard navigation, visible focus, readable contrast, and controls for long-running animation.
- Avoid autoplay audio. Introduce sound only through a clear user action.

### Three review perspectives

Compare the rendered website with the references at matching viewport sizes. Run independent reviews using fresh reviewers when available; otherwise perform three separate passes and disclose that they are self-reviews.

| Review | Check |
| --- | --- |
| Brief | Audience, brand, journey, section purpose, primary action, and user requests |
| Design rules | Composition, hierarchy, typography, palette, spacing, imagery, and fidelity to extracted rules |
| Craft | Clip joins, loops, scroll seeking, responsiveness, accessibility, loading, and implementation quality |

Require evidence-backed findings with a location, severity, and correction. If any review fails, fix the issues and rerun affected checks. Keep a concise review log. Do not loop indefinitely: if budget, tools, or unavailable input blocks a fix, state the blocker and deliver the best reviewable result.

Invite the user's notes after each meaningful round. Treat those notes as the highest design priority while explaining conflicts with feasibility, accessibility, or the spending ceiling.

Polish all copy last. Use natural, specific language; remove filler, unsupported superlatives, invented proof, and generic marketing phrases. Verify headings and buttons communicate the offer and action clearly.

## Completion criteria

Before delivery:

- Check desktop and mobile rendering, forward and reverse scrubbing, joins, loops, and media fallbacks.
- Test navigation, primary buttons, and implemented forms or integrations end to end.
- Check reduced motion, keyboard use, loading behavior, and project-required build checks.
- Resolve failed review findings or clearly identify outstanding limitations.
- Reconcile the credit ledger and summarize actual or pending spend.
- Provide the reviewable website or preview, relevant project files, and concise validation results. Deploy only within the user's authorization.

Do not promise that subjective design quality “beats” every reference. Report which observable rules the result satisfies and where compromises remain.

## Example invocation

```text
/motion-site-studio

Build a 3D motion website from my attached references.
The site is a Next.js App Router TypeScript project.
Use GSAP + ScrollTrigger (register client-side), @react-three/fiber, and Framer Motion.
Analyze what makes them work, then interview me in one batch.
Show two concepts and a verified itemized budget before spending.
Generate the images and video with Higgsfield if available, build the site,
and iterate against the reference rules and my feedback.

Brand: [name and one-line description, or ask me]
Budget: [maximum Higgsfield credits, or ask me]
```
