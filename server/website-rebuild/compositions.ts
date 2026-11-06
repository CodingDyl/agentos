/**
 * What a hero is built like, apart from how it looks: its composition, its
 * navigation and its motion. Assigned per concept alongside the art direction.
 *
 * A direction alone gave every concept the same skeleton in another colour
 * (small label, headline left, one button, a box on the right, logo left and
 * links right). These axes are what make three concepts different pages, and
 * each composition and navigation says how a browser can tell it was delivered,
 * so the check is a measurement rather than a model's opinion.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What AgentOS measures on a rendered hero. Everything is in CSS pixels. */
export interface HeroMetrics {
  viewport: { width: number; height: number };
  h1?: { text: string; words: number; px: number; family: string; rect: Rect };
  /** Faces the page really loaded, and whether the headline and body render in one of them. */
  fonts: { loaded: string[]; headlineLoaded: boolean; bodyLoaded: boolean };
  /** Requests that left the page's own files. A concept must not make any. */
  remoteRequests: string[];
  errors: string[];
  overflowX: boolean;
  /** Share of the first viewport covered by images, video, canvas and large SVG. */
  mediaCoverage: number;
  media: (Rect & { kind: string })[];
  canvasCoverage: number;
  /** Rows or panels marked data-hero-row in the first viewport. */
  rows: Rect[];
  /** The element marked data-intake, with how many choices it offers. */
  intake?: { choices: number; rect: Rect };
  /** Something wider than the viewport: a moving band of type. */
  wideBand: boolean;
  logo?: Rect;
  navLinks: Rect[];
  cta?: Rect;
  /** Animations seen in the first moments, CSS or GSAP. */
  motionSeen: boolean;
  /** A coarse occupancy map of text (t), media (m) and empty (.), row by row. */
  skeleton: string;
}

const area = (rect: Rect) => rect.width * rect.height;
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

export type CompositionFamily = "image" | "type" | "interaction";

export interface Composition {
  id: string;
  name: string;
  family: CompositionFamily;
  /** What the worker builds. */
  brief: string;
  /** Live sites that do something like this well. Studied for how they work, never copied. */
  references: readonly { label: string; url: string }[];
  /** Why a rendered desktop hero is not this composition, or undefined when it is. */
  check: (metrics: HeroMetrics) => string | undefined;
}

export const COMPOSITIONS: readonly Composition[] = [
  {
    id: "full-bleed-lower-third",
    name: "Full-bleed, lower third",
    family: "image",
    brief: "One image, film or canvas fills the whole first viewport edge to edge. The headline sits low, over the image, in the bottom part of the screen. The picture does the persuading; there is no panel behind the text.",
    references: [{ label: "DRPB, Swiss law firm", url: "https://drpb.ch/" }, { label: "2SPL Patent Attorneys", url: "https://2spl.de" }, { label: "Walker Art Center", url: "https://walkerart.org" }],
    check: (m) => {
      if (m.mediaCoverage < 0.6) return `the image covers ${percent(m.mediaCoverage)} of the first screen; this composition fills it`;
      if (m.h1 && m.h1.rect.y + m.h1.rect.height / 2 < m.viewport.height * 0.5) return "the headline sits in the top half; this composition sets it low";
      return undefined;
    },
  },
  {
    id: "object-on-stage",
    name: "Object on a stage",
    family: "image",
    brief: "A single subject, a photographed or generated object, sits near the centre of a mostly empty stage, with one light source. Text is small and precise and sits away from the object. The emptiness is the luxury.",
    references: [{ label: "Joseph Law", url: "https://www.forthetimes.law" }, { label: "teenage engineering", url: "https://teenage.engineering" }],
    check: (m) => {
      const main = largest(m.media);
      if (!main) return "there is no main image to put on the stage";
      if (m.mediaCoverage > 0.75) return "the image fills the screen, so there is no stage around the object";
      const centre = main.x + main.width / 2;
      if (centre < m.viewport.width * 0.28 || centre > m.viewport.width * 0.72) return "the object is off to one side; this composition keeps it near the centre";
      if (m.h1 && m.h1.px > 96) return `the headline is ${Math.round(m.h1.px)}px and competes with the object`;
      return undefined;
    },
  },
  {
    id: "offset-overlap",
    name: "Offset overlap",
    family: "image",
    brief: "A large image placed off-grid, with the headline physically overlapping its edge so type and picture form one shape. Neither sits in a column of its own.",
    references: [{ label: "Ario Law Firm", url: "https://ario.law/en/" }, { label: "Kinfolk", url: "https://www.kinfolk.com" }],
    check: (m) => {
      const main = largest(m.media);
      if (!main) return "there is no main image for the headline to overlap";
      if (m.h1 && overlap(m.h1.rect, main) < area(m.h1.rect) * 0.08) return "the headline does not overlap the image";
      return undefined;
    },
  },
  {
    id: "diptych",
    name: "Edge-to-edge diptych",
    family: "image",
    brief: "Two full-height halves with no margin. The image takes the left half, flush to the top, bottom and left edges; the words take the right half with their own colour field. A hard vertical seam, not a picture in a column.",
    references: [{ label: "Collins", url: "https://www.wearecollins.com" }, { label: "Mersi Architecture", url: "https://mersi-architecture.com" }],
    check: (m) => {
      const main = largest(m.media);
      if (!main) return "there is no image for the left half";
      if (main.x > 8) return "the image does not touch the left edge";
      if (main.height < m.viewport.height * 0.8) return "the image is not full height";
      if (main.width < m.viewport.width * 0.35 || main.width > m.viewport.width * 0.65) return "the image is not close to half the width";
      return undefined;
    },
  },
  {
    id: "living-field",
    name: "Living field",
    family: "image",
    brief: "A full-bleed <canvas> (WebGL or 2D) draws a generative field that responds slowly to the pointer: a material, a contour map, a grain of light. Words sit on it. It must mean something for this client and have a still fallback when motion is reduced.",
    references: [{ label: "Lusion", url: "https://lusion.co" }, { label: "Obys", url: "https://obys.agency" }],
    check: (m) => (m.canvasCoverage < 0.6 ? `a canvas covers ${percent(m.canvasCoverage)} of the first screen; this composition fills it` : undefined),
  },
  {
    id: "type-monument",
    name: "Type monument",
    family: "type",
    brief: "The headline is the image: enormous, running nearly edge to edge, and locked to the page by exact alignment. Everything else is small and sits in the margins of the type.",
    references: [{ label: "Darkroom Engineering", url: "https://darkroom.engineering" }, { label: "Ario Law Firm", url: "https://ario.law/en/" }],
    check: (m) => {
      if (!m.h1) return "there is no headline";
      if (m.h1.px < 110) return `the headline is ${Math.round(m.h1.px)}px; this composition starts at 110px at 1440 wide`;
      if (m.h1.rect.width < m.viewport.width * 0.65) return "the headline does not run most of the page width";
      return undefined;
    },
  },
  {
    id: "statement-sentence",
    name: "Statement sentence",
    family: "type",
    brief: "One full sentence, written in the firm's own voice, set large across the page like the first line of a letter. It says something only this firm would say. No image competing with it; supporting links sit quietly beneath.",
    references: [{ label: "Collins", url: "https://www.wearecollins.com" }, { label: "Ario Law Firm", url: "https://ario.law/en/" }],
    check: (m) => {
      if (!m.h1) return "there is no headline";
      if (m.h1.words < 9) return `the headline is ${m.h1.words} words; this composition is a whole sentence`;
      if (m.h1.px < 40) return `the headline is ${Math.round(m.h1.px)}px; a statement is set large`;
      if (m.mediaCoverage > 0.25) return "an image competes with the sentence";
      return undefined;
    },
  },
  {
    id: "kinetic-band",
    name: "Kinetic band",
    family: "type",
    brief: "A band of very large type, wider than the screen, drifts slowly across the page and pauses on hover and focus. Real words: what the firm does. The headline proper sits small and readable beside it. It stops when motion is reduced.",
    references: [{ label: "Darkroom Engineering", url: "https://darkroom.engineering" }],
    check: (m) => {
      if (!m.wideBand) return "nothing runs wider than the screen";
      if (!m.motionSeen) return "nothing moves";
      return undefined;
    },
  },
  {
    id: "index-router",
    name: "Index as hero",
    family: "interaction",
    brief: "The first screen is a large typographic index of what people come for, one big row per real service or matter (mark each with data-hero-row). The headline is modest. Hovering or focusing a row changes something real, such as an image or a one-line answer, and the row links to its page.",
    references: [{ label: "GOV.UK", url: "https://www.gov.uk" }, { label: "Herzog & de Meuron", url: "https://www.herzogdemeuron.com" }],
    check: (m) => {
      if (m.rows.length < 4) return `${m.rows.length} rows marked data-hero-row; the index needs at least four`;
      if (m.rows.reduce((sum, row) => sum + row.height, 0) < m.viewport.height * 0.4) return "the rows are too small to be the hero";
      return undefined;
    },
  },
  {
    id: "intake-first",
    name: "A question first",
    family: "interaction",
    brief: "The hero is a working question, in a container marked data-intake: what the visitor needs help with, answered in one click. Each answer really changes the screen and routes them to the right page and next step, from sample or real data. It feels like talking to reception, not filling in a form.",
    references: [{ label: "GOV.UK", url: "https://www.gov.uk" }],
    check: (m) => {
      if (!m.intake) return "nothing is marked data-intake";
      if (m.intake.choices < 3) return `the question offers ${m.intake.choices} answers; it needs at least three`;
      return undefined;
    },
  },
  {
    id: "panel-rail",
    name: "Vertical panel rail",
    family: "interaction",
    brief: "Three to five full-height vertical panels side by side (mark each with data-hero-row), one per real service or person. Hovering or focusing one widens it and reveals its image and line; on a phone they stack and open on tap.",
    references: [{ label: "teenage engineering", url: "https://teenage.engineering" }, { label: "Mersi Architecture", url: "https://mersi-architecture.com" }],
    check: (m) => {
      const tall = m.rows.filter((row) => row.height >= m.viewport.height * 0.6);
      return tall.length < 3 ? `${tall.length} tall panels marked data-hero-row; this composition needs at least three` : undefined;
    },
  },
];

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function largest<T extends Rect>(rects: readonly T[]): T | undefined {
  return [...rects].sort((a, b) => area(b) - area(a))[0];
}

export interface NavPattern {
  id: string;
  name: string;
  brief: string;
  check: (metrics: HeroMetrics) => string | undefined;
}

export const NAV_PATTERNS: readonly NavPattern[] = [
  {
    id: "corner-menu",
    name: "Corner menu",
    brief: "The logo in one corner and a single labelled Menu button in another. The button opens a real full-screen menu with every link (Escape closes it, focus is trapped). One other link at most, for the main action.",
    check: (m) => (m.navLinks.filter((link) => link.y < m.viewport.height * 0.2).length > 2 ? "more than two links show in the top bar; this navigation keeps them in the menu" : undefined),
  },
  {
    id: "centred-logo",
    name: "Centred logo",
    brief: "The logo centred at the top, links split evenly either side of it.",
    check: (m) => {
      if (!m.logo) return "nothing is marked data-hero-logo";
      const centre = m.logo.x + m.logo.width / 2;
      return centre < m.viewport.width * 0.4 || centre > m.viewport.width * 0.6 ? "the logo is not centred" : undefined;
    },
  },
  {
    id: "side-rail",
    name: "Side rail",
    brief: "A slim vertical rail down one side of the screen, holding the logo and links, in place of a top bar. On a phone it becomes a top bar with a working menu.",
    check: (m) => {
      if (m.navLinks.length === 0) return "no navigation links found";
      const top = Math.min(...m.navLinks.map((link) => link.y));
      const bottom = Math.max(...m.navLinks.map((link) => link.y + link.height));
      const left = Math.min(...m.navLinks.map((link) => link.x));
      const right = Math.max(...m.navLinks.map((link) => link.x + link.width));
      if (bottom - top < m.viewport.height * 0.25) return "the links do not run down the side";
      return right - left > m.viewport.width * 0.25 ? "the navigation is too wide to be a rail" : undefined;
    },
  },
  {
    id: "bottom-bar",
    name: "Bottom bar",
    brief: "The navigation is anchored to the bottom of the first screen instead of the top, like a caption strip, leaving the top of the page free for the composition.",
    check: (m) => {
      if (m.navLinks.length === 0) return "no navigation links found";
      return Math.min(...m.navLinks.map((link) => link.y)) < m.viewport.height * 0.6 ? "the links are not along the bottom of the screen" : undefined;
    },
  },
  {
    id: "stacked-corner",
    name: "Stacked corner list",
    brief: "The logo with the links stacked beneath it as a small vertical list in one corner, in the page's text face, like an index on a printed cover.",
    check: (m) => {
      if (m.navLinks.length < 2) return "no navigation list found";
      const lefts = m.navLinks.map((link) => Math.round(link.x));
      return Math.max(...lefts) - Math.min(...lefts) > 24 ? "the links are not stacked in one column" : undefined;
    },
  },
];

export interface MotionSignature {
  id: string;
  name: string;
  brief: string;
}

/** Every signature has the same floor: content visible with JavaScript off, and a still page under prefers-reduced-motion. */
export const MOTION_SIGNATURES: readonly MotionSignature[] = [
  { id: "masked-line-reveal", name: "Masked line reveal", brief: "The headline rises line by line from behind a mask, once, with GSAP SplitText. Slow and exact, under 1.2 seconds." },
  { id: "aperture-open", name: "Aperture open", brief: "The main image opens with an animated clip-path while settling from a slight scale. One gesture, then stillness." },
  { id: "pointer-parallax", name: "Pointer depth", brief: "Two or three layers shift a few pixels with the pointer, so the composition has physical depth. Barely noticeable until you look for it." },
  { id: "scroll-scrub", name: "Scroll scrub", brief: "The hero is pinned with ScrollTrigger, and scrolling transforms the composition into the next section, such as an image shrinking into place. Never hijack the scroll speed." },
  { id: "weight-shift", name: "Living weight", brief: "A variable font's weight or width responds to the pointer or to scroll. If the face has no such axis, animate letter-spacing or the size of one word instead." },
  { id: "still-with-grain", name: "Almost still", brief: "Nearly nothing moves: one small detail, such as a slow grain or a drifting line. Hover and focus states carry the craft." },
];

export const COMPOSITION_BY_ID: ReadonlyMap<string, Composition> = new Map(COMPOSITIONS.map((entry) => [entry.id, entry]));
export const NAV_BY_ID: ReadonlyMap<string, NavPattern> = new Map(NAV_PATTERNS.map((entry) => [entry.id, entry]));
export const MOTION_BY_ID: ReadonlyMap<string, MotionSignature> = new Map(MOTION_SIGNATURES.map((entry) => [entry.id, entry]));
