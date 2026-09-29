# AgentOS — Design System

> **Style:** Editorial Terminal  
> **Purpose:** A premium, focused control surface for Dylan's personal Agentic OS — combining the warm terminal atmosphere of Hermes with disciplined editorial typography, hairline structure, and minimal UI chrome.

---

## 1. Design Intent

AgentOS should feel like a **serious personal command center**, not a generic SaaS dashboard.

The interface should communicate:

- Focus
- Intelligence
- Calm
- Precision
- Technical confidence
- Minimal friction

The visual language should be dark, architectural, and restrained. Typography, spacing, borders, and status indicators should create hierarchy. Avoid decoration that does not help the user act.

### Core Principle

> **Clarity over decoration. Focus over density. Intelligence over novelty.**

---

## 2. Visual Direction

AgentOS combines:

### Hermes-inspired atmosphere
- Deep teal / near-black canvas
- Warm cream foreground
- Sparse amber glow
- Subtle terminal/system feel
- Low-key grain / texture

### Editorial UI discipline
- Regular-weight typography
- Large quiet headings
- Mono metadata and labels
- Hairline borders
- Minimal surface fills
- No drop shadows
- Small radii
- Strong spacing rhythm

### Avoid
- Generic SaaS cards
- Glassmorphism
- Heavy gradients
- Neon cyberpunk styling
- Excessive rounded corners
- Multiple competing accent colors
- Dense dashboards
- Decorative animations

---

## 3. Color Tokens

### Core

| Token | Value | Usage |
|---|---|---|
| `--os-background` | `#041C1C` | Main application canvas |
| `--os-surface` | `#062322` | Cards, panels, sidebar sections |
| `--os-surface-raised` | `#082827` | Elevated overlays and active surfaces |
| `--os-foreground` | `#FFE6CB` | Primary text |
| `--os-muted-foreground` | `#A7B7B1` | Secondary text |
| `--os-subtle-foreground` | `#7A8F8A` | Metadata, tertiary text |

### Structure

| Token | Value | Usage |
|---|---|---|
| `--os-border` | `rgba(255,230,203,0.12)` | Default hairline border |
| `--os-border-strong` | `rgba(255,230,203,0.22)` | Active / emphasized border |

### Signals

| Token | Value | Usage |
|---|---|---|
| `--os-amber` | `#FFBD38` | Agent activity, focus, selected commands |
| `--os-success` | `#8FC89A` | Healthy / complete / active states |
| `--os-warning` | `#FFBD38` | Attention required |
| `--os-danger` | `#D96B5F` | Blocked / error / destructive states |

### Accent Rules

- Amber is **not** the default CTA color.
- Use color primarily in **small indicators**, never large decorative fills.
- Primary actions should generally use cream-on-teal or teal-on-cream contrast.
- Do not introduce additional accent colors unless the system genuinely needs them.

---

## 4. Typography

### Primary UI Typeface

**Inter**

Use for:
- Display headings
- Navigation
- Body text
- Buttons
- Project titles
- Agent responses

### System / Metadata Typeface

**IBM Plex Mono**

Use for:
- Status labels
- Model names
- Branch names
- Timestamps
- System metadata
- Small section labels
- Command labels

### Type Scale

| Role | Size | Weight | Line Height | Notes |
|---|---:|---:|---:|---|
| Display | 48–64px | 400 | 0.98–1.05 | Major home/dashboard statements |
| Page Heading | 32px | 400 | 1.05 | Screen title |
| Section Heading | 22px | 400 | 1.15 | Major sections |
| Card Heading | 16px | 400/500 | 1.25 | Project / panel titles |
| Body | 15px | 400 | 1.5 | Default body copy |
| Small | 13px | 400 | 1.45 | Secondary content |
| Meta | 11px | 400 | 1.4 | IBM Plex Mono, uppercase |

### Typography Rules

- Prefer `400` weight for headings.
- Use size and spacing for hierarchy before weight.
- Avoid `font-bold` unless emphasis is genuinely required.
- Display headings should use slightly negative tracking.
- Meta labels should use uppercase + wide tracking.
- Keep body copy warm and muted rather than pure white.

---

## 5. Spacing

### Base Unit

`4px`

### Preferred Scale

- `4px`
- `8px`
- `12px`
- `16px`
- `20px`
- `24px`
- `32px`
- `40px`
- `48px`
- `64px`

### Application Rhythm

- Page horizontal padding: `32–48px`
- Sidebar item gap: `8–12px`
- Card padding: `20–24px`
- Major section gap: `32–48px`
- Dashboard content max width: `1400px`
- Avoid large marketing-site style whitespace inside functional app screens.

---

## 6. Geometry

| Element | Radius |
|---|---:|
| Small badges | `4px` |
| Inputs | `6px` |
| Cards | `8px` |
| Panels / dialogs | `10–12px` |
| Primary pill action | `9999px` |

### Rules

- Cards should never look soft or bubbly.
- Most UI should stay within `4–8px`.
- Pill radius is reserved for high-priority actions or compact status controls.
- No drop shadows.

---

## 7. Surfaces & Elevation

Elevation is created using:

1. Surface contrast
2. Hairline borders
3. Spacing
4. Typography

Not shadows.

### Levels

#### Level 0 — Canvas
`#041C1C`

#### Level 1 — Surface
`#062322`

#### Level 2 — Raised Surface
`#082827`

#### Structural Border
`rgba(255,230,203,0.12)`

### Rule

> If a component requires a shadow to feel separated, first improve its border, spacing, or surface contrast.

---

## 8. Background Treatment

The default application background may use a very subtle warm radial glow:

```css
background:
  radial-gradient(
    circle at 55% -10%,
    rgba(255, 189, 56, 0.08),
    transparent 32%
  ),
  #041c1c;
```

Optional blueprint grid:

```css
background-image:
  linear-gradient(rgba(255,230,203,0.016) 1px, transparent 1px),
  linear-gradient(90deg, rgba(255,230,203,0.016) 1px, transparent 1px);

background-size: 32px 32px;
```

Use sparingly. The grid is atmosphere, not structure: at full-workday exposure
it must stay below the threshold where it reads as a layout guide. Content
should remain dominant.

---

## 9. Iconography

Use **Lucide Icons**.

### Style
- 1.5px stroke
- No fill
- 16–20px for standard controls
- 24px for primary visual elements

### Color
- Cream for default icons
- Muted foreground for inactive icons
- Amber for active agent/system activity
- Success / danger only for true semantic states

Avoid multicolor iconography.

---

## 10. Application Shell

### Layout

```text
┌────────────────────────────────────────────────────────────┐
│ AGENT / OS                                      ● ONLINE   │
├───────────────┬────────────────────────────────────────────┤
│               │                                            │
│ HOME          │                                            │
│ PROJECTS      │              MAIN CONTENT                  │
│ DESIGNS       │                                            │
│ AGENT         │                                            │
│               │                                            │
├───────────────┴────────────────────────────────────────────┤
│ HERMES ● CONNECTED                        MODEL / STATUS    │
└────────────────────────────────────────────────────────────┘
```

### Sidebar

Primary navigation:

- Home
- Projects
- Designs
- Agent

Secondary/system navigation later:

- Areas
- Memory
- Settings

### Sidebar Rules

- Fixed width: approximately `220–240px`
- Hairline right border
- No large filled navigation blocks
- Active item may use:
  - subtle surface fill
  - cream foreground
  - amber 2px indicator or dot

---

## 11. Top System Bar

Show:

- `AGENT / OS`
- System state
- Hermes connectivity
- Optional current model
- Optional workspace / project context

Example:

```text
AGENT / OS                              ● HERMES ONLINE
```

Use IBM Plex Mono for metadata.

---

## 12. Core Components

### 12.1 Hairline Card

Default structural container.

```text
┌──────────────────────────────────┐
│ PROJECT                          │
│                                  │
│ Pantry Pilot          ● ACTIVE   │
│ Production refinement            │
└──────────────────────────────────┘
```

Style:

```css
border: 1px solid var(--os-border);
border-radius: 8px;
background: rgba(6, 35, 34, 0.55);
```

No shadow.

---

### 12.2 Project Card

Contains:

- Project name
- State
- Priority
- Short current status
- Optional next action

Avoid large descriptive paragraphs.

---

### 12.3 Status Pill

Format:

```text
● ACTIVE
● RUNNING
● PAUSED
● BLOCKED
● INCUBATING
```

Only the dot should usually carry semantic color.

#### Suggested states

| State | Dot |
|---|---|
| Active | Success |
| Running | Amber |
| Healthy | Success |
| Paused | Muted |
| Incubating | Muted |
| Blocked | Danger |
| Attention | Warning |

---

### 12.4 Primary Button

Example:

```text
START SESSION →
```

Style:
- Cream background
- Deep teal text
- Pill radius
- No shadow
- 13–14px text
- Medium horizontal padding

---

### 12.5 Secondary Button

Example:

```text
PROJECT SYNC
```

Style:
- Transparent
- Hairline border
- Cream text
- 6–8px radius
- Hover → raised surface

---

### 12.6 Section Label

Example:

```text
CURRENT FOCUS
PROJECTS
RECENT ACTIVITY
SYSTEM
```

Style:
- IBM Plex Mono
- 11px
- uppercase
- tracking `0.08em`
- muted foreground

---

### 12.7 Agent Command Input

This is one of the most important controls in the system.

Example:

```text
┌─────────────────────────────────────────────────┐
│ > Ask Hermes or run a command...                │
└─────────────────────────────────────────────────┘
```

Requirements:

- Calm, terminal-like
- No oversized chatbot bubble styling
- Shows slash command suggestions
- Can later show active project context
- Supports streaming agent output
- Supports approval / reject actions

---

### 12.8 Agent Activity

Example:

```text
● RUNNING

✓ Read Pantry Pilot context
✓ Checked Git
✓ Checked GitHub
○ Analysing active task
```

Rules:
- Amber indicates current activity
- Completed steps use success or cream
- Avoid spinners when a meaningful status can be shown

---

### 12.9 Empty State

Keep empty states simple.

Example:

```text
NO CAPTURED IDEAS

Your inbox is clear.
```

Do not use illustrations unless they serve a real purpose.

---

## 13. Dashboard Structure

The Home screen should prioritise:

### 1. Main Focus
The single most important outcome.

### 2. Next Action
One concrete action.

### 3. Today
Calendar / time constraints.

### 4. Active Projects
Only high and medium priority projects.

### 5. Recent Progress
One concise summary.

### 6. Watch
One blocker or risk.

Avoid turning the dashboard into a reporting screen.

---

## 14. Projects Screen

### Project List

Show:

- Name
- State
- Priority
- Short status
- Last activity

### Project Detail Tabs

Recommended:

- Overview
- Tasks
- Decisions
- Sessions
- Git

Do not surface every AgentOS file directly.

The UI should translate AgentOS structure into usable product concepts.

---

## 15. Designs Screen

Designs are filesystem-backed initially.

Suggested project structure:

```text
designs/
├── screenshots/
├── references/
├── NOTES.md
└── BRIEF.md
```

The interface should support:

- Screenshot gallery
- Add screenshot
- Reference gallery
- Design notes
- Review with AI

Longer term:
- Compare design vs implementation
- Generate design critique
- Create implementation ticket from selected design

---

## 16. Agent Screen

The Agent screen should feel like an **operator console**, not a generic chat app.

### Recommended layout

- Conversation thread
- Command input
- Quick actions
- Agent run state
- Approval controls
- Current project context

### Quick Actions

- Start Day
- Dashboard
- Capture
- Work On
- Stop Work
- Project Sync

Do not expose every skill as a permanent button.

---

## 17. Motion

Motion should communicate state rather than decorate.

### Use
- 120–180ms hover transitions
- subtle opacity
- small translate movements
- status pulse for live agent activity

### Avoid
- springy cards
- bouncing icons
- large entrance animations
- parallax
- animated gradients

---

## 18. Interaction Rules

### Hover
- Slight surface lift via background tone
- Border may strengthen
- No shadow

### Active
- Cream text
- Stronger border
- Amber indicator only where meaningful

### Focus
- Amber focus ring
- Keyboard accessibility required

### Disabled
- Reduced foreground opacity
- Preserve readable contrast

---

## 19. Accessibility

- Maintain WCAG AA contrast wherever possible.
- Never rely on color alone for state.
- All interactive controls require keyboard focus styles.
- Agent status must include text, not only dots.
- Minimum pointer target around `36–40px`.

---

## 20. Do

- Use typography for hierarchy.
- Use borders as structure.
- Keep cards sparse.
- Keep copy concise.
- Show the next action clearly.
- Use amber sparingly.
- Prefer mono labels for machine/system metadata.
- Keep components visually quiet.
- Make the interface feel like one coherent control system.

---

## 21. Don't

- Do not add drop shadows.
- Do not use large gradients as decoration.
- Do not use glassmorphism.
- Do not create large pill-shaped cards.
- Do not use bold headings everywhere.
- Do not turn every piece of data into a card.
- Do not introduce new accent colors casually.
- Do not overfill dashboard screens.
- Do not make AgentOS look like Jira, Notion, or a generic AI chatbot.

---

## 22. Tailwind / CSS Tokens

```css
:root {
  color-scheme: dark;

  --os-background: #041c1c;
  --os-surface: #062322;
  --os-surface-raised: #082827;

  --os-foreground: #ffe6cb;
  --os-muted-foreground: #a7b7b1;
  --os-subtle-foreground: #7a8f8a;

  --os-border: rgba(255, 230, 203, 0.12);
  --os-border-strong: rgba(255, 230, 203, 0.22);

  --os-amber: #ffbd38;
  --os-success: #8fc89a;
  --os-warning: #ffbd38;
  --os-danger: #d96b5f;

  --os-radius-sm: 4px;
  --os-radius-md: 8px;
  --os-radius-lg: 12px;

  --background: #041c1c;
  --foreground: #ffe6cb;

  --card: #062322;
  --card-foreground: #ffe6cb;

  --popover: #082827;
  --popover-foreground: #ffe6cb;

  --primary: #ffe6cb;
  --primary-foreground: #041c1c;

  --secondary: #0a2b2a;
  --secondary-foreground: #ffe6cb;

  --muted: #092625;
  --muted-foreground: #a7b7b1;

  --accent: #103432;
  --accent-foreground: #ffe6cb;

  --destructive: #d96b5f;

  --border: rgba(255, 230, 203, 0.12);
  --input: rgba(255, 230, 203, 0.16);
  --ring: #ffbd38;

  --radius: 0.5rem;
}
```

---

## 23. Component Directory

Build reusable AgentOS primitives under:

```text
src/components/os/
├── app-shell.tsx
├── page-header.tsx
├── section-label.tsx
├── hairline-card.tsx
├── project-card.tsx
├── status-pill.tsx
├── command-button.tsx
├── system-indicator.tsx
├── agent-command-input.tsx
└── agent-activity.tsx
```

shadcn components remain implementation primitives.  
AgentOS components define the actual product visual language.

---

## 24. Initial Screens

V1:

1. `/design-system`
2. `/`
3. `/projects`
4. `/projects/:project`
5. `/designs`
6. `/agent`

Build `/design-system` first.

Do not begin full screen implementation until core tokens and reusable components are visually approved.

---

## 25. Definition of Done — Design System

The design system is considered ready when:

- Core palette is implemented.
- Inter + IBM Plex Mono are configured.
- Typography scale is implemented.
- Border / surface system is consistent.
- Primary and secondary buttons are implemented.
- Status pill is implemented.
- Hairline card is implemented.
- Section label is implemented.
- Input styles are implemented.
- System indicator is implemented.
- `/design-system` visually demonstrates all primitives.
- Light mode is not required.
- No page-specific styling bypasses the design system without a reason.

---

## 26. Product Design Principle

> **AgentOS should reduce cognitive load, not display how much information it knows.**

Every screen should make the next useful action obvious.

---

## 27. Paper — the migration world (in progress)

AgentOS is moving, one screen at a time, from Editorial Terminal to **Paper**, a world derived from PostHog's desktop-OS style: a document opened on a sandy desk. Everything above still governs every screen that has not moved. As of 2026-09-25 these have moved: **Inbox** (formerly Mail; scoped trial, `src/styles/mail.css`), **Operations** including its agent detail page and System tab, and — with Step 59 — **Workspaces**, **Knowledge**, and the **workspace page's header, tabs, Overview and Clients tab**. **Automations** (list and job detail) and **Today** moved on 2026-09-28. **Activity** moved on 2026-09-29. **Finance** (Step 61) was built on Paper from the start: it has never existed in Editorial Terminal. A workspace's working tabs (Tasks, Roadmap, Documents, Repository, …) have not moved yet: they sit on the dark desk directly beneath the paper header. The application shell (sidebar, top bar, status bar) stays in Editorial Terminal until the migration reaches it.

### Tokens

Declared in `src/styles/agentos.css` as `--paper-*` and exposed to Tailwind as `paper-*` utilities (`bg-paper-desk`, `text-paper-moss`, `border-paper-mist`, …).

| Role | Token | Value |
|------|-------|-------|
| Desk (reserved; no screen uses it as a canvas now) | `paper-desk` | `#e1d7c2` |
| Page / card | `paper-white` | `#ffffff` |
| Secondary surface, hover | `paper-cream` / `paper-linen` / `paper-stone` | `#fdfdf8` / `#eeefe9` / `#e5e7e0` |
| Text: primary / body / muted | `paper-moss` / `paper-char` / `paper-sage` | `#23251d` / `#4d4f46` / `#65675e` |
| Decorative only (fails AA as text) | `paper-ash` | `#9ea096` |
| Hairline | `paper-mist` | `#bfc1b7` |
| Primary action (one per view) | `paper-amber` → hover `paper-amber-deep` | `#eb9d2a` → `#cd8407` |
| Outline-action border | `paper-gold` | `#b17816` (border only; its text fails AA) |
| Active tab, live links, focus ring | `paper-blue` | `#2f80fa` |
| Tags and warnings, as text or tag fill | `paper-flame-deep` | `#c43d00` (raw `paper-flame` `#f54e00` for non-text fills only) |
| Confirmation | `paper-green` | `#6aa84f` (dark text on it, never white) |

Faces: `font-paper-display` is Inter Tight Variable (headings and numerals), standing in for Open Runde. `font-paper-ui` is IBM Plex Sans (UI and body). Mono is used only for filenames and configuration values.

### Rules

- A moved screen is **the page itself**: white edge to edge beside the dark shell, with content held to the same 1400px measure as other pages. Operations and Mail both dropped the framed window and title bar (2026-09-24). Cards, inputs and buttons use 4px corners. Pills are for tags only.
- **No shadows.** Elevation comes from the surface stack (desk → linen → cream → white) and hairlines. Cards are never nested inside cards.
- One **amber** primary action per view. Secondary actions are outlined in gold with dark labels.
- Tabs: sage when idle; active is signal blue with a 2px underline sitting on a 1px inset hairline.
- Headings: display face, 800 weight, tracking no tighter than -0.015em. Inter Tight's word space collapses below that.
- Figures keep Operations' honesty rules: an unknown is `—` in sage, an estimate carries `~`, and nothing unpriced is shown as `$0`.

### Components (`src/components/paper/paper.tsx`, promoted from Operations in Step 59)

`PaperStage` (the full white page), `PaperSection`, `PaperCard`, `PaperButton` (amber / ghost / quiet), `Tag`, `SegmentedControl`, `PaperTabs`, `Meter` (a single share), `StackedMeter` (parts of a whole with a legend, used instead of a pie), `RadialMeter` (a beaded track with a solid arc, number and word), `Sparkline`, `PaperSwitch`, `PAPER_INPUT`, `FieldLabel`. Page furniture lives beside them in `paper-states.tsx`: `PaperPageHeader`, `PaperFilterBar`, `PaperLoading`, `PaperEmpty`, `PaperError`, `PaperNotice`. These replace `PageHeader`, `FilterBar`, `LoadingState`, `EmptyState` and `ErrorState` from `components/os` as each screen moves.

### Motion

There is one authored moment. Meters, rings and the spend line draw from empty on arrival, over 700–1000ms with an ease-out of `cubic-bezier(0.16,1,0.3,1)`, animating transform, stroke-dashoffset or clip-path only. Under reduced motion none of it animates. Hover transitions are 150ms colour changes.

## 28. Everyday OS information architecture (Step 59)

AgentOS organises around the operator's work, not around the agents doing it.

- **Sidebar:** `Today · Inbox`, then **Work** (`Workspaces` with pinned workspaces nested beneath, `Knowledge`, `Creative`), then **System** (`Automations · Operations · Activity`), with `Agents` and `Design system` as quiet footer links. The Hermes console and worker jobs are reached from Operations and from the work they belong to.
- **Vocabulary:** the primary UI says Today, attention, workspaces, tasks, documents, creative, inbox. Worktrees, diffs, runs, models and providers appear only once a person drills into technical work.
- **Workspaces** are a presentation of vault projects. Type (`Workspace type:`) and tabs (`Modules:`) live in `PROJECT.md → ## Configuration`; the type decides which tabs lead, never which exist — everything else is under More.
- **Agents surface in context:** on the task they hold (`Claude · Awaiting review · View`), not as a panel of their own.
- **Capture** is in every top bar (⌘⇧C) and never waits on a model.
