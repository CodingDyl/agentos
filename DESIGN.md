# AgentOS — Quiet Terminal

> A calm personal command center with the precision of a code editor.

**Theme:** dark · **Density:** comfortable compact · **Status:** adopted. This file is the visual authority for all AgentOS UI.

This is an original AgentOS design direction. Refero's Linear, Vercel and Raycast references informed the research; this document is not an export of their systems. The accompanying generated image is a visual concept. This specification is authoritative for exact values, content, interaction and accessibility.

## Design intent

Make the next useful action obvious. Retain a coder's personality through keyboard shortcuts, precise alignment, technical metadata and an understated terminal mark. Personality should come from the tool's behavior and details rather than visual noise.

Replace the current green-black canvas, neon lime navigation, torn-paper headings and large decorative mascot with neutral graphite, a measured mint accent and a clear reading order. Keep the existing product capabilities and data. Reorganizing presentation must not silently remove routes or actions.

## Tokens — Colors

| Name | Value | CSS token | Role |
|---|---|---|---|
| Canvas | #111315 | --bg-canvas | Main workspace |
| Sidebar | #15181B | --bg-sidebar | Navigation and top bar |
| Panel | #1A1E22 | --bg-panel | Content surfaces |
| Raised | #22272D | --bg-raised | Menus, hover and nested inputs |
| Selected | #273B34 | --bg-selected | Selected navigation background |
| Divider | #30363D | --border-subtle | Nonessential structural lines |
| Control edge | #65717D | --border-control | Input and checkbox boundaries |
| Primary text | #EEF1F4 | --text-primary | Headings, task titles and values |
| Secondary text | #ACB5BF | --text-secondary | Descriptions, supporting labels |
| Muted text | #8E99A5 | --text-muted | Timestamps and secondary metadata |
| Mint | #9DDBBD | --accent | Primary action and selected indicator |
| Mint hover | #B4E6CE | --accent-hover | Primary action hover |
| Ink | #12231B | --on-accent | Text on mint buttons |
| Focus | #B0D6FF | --focus | Keyboard focus outline |
| Success | #9DDBBD | --status-success | Confirmed completion or availability |
| Warning | #E8C58A | --status-warning | Waiting, overdue or needs attention |
| Error | #F4A3A8 | --status-error | Failed execution or destructive result |

Use accent for one filled primary action per view, a small brand mark, and the selected navigation indicator. Use labelled semantic statuses where necessary. Avoid accent-colored headings, charts without data, glows and decorative gradients. Status must always include a word or icon, never color alone.

## Tokens — Typography

**UI:** Geist Sans; fallback Inter, system-ui, sans-serif. **Technical details:** Geist Mono; fallback JetBrains Mono, ui-monospace, monospace. Use locally available or properly loaded fonts; avoid layout shifts.

| Role | Family | Size / line height | Weight |
|---|---|---|---|
| Page heading | Sans | 28px / 36px | 600 |
| Section heading | Sans | 16px / 24px | 600 |
| Key value | Sans | 24px / 32px | 600 |
| Task title and body | Sans | 14px / 22px | 400–500 |
| Navigation and button | Sans | 14px / 20px | 500 |
| Supporting metadata | Sans | 13px / 20px | 400 |
| IDs, shortcuts, paths, runtime | Mono | 12px / 18px | 400 |

Use sentence case. Keep body tracking normal; headings may use -0.02em. Use tabular numerals for counts and financial values. Do not set whole paragraphs or task names in monospace. Avoid all-caps section banners and condensed display lettering.

## Tokens — Spacing & Shapes

- Base spacing: 4px. Scale: 4, 8, 12, 16, 20, 24, 32, 40, 48.
- Main page padding: 32px desktop, 24px tablet, 16px mobile.
- Panel padding: 24px; panel gap: 24px; task row padding: 16px.
- Radius: 10px panels, 6px inputs/buttons, 4px badges, 999px status dots only.
- Borders: 1px; no visible shadows on ordinary panels.
- Buttons and input controls: minimum 40px tall. Dense desktop navigation: 40px rows. Touch-oriented controls: minimum 44px.
- Icons: one consistent outline family, 18px, 1.5px stroke. No emoji as interface icons.

## Surfaces & Elevation

Canvas → panel → raised surface. Differentiate with tone and spacing before adding borders. Use a divider between task rows rather than a separate card for every row. Menus and dialogs may use a restrained shadow: 0 12px 36px rgba(0,0,0,.30). Avoid nested bordered boxes more than one level deep.

## Layout

### Desktop, 1280px and wider

Use a 224px fixed sidebar and a 56px top bar. Main content fills the remaining width with a 1440px maximum internal content width. Align all main content to one left edge.

Top bar: breadcrumb on the left; compact command search, Chat and neutral Capture controls on the right. Show `Hermes online` with a small labelled status dot. Plan the day is the primary mint button in the page header; Capture remains secondary on this view.

Header: `Dashboard`, followed by `Good morning, Dylan` and `Thursday, 5 November`. Put `Plan the day` and `Wrap up` at the right. Report friction stays in the page overflow menu, with a discoverable text label.

Follow with a compact four-cell summary strip: `11 tasks / 4 workspaces`, `No approvals waiting`, `Agents idle`, `Nothing to file`. These are functional links to their respective views, with hover and focus states.

Below it use a 7:5 grid, minimum column widths 480px and 340px:

1. Left: `Your three`, the dominant panel with three priority rows and a quiet completion count. Under it: `Primary focus`, showing AgentOS and its next action.
2. Right: `Morning brief`, a concise Hermes summary and three numbered actions, with `View full plan`. Under it: `To do today`, a two-item checklist and inline add control.
3. Full width below the work area: `Business pulse`, with revenue target, four overdue invoices, and pending pipeline counts. Include Send invoice and Follow up as neutral actions. The overdue item links to invoices; retain visible warning text.
4. Below the first viewport: compact Compass section with the existing goal and weekly intentions. Keep it accessible without competing with today's work.

An empty approvals panel becomes the summary strip's status plus a quiet `8 cleared` detail in its destination. When approvals actually need attention, insert a compact actionable queue above Your three. Do not reserve a large empty rectangle.

### Navigation

Brand: small mint `>_` mark and AgentOS wordmark. Dashboard and Inbox appear first. Keep Business, Work, Memory and Operations as expandable groups with existing destinations underneath. Use a subdued selected fill and 2px mint rail, not a neon full-width block. Pin Compass, settings and profile below. Keep counts neutral unless they represent actionable urgency. Preserve the microphone capture function in the Capture menu and command search.

### Responsive behavior

- 960–1279px: sidebar collapses to a 64px icon rail with labels available on focus/hover; main content becomes one column when the grid minimums cannot fit.
- Below 960px: one-column panels; priorities first, then morning brief, today's checklist, primary focus and business pulse. Summary uses a 2×2 grid.
- Below 640px: navigation moves into a labelled drawer; main actions wrap. Summary becomes stacked compact rows. Convert business metrics into vertical rows. Never hide required actions or introduce page-wide horizontal scrolling.
- Keep long titles wrapping; use ellipsis only for secondary metadata with an accessible full value.

## Components

### Priority task row

Use a neutral outlined rank badge, task title, one sentence explaining impact, and a quiet workspace label. Put Swap and its accessible label in a trailing menu. Preserve the current three tasks: Implement Google Auth; Follow up with Total Electric – Trusted Electricians; SEO: Missing meta description. Priority rows link to their tasks; completion and menus are separate controls, not nested buttons inside a link.

### Morning brief

Header `Morning brief`, metadata `Hermes · 07:31`, neutral Run again action. Main summary: `Establish the foundational structure of AgentOS.` List the existing three actions involving projects/PORTFOLIO.md, me/MEMORY_POLICY.md, and me/PROFILE.md plus me/GOALS.md. Render only file paths in mono. Keep `If there's time` and `Avoid` in the expanded plan. Regeneration has visible loading, failure and retry states; it must not erase the previous plan on failure.

### Buttons and inputs

Primary: mint background, ink text, 6px radius, 12–16px horizontal padding, 14px/500 label. Secondary: raised or transparent neutral surface and readable text. Destructive: explicit verb plus error treatment, isolated from routine actions. Inputs use raised fill, visible control-edge border and persistent labels. Placeholder is supplemental.

### Checklist and empty states

Unchecked boxes need visible control-edge strokes. Completed rows show checked icon and readable completion state. Enter submits a new item; Escape cancels editing. Empty state: one concise sentence and an action only when useful. Never show invented activity, fake graphs or placeholder performance numbers.

### Command palette

Expose a visible search trigger with platform-appropriate Cmd K or Ctrl K hint. Search routes, workspaces, tasks and commands. Show type labels, arrow-key navigation, Enter activation and Escape dismissal. Trap focus while open and restore it to the trigger. Shortcuts must not interfere with text input.

### Runtime footer

Keep a low-contrast 28px status bar for `Agents idle`, `Context / AgentOS` and model metadata. Use mono sparingly. Show actual execution state; no permanent pulsing cursor or animated dots when idle. If model/context metadata is unavailable, omit the value rather than inventing it.

## Interaction & Accessibility

- Target WCAG AA: at least 4.5:1 for normal text, 3:1 for large text and essential non-text UI. Validate actual rendered combinations, including hover and selected states; token choice alone is not certification.
- Structural dividers may be subtle; essential controls use the stronger control-edge token.
- Focus: 2px focus-color outline with 2px offset, visible on every surface. Keep it distinct from selection.
- Label all icon controls. Provide landmarks, heading order and a skip-to-content link.
- Preserve logical keyboard order. No hover-only actions. Announce capture, completion and agent state changes through restrained live regions.
- Motion: 120–160ms color/opacity transitions only; respect prefers-reduced-motion. No decorative looping animation.
- Loading: stable-size skeletons or labelled progress. Errors include a useful retry action. Dangerous actions require an appropriate confirmation or undo.

## Do's and Don'ts

**Do:** prioritize today's work; preserve readable contrast; use technical details as subtle identity; keep recurring controls in consistent places; show meaningful empty, loading, error and busy states.

**Don't:** use ripped-paper labels, sticker graphics, a large dashboard mascot, neon blocks, colored panel borders, gradients, glass blur, decorative charts, tiny low-contrast body text or a terminal font everywhere.

## Agent Prompt Guide

Implement the AgentOS Quiet Terminal system using the exact tokens above. Preserve existing routes, data and business logic. Replace presentational components incrementally: shell and tokens first, navigation and typography second, priority layout third, then secondary panels. Do not add dependencies solely for decorative effects. Map semantic CSS tokens into the project's current styling approach.

The first viewport must answer: what matters today, what needs my approval, and what Hermes recommends next. Match the proposed desktop composition while honoring actual application state. Never turn the workspace into a marketing landing page.

Acceptance: all current destinations and capture modes remain reachable; real task and financial data survive; blank approvals do not consume a large panel; the page works at 1440, 1024, 768 and 390px; keyboard users can capture, search, open tasks, edit the checklist and reach approvals; text and essential controls pass contrast checks; no content is clipped at 200% zoom.

## Research references

- Linear on Refero: https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1 — primary aesthetic reference; my fit rating: 9/10.
- Vercel on Refero: https://styles.refero.design/style/f24daf3a-d43f-4dec-85a9-8ac1d5148a03 — typography and technical-detail reference; my fit rating: 8/10.
- Raycast on Refero: https://styles.refero.design/style/3b6a17f0-3bdf-418c-a95e-0b89e5a8b2f8 — command-oriented character reference; my fit rating: 8/10.

Research reviewed 5 November 2026. Refero's entries describe interpreted website styles, not official application specifications. The section organization follows its useful token/component/guideline pattern; all AgentOS layout, interaction and palette choices here are custom recommendations.

---

# AgentOS implementation

Everything above is the specification. This section records how the code applies it. Names, counts and tasks quoted above (`11 tasks / 4 workspaces`, `Implement Google Auth`, `Hermes · 07:31`) are illustrations; every screen renders real data.

## Where values live

`src/styles/agentos.css` is the one place a value enters the code. It declares the semantic tokens above, then gives the older names to components as aliases. An alias never has a value of its own.

| Token | Alias a screen may use |
|---|---|
| `--bg-canvas` | `paper-desk`, `os-background`, `background` |
| `--bg-sidebar` | `.os-stage` |
| `--bg-panel` | `paper-white`, `os-surface`, `card` |
| `--bg-raised` | `paper-cream`, `paper-linen`, `os-surface-raised`, `popover` |
| `--bg-selected` | `selected` |
| `--border-subtle` | `paper-mist`, `paper-stone`, `os-border`, `os-surface-active`, `border` |
| `--border-control` | `paper-ash`, `paper-gold`, `os-border-strong`, `input` |
| `--text-primary` | `paper-moss`, `paper-blue`, `paper-amber-deep`, `os-foreground`, `os-amber`, `foreground` |
| `--text-secondary` | `paper-char`, `paper-amber`, `os-muted` |
| `--text-muted` | `paper-sage`, `os-subtle` |
| `--accent`, `--on-accent` | `primary`, `primary-foreground` |
| `--status-success` | `paper-green`, `os-success` |
| `--status-warning` | `paper-marigold`, `os-warning` |
| `--status-error` | `paper-flame`, `paper-flame-deep`, `os-danger`, `destructive` |

The `paper-*` and `os-*` names are historical and describe a role, not a colour: `paper-blue` is primary text, and links and progress are neutral because mint is rationed. Use the alias a file already uses; use a semantic token in new CSS.

## Shared pieces

- **Shell:** `src/components/os/app-shell.tsx`. Its three modes (`drawer` below 640px, `rail` to 1279px, `full` above) match `.qt-shell`. Between 640 and 959px the specification names no change, so the rail continues.
- **Page frame and panel:** `PaperStage` and `PaperSection` in `src/components/paper/paper.tsx`, or `.qt-page` and `.qt-panel`.
- **Controls:** `PaperButton` (`amber` is the filled primary, `ghost` secondary, `quiet` transparent, `danger` destructive), `CommandButton`, `PAPER_INPUT`, `Tag`.
- **Menus:** `ActionMenu` and `ActionMenuItem` in `src/components/os/menu.tsx`.
- **Waiting:** `PageLoader`, a labelled line at a stable height.
- **Type:** arbitrary sizes are limited to 12 (mono only), 13, 14, 16, 24 and 28px. `.os-meta` is supporting metadata in sans; `.os-mono` is for what a machine named.

## Decisions the specification left open

- **Capture is a split control.** The main half opens the note form at once, because capture must never wait on a menu. The chevron holds Note, Voice, Jarvis text and Quick create. The voice control appears in the top bar only while Jarvis is busy.
- **Settings and profile** are named in Navigation, but AgentOS has no such routes. They are left out rather than drawn as dead links. Add them to `footer` in `src/config/navigation.ts` when those screens exist.
- **Model metadata** in the status bar appears only where a screen knows the model in use.
- **Compass** keeps its areas and measured goals beside the goal and weekly intentions.

## Contrast (computed from the tokens)

| Pair | Ratio |
|---|---|
| Primary text on canvas | 16.4 |
| Primary text on panel | 14.8 |
| Primary text on raised | 13.3 |
| Primary text on selected | 10.5 |
| Secondary text on panel | 8.1 |
| Secondary text on selected | 5.7 |
| Muted text on panel | 5.8 |
| Muted text on raised | 5.2 |
| Muted text on selected (fails; not used) | 4.1 |
| Ink on mint | 10.4 |
| Control edge on panel (non-text) | 3.4 |
| Warning on panel | 10.2 |
| Error on panel | 8.5 |
| Focus on canvas | 12.3 |

Muted text falls below AA on the Selected fill, so selected states use primary or secondary text. Hover fills that use the divider colour only ever carry primary text.

Checked by `src/components/os/__tests__/design-tokens.test.ts`, which reads the values from `agentos.css`.

---

# Information architecture

AgentOS organises around the operator's work, not around the agents doing it.

- **Sidebar:** `Dashboard · Inbox`, then the expandable groups **Business**, **Work**, **Memory** and **Operations**, with Compass pinned below. `src/config/navigation.ts` is the list. The Hermes console and worker jobs are reached from Operations and from the work they belong to.
- **Vocabulary:** the primary UI says dashboard, attention, workspaces, tasks, documents, creative, inbox. Worktrees, diffs, runs, models and providers appear only once a person drills into technical work.
- **Workspaces** are a presentation of vault projects. Type (`Workspace type:`) and tabs (`Modules:`) live in `PROJECT.md → ## Configuration`; the type decides which tabs lead, never which exist. Everything else is under More.
- **Agents surface in context:** on the task they hold (`Claude · Awaiting review · View`), not as a panel of their own.
- **Capture** is in every top bar (⌘⇧C) and never waits on a model.
