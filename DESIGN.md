# Hermes Agent — Style Reference
> Electric-blue editorial landing page for an AI agent. Condensed type, tiny terminal labels, engraved mythic imagery, and stark blue/white section changes do most of the visual work.

**Theme:** high-contrast blue and warm white

**Source:** [Hermes Agent website](https://hermes-agent.nousresearch.com/#install), inspected 29 September 2026 at a 1363px desktop viewport. Values identified as *observed* were read from the live page's computed styles. Recommendations and responsive values are interpretations for reuse in AgentOS, not claims about the site's source code. The page's desktop app screenshot is product imagery, not the landing page's component specification.

The page opens as an electric-blue field (`#0000f2`) with an oversized three-line condensed headline in warm white (`#f2f2f2`). Compact uppercase navigation and square call-to-action buttons sit above and below it. A blue-tinted, engraved multi-armed Hermes illustration occupies the other half of the hero. The desktop app section stays blue, while the features and pricing sections switch to warm white with deep blue text. The effect is closer to a printed poster and command-line tool than a conventional rounded SaaS dashboard.

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Hermes Blue | `#0000f2` | `--color-hermes-blue` | Hero, desktop section, primary buttons, feature media backgrounds, blue text on paper |
| Hermes Paper | `#f2f2f2` | `--color-hermes-paper` | Primary text on blue, pale section canvas, light buttons |
| Deep Ink | `#000091` | `--color-deep-ink` | Feature and portal headings/body on paper; observed computed text color |
| Dark Blue | `color-mix(in srgb, #0000f2 20%, #000)` | `--color-dark-blue` | Inset/terminal-like surfaces; derived from the site's dark surface token |
| Light Blue Surface | `color-mix(in srgb, #0000f2 2%, #fff)` | `--color-light-blue-surface` | Very pale card surface; defined in site tokens, use sparingly |
| Paper 20 | `color-mix(in srgb, #f2f2f2 20%, transparent)` | `--color-paper-20` | Ghost controls on a blue field |
| Yellow Accent | `#f2f200` | `--color-hermes-yellow` | Available brand accent token; not a dominant surface in inspected sections |

The blue/paper pair is the actual signature. The root CSS also declares cyan, green, orange, pink, red, indigo, and neon color tokens, but these are not the main landing-page palette. Avoid turning them into equal-weight theme colors.

## Tokens — Typography

The live site uses proprietary **Rules** faces. Secure a license before shipping those font files in another product. The fallback recommendations below approximate width and hierarchy, not exact letterforms.

### Rules Gothic Condensed — Hero and large section headings · `--font-display`
- **Observed:** hero 108px / 200 / 108px line height / -2.16px tracking at the inspected desktop viewport; section headings 80px / 400 / 80px / -1.6px.
- **Substitute:** `Roboto Condensed`, `Arial Narrow`, sans-serif. A narrow variable display font with a genuinely light weight will be closer.
- **Role:** huge stacked statement, chapter headings, poster-like hierarchy.

### Rules Gothic Compressed — Feature and platform headings · `--font-compressed`
- **Observed:** feature/platform headings 48px / 500 / 52.8px; the wordmark area uses approximately 31.5px / 500 / 28.35px.
- **Substitute:** `Barlow Condensed`, `Roboto Condensed`, sans-serif, with a narrow width axis if available.
- **Role:** short feature names and emphatic compact headings.

### Rules Variable — Body · `--font-body`
- **Observed:** body default 14px; feature descriptions 16px; nav context 14px.
- **Substitute:** `Inter`, `Arial`, sans-serif.
- **Role:** explanatory copy, FAQ answers, general UI text.

### Rules Condensed / Aeonik Fono Pro TRIAL — Utility and terminal · `--font-utility`, `--font-code`
- **Observed:** large nav labels 14px / 500 / 1.4px tracking; compact nav 12px / 500 / 1.2px; feature indices 10px in Aeonik Fono; terminal tabs and command 11px in Aeonik Fono.
- **Substitute:** `Roboto Condensed` for utility; `IBM Plex Mono` or `JetBrains Mono` for command content.
- **Role:** uppercase links, buttons, numbered labels, tabs, command snippets.

### Type Scale

| Role | Family | Weight | Desktop size / line height | Tracking | Token |
|------|--------|--------|----------------------------|----------|-------|
| Hero display | Rules Gothic Condensed | 200 | 108px / 108px | -2.16px | `--text-hero` |
| Section heading | Rules Gothic Condensed | 400 | 80px / 80px | -1.6px | `--text-section` |
| Feature heading | Rules Gothic Compressed | 500 | 48px / 52.8px | normal | `--text-feature` |
| Body / feature description | Rules Variable | 400 | 16px / approximately 25px | normal | `--text-body` |
| Nav utility | Rules Condensed | 500 | 14px / 21px | 1.4px | `--text-nav` |
| Feature index | Aeonik Fono | 400 | 10px | normal | `--text-index` |
| Terminal command | Aeonik Fono | 400 | 11px / 16.5px | normal | `--text-code` |

## Tokens — Spacing & Shapes

**Density:** spacious sections, compact controls. **Spacing scale below:** practical reconstruction based on observed components; it is not an extracted global token scale.

### Spacing Scale

| Name | Value | Token | Use |
|------|-------|-------|-----|
| 4 | 4px | `--space-1` | Icon/copy gap |
| 8 | 8px | `--space-2` | Tight control gap |
| 12 | 12px | `--space-3` | Terminal tab horizontal padding, control groups |
| 16 | 16px | `--space-4` | Body rhythm |
| 24 | 24px | `--space-6` | Content groups |
| 40 | 40px | `--space-10` | Navigation top padding, major subgroups |
| 60 | 60px | `--space-15` | FAQ and portal vertical padding observed |
| 80 | 80px | `--space-20` | Downloads bottom/top padding, feature bottom padding observed |
| 180 | 180px | `--space-45` | Feature section top padding observed at desktop |

### Border Radius

| Element | Value | Interpretation |
|---------|-------|----------------|
| Buttons / navigation | 0px | Observed square corners; sharp edges are part of the identity |
| Terminal tab group | 4px on outside corners | Observed on the platform tabs |
| Feature image panels | approximately 5px on upper corners | Observed 5.25px at inspected viewport |
| Major UI cards | 0–6px | Reuse recommendation; avoid generic 16–28px SaaS cards |

### Shadows

Primary sections and feature panels rely on color contrast, not resting drop shadows. The site defines subtle hover/press lift shadows for buttons; use them only as interaction feedback. The observed buttons also scale to approximately `0.98` while pressed.

### Layout

- Wide desktop content column centered within full-bleed color bands; inspected navigation has 80px side padding at 1363px viewport.
- Hero: text and illustrated figure as a two-part composition; large headline stacks into three short lines.
- Feature section: three equal-width columns; observed feature media width about 333px in a 1363px viewport, with two rows of three.
- The features section begins with unusually generous top breathing room (180px observed).
- **Responsive recommendation:** collapse three columns to two at tablet widths and one on narrow phones; reduce the 108px/80px display sizes with `clamp()` rather than preserving desktop sizes.

## Components

### Split Navigation
**Role:** Brand, external destinations, and installation action.

Place compact uppercase/condensed text links on the left and right of a central Hermes mark. On blue use paper text; over paper use blue text. Nav link labels are 14px with 1.4px tracking in the inspected large state; a smaller variant uses 12px with 1.2px. Keep the install action rectangular and visually stronger than ordinary links.

### Hero Statement
**Role:** Immediate brand claim.

Set a light-weight Rules Gothic Condensed display line at 108px with 1.0 line height and -0.02em tracking on desktop. Break into short lines. Make the headline the primary left-side mass while the engraved figure balances the right. Use `#f2f2f2` against `#0000f2`.

### Engraved Hermes Illustration
**Role:** Distinctive brand artwork.

Use a detailed, almost etching-like figure and radial strokes, rendered in blue/white contrast. It can be tightly cropped and dramatic. This is identity artwork: do not substitute a generic robot illustration or use the brand image as an indiscriminate UI background. Reusing the original artwork requires the appropriate rights.

### Primary Light CTA
**Role:** Desktop download or primary hero action.

Square `#f2f2f2` fill, `#0000f2` text, compact uppercase condensed type, minimal padding and icon. The hero desktop CTA was observed at 14px/500, with roughly 10px padding; smaller download-card links render near 10.5px with 1.05px tracking. Apply a subtle hover lift and press scale.

### Secondary Translucent CTA
**Role:** Cloud deployment or secondary hero action.

Set paper text over a `20%` paper tint on the blue field; keep the same square outline and height as the light CTA. On hover, increase the tint modestly rather than introducing a new accent color.

### Terminal Install Block
**Role:** Copyable command with platform switch.

Place a small uppercase label over a darker blue command well. Use three 11px monospaced tabs for macOS, Linux, and Windows, with a selected blue tab and translucent inactive tabs. The tab group uses only 4px outside corner radius. Put a small copy icon at the command's right edge. Treat the command as real selectable text.

### Desktop Product Stage
**Role:** App preview and OS download choices.

Continue the electric-blue section. Present one large screenshot of the actual product in a wide media stage, then a section heading in condensed 80px type and platform entries. The screenshot's white UI is evidence of the desktop product, not permission to restyle the landing page as a white dashboard.

### Feature Unit
**Role:** Repeating product capability story.

On paper, stack a tiny numbered monospace index (such as `#1 Connect`), a 48px compressed heading, a 16px paragraph, and a roughly square blue illustration panel. Keep all six items aligned on a three-column grid at desktop. Give media very little rounding and no resting shadow.

### FAQ Accordion
**Role:** Compact support answers.

Use thin, text-led disclosure rows within the paper section. Questions use blue condensed type and a modest approximately 38px minimum hit height in the inspected control. Expose focus and expanded state clearly, and preserve readable body type for the answer.

### Portal Pricing Grid
**Role:** Tier comparison and conversion.

Use paper as the surrounding canvas, a large condensed section title, compact uppercase utility details, and clear tier columns. The page shows Free, Plus, Super, and Ultra tiers. Keep plan details readable and distinguish the promoted tier with a small annotation; prices and credits are live commercial content, so do not hard-code them into a design token system.

### Footer
**Role:** Editorial brand close and link directory.

End with oversized brand language, compact uppercase section labels, and grouped research/product/resource/platform links. Preserve the high-contrast blue/paper palette and square editorial treatment.

## Do's and Don'ts

### Do
- Use `#0000f2` and `#f2f2f2` as the dominant pair, flipping foreground and background between major sections.
- Make condensed typography and dramatic scale the main visual system.
- Use small letter-spaced utility labels and monospace command/index details to signal an agent and terminal context.
- Keep buttons mostly square; reserve slight rounding for terminal tabs and media corners.
- Pair mythic/engraved brand imagery with actual product screenshots.
- Treat keyboard focus, active platform tabs, and copy feedback as real interaction states.

### Don't
- Don't convert the look into a generic dark navy/purple gradient SaaS dashboard.
- Don't put every section into large rounded floating cards.
- Don't replace the thin hero with heavy 700-weight grotesk type.
- Don't fill the page with multicolored status chips because optional accent tokens exist.
- Don't use the licensed Rules/Aeonik fonts or original Hermes illustration in a shipped product without rights.
- Don't paste the landing page's huge display scale into dense AgentOS task lists or data tables.

## Surfaces

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 0 | Electric stage | `#0000f2` | Hero and desktop app storytelling |
| 1 | Paper stage | `#f2f2f2` | Features, FAQ surroundings, portal and footer regions |
| 2 | Deep command well | dark blue / blue-black mix | Terminal command, inset controls |
| 3 | Light image card | blue on paper | Feature media panel; media supplies detail |
| 4 | Transparent overlay | `#f2f2f2` at about 20% | Secondary action on blue |

## Elevation

The primary hierarchy comes from a hard color transition, type scale, and image blocks. Cards are mostly flat. Add only a restrained interaction lift/press effect to controls. Avoid glassmorphism, broad ambient shadows, and layered floating dashboards.

## Imagery

The hero's blue-white engraved figure and radiating lines establish the mythic identity. Feature tiles use blue textured or graphic illustrations with distinct content. The desktop section instead presents a large real application screenshot. For AgentOS, borrow the *relationship*: one signature editorial brand illustration for arrival/onboarding, actual interface previews for capability proof, and small expressive media only where it adds meaning. Do not imitate proprietary brand art pixel for pixel.

## Layout

The page moves from a dense but spacious blue hero with centered navigation, headline/illustration split, two adjacent CTAs, and terminal command, into a blue desktop-app showcase. A sharp switch to paper introduces six feature units in a three-column grid. FAQ rows follow as lighter text-led content, then a portal tier comparison and extensive footer. The alternation of full-width color fields creates chapters without inserting card containers between every section. At narrow widths, preserve the visual order: headline → actions → install block → illustration/product media → features.

## Agent Prompt Guide

Quick Color Reference:
- Hermes Blue `#0000f2` — hero, strong actions, and illustration panels.
- Hermes Paper `#f2f2f2` — light canvas and text on blue.
- Deep Ink `#000091` — long text/headings on paper.
- Dark Blue — terminal well and inset treatments.

Create an AgentOS landing or mission-control entry screen inspired by Hermes: a full-bleed Hermes Blue canvas, a light condensed display headline, small uppercase utility navigation, rectangular paper primary button, translucent secondary button, and one dramatic editorial illustration. Use original AgentOS branding and art.

Create a feature overview on Hermes Paper with a three-column desktop grid. Each item has a 10px monospace numbered kicker, a 48px compressed heading, a 16px description, and a mostly square blue illustration panel. Collapse the grid on smaller screens.

Create a copyable install/command module with a dark-blue well, 11px monospace command, three compact platform tabs, and visible active/copy states. Keep it keyboard accessible.

For dense AgentOS views, carry over the color, typography hierarchy, and compact labels, but reduce display sizes and use readable body/UI fonts. The marketing page is inspiration; task, worker, and log screens need information density and legibility.

## Similar Brands

- **Nothing** — assertive brand type and graphic product storytelling, although Hermes is more electric blue and mythic.
- **Linear** — restrained product UI and crisp interaction details, but much quieter than Hermes's landing page.
- **IBM Plex-era developer tools** — terminal-like utility labels and command snippets, though Hermes uses proprietary condensed faces.

## Quick Start

### CSS Custom Properties

```css
:root {
  /* Observed palette */
  --color-hermes-blue: #0000f2;
  --color-hermes-paper: #f2f2f2;
  --color-deep-ink: #000091;
  --color-dark-blue: color-mix(in srgb, #0000f2 20%, #000);
  --color-light-blue-surface: color-mix(in srgb, #0000f2 2%, #fff);
  --color-paper-20: color-mix(in srgb, #f2f2f2 20%, transparent);
  --color-hermes-yellow: #f2f200;

  /* Substitutes: replace with properly licensed Rules faces if available */
  --font-display: 'Roboto Condensed', 'Arial Narrow', sans-serif;
  --font-compressed: 'Barlow Condensed', 'Roboto Condensed', sans-serif;
  --font-body: Inter, Arial, sans-serif;
  --font-utility: 'Roboto Condensed', Arial, sans-serif;
  --font-code: 'IBM Plex Mono', 'JetBrains Mono', monospace;

  /* Desktop roles observed on the reference */
  --text-hero: 108px;
  --leading-hero: 1;
  --tracking-hero: -0.02em;
  --text-section: 80px;
  --leading-section: 1;
  --tracking-section: -0.02em;
  --text-feature: 48px;
  --leading-feature: 1.1;
  --text-body: 16px;
  --text-nav: 14px;
  --tracking-nav: 0.1em;
  --text-index: 10px;
  --text-code: 11px;

  /* Reusable spacing reconstruction */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-10: 40px;
  --space-15: 60px;
  --space-20: 80px;
  --space-45: 180px;
  --radius-control: 0px;
  --radius-tab: 4px;
  --radius-media: 5px;
}

.hermes-inspired-hero {
  background: var(--color-hermes-blue);
  color: var(--color-hermes-paper);
}

.hermes-inspired-hero h1 {
  font-family: var(--font-display);
  font-size: clamp(3.75rem, 8vw, var(--text-hero));
  font-weight: 200;
  line-height: var(--leading-hero);
  letter-spacing: var(--tracking-hero);
}

.hermes-inspired-button {
  border: 0;
  border-radius: var(--radius-control);
  background: var(--color-hermes-paper);
  color: var(--color-hermes-blue);
  font: 500 14px/1.3 var(--font-utility);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  transition: transform 150ms ease, box-shadow 150ms ease;
}

.hermes-inspired-button:active { transform: scale(.98); }
.hermes-inspired-button:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }

@media (prefers-reduced-motion: reduce) {
  .hermes-inspired-button { transition: none; }
}
```

The CSS is a reusable reconstruction. It is not copied from the site's compiled stylesheet; the font fallbacks and responsive `clamp()` are implementation recommendations.

---

# AgentOS implementation

Everything above is the visual reference. This section is how AgentOS applies it. Where the two differ, this section wins for the product; the reference wins for any landing or onboarding page.

## Token mapping

The product already addressed colour through two families of Tailwind tokens. Rather than rewrite every screen, both families were re-pointed at the Hermes palette in `src/styles/agentos.css`, so the theme changes in one place.

| Reference | `--paper-*` / `--os-*` token | Value |
|-----------|------------------------------|-------|
| Hermes Paper | `paper-white`, `os-background` | `#f2f2f2` |
| Hermes Blue | `paper-blue`, `paper-amber`, `paper-gold`, `os-amber` (on paper) | `#0000f2` |
| Deep Ink | `paper-moss`, `os-foreground` | `#000091` |
| Ink 90 / 70 (body, muted) | `paper-char`, `paper-sage` | `#1d1d9d`, `#4949ae` |
| Control border | `paper-ash` | `#7474c0` (3.7:1) |
| Hairline | `paper-mist`, `os-border` | `#a9a9f2`, ink at 20% |
| Raised surfaces | `paper-linen`, `paper-stone`, `os-surface-raised` | `#e6e6f2`, `#dcdcf2` |
| Yellow Accent | `paper-marigold`, `os-amber` (on the blue stage) | `#f2f200` |
| Danger | `paper-flame-deep`, `os-danger` | `#b00020` |

The `paper-*` names are historical (the PostHog-derived Paper world this replaced). `paper-amber` is now blue and `paper-green` is now blue: names describe where a token is used, not what colour it is.

## The two grounds

- **The stage** is Hermes Blue. The top bar, sidebar and status bar carry the `os-stage` class, which redefines the tokens locally to paper-on-blue. Yellow is the accent there and only there.
- **The page** is Hermes Paper with Deep Ink text. Content never sits on blue. The reference alternates full-width colour bands as chapters; the product keeps one band (the chrome) and one page, because a working screen is read for hours.

## Rules for dense screens

- **Display sizes are capped.** Page titles are Roboto Condensed at weight 300, `clamp(2.25rem, 3.6vw, 3rem)`. The reference's 108px and 80px never appear in a list, table or log.
- **Headings are thin.** `.font-paper-display` is forced to 500 (and page `h1` to 300) in unlayered CSS so no screen carries its own idea of a heading. Nothing is 700 or heavier.
- **Body is Inter at 14–15px.** Condensed faces are for titles, tags and utility labels only.
- **Square by default.** Buttons, inputs, tags, chips and cards are 0px. The only rounded controls are the switch and status dots.
- **One primary action per view.** It is Hermes Blue with paper text. Secondary actions are outlined in blue.
- **Status is a word first.** The dot carries colour; the label carries meaning. There are no multicolour chips: tags are blue, ink, yellow-on-ink, or danger.
- **No shadows.** Hover lifts are a background change; press is `scale(0.98)`.

## Contrast (measured)

| Pair | Ratio |
|------|-------|
| Deep Ink on paper | 13.3 |
| Ink 90 on paper | 10.9 |
| Ink 70 on paper | 6.6 |
| Hermes Blue on paper | 8.2 |
| Paper on Hermes Blue | 8.2 |
| White on Hermes Blue (primary button) | 9.2 |
| Yellow on Hermes Blue | 7.7 |
| Deep Ink on yellow | 12.4 |
| Danger on paper | 6.5 |
| Muted paper (`#bdbdf2`) on Hermes Blue | 5.1 |
| Control border on paper | 3.7 |

The hairline (`#a9a9f2`, 1.9:1) is decoration only; it never marks the edge of a control.

## Typefaces

Roboto Condensed (display, utility) and Barlow Condensed (feature headings) stand in for the licensed Rules faces. Inter is body. IBM Plex Mono is commands and indices. Replace the first two once the Rules faces are licensed; nothing else changes.

## Not adopted from the reference

The engraved Hermes illustration, the landing hero, the terminal install block and the pricing grid are marketing artwork and content. AgentOS has no arrival screen that needs them yet, and the artwork needs rights. Build them from original AgentOS art if an onboarding screen is added.

---

## 28. Everyday OS information architecture (Step 59)

AgentOS organises around the operator's work, not around the agents doing it.

- **Sidebar:** `Today · Inbox`, then **Work** (`Workspaces` with pinned workspaces nested beneath, `Knowledge`, `Creative`), then **System** (`Automations · Operations · Activity`), with `Agents` and `Design system` as quiet footer links. The Hermes console and worker jobs are reached from Operations and from the work they belong to.
- **Vocabulary:** the primary UI says Today, attention, workspaces, tasks, documents, creative, inbox. Worktrees, diffs, runs, models and providers appear only once a person drills into technical work.
- **Workspaces** are a presentation of vault projects. Type (`Workspace type:`) and tabs (`Modules:`) live in `PROJECT.md → ## Configuration`; the type decides which tabs lead, never which exist — everything else is under More.
- **Agents surface in context:** on the task they hold (`Claude · Awaiting review · View`), not as a panel of their own.
- **Capture** is in every top bar (⌘⇧C) and never waits on a model.

`Markdown` takes `tone="paper"` on moved screens; the default `os` skin stays for screens still on the dark desk.
