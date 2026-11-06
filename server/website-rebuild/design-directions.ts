import { DESIGN_RUBRIC_MAX, DESIGN_RUBRIC_PASS } from "../../shared/website-rebuild-types";

/**
 * The website-design-direction skill as data: the art directions a hero
 * concept is assigned, the patterns every concept must avoid, what each
 * niche usually looks like, and the rubric the critique pass scores against.
 *
 * Kept as code, not only as Markdown, because assignment and the critique
 * gate need it. skills/website-design-direction/ is the readable version of
 * the same lists, and a test keeps the two in step.
 *
 * Models converge on the average. A skill alone does not stop two law firms
 * looking alike, so each run is given different inputs (a forced direction
 * from outside the niche) and a critique that rejects the average.
 */

export interface DesignDirection {
  id: string;
  name: string;
  /** Where the direction comes from, outside web templates. Workers study this, not other websites. */
  reference: string;
  /** Open-licence (Google Fonts, OFL) display and text faces for the build, and a system stack for the offline hero. */
  type: { display: string; text: string; heroStack: string; logic: string };
  /** The dominant palette family. Two concepts in one niche never share one while another is free. */
  palette: { family: string; logic: string; example: readonly string[] };
  /** How the page is put together. */
  layout: string;
  /** The hero's shape, recorded in the fingerprint. */
  heroArchetype: string;
  imagery: string;
}

export const DESIGN_DIRECTIONS: readonly DesignDirection[] = [
  {
    id: "editorial-broadsheet",
    name: "Editorial broadsheet",
    reference: "Weekend newspaper front pages and long-read supplements",
    type: { display: "Newsreader", text: "Public Sans", heroStack: "Georgia, 'Times New Roman', serif", logic: "A tall serif headline set tight, a small-caps kicker, body in a plain grotesque. Rules between columns, not boxes." },
    palette: { family: "newsprint", logic: "Warm newsprint ground, near-black ink, one spot colour used only for the kicker and the call to action.", example: ["#F3EFE6", "#141414", "#B3261E"] },
    layout: "A masthead row, a multi-column grid with hairline rules, a lead story and a sidebar. Content density over whitespace.",
    heroArchetype: "masthead-columns",
    imagery: "One documentary photograph with a caption, or none. Datelines and bylines as texture.",
  },
  {
    id: "swiss-grid",
    name: "Swiss grid",
    reference: "International Typographic Style posters, 1950s to 1970s",
    type: { display: "Schibsted Grotesk", text: "Schibsted Grotesk", heroStack: "'Helvetica Neue', Arial, sans-serif", logic: "One grotesque family in two or three weights, flush left, ragged right. Scale contrast does the work." },
    palette: { family: "white-black-signal", logic: "White ground, black type, a single saturated signal colour as a large flat field.", example: ["#FFFFFF", "#0A0A0A", "#FF4F00"] },
    layout: "A visible 12-column grid, asymmetric placement, large numerals, generous but measured margins. Nothing centred.",
    heroArchetype: "grid-asymmetric",
    imagery: "Flat geometric fields and cropped photography inside grid modules. No rounded corners.",
  },
  {
    id: "brutalist-utility",
    name: "Brutalist utility",
    reference: "Hardware store shelf labels, invoices and council forms",
    type: { display: "Archivo Black", text: "IBM Plex Mono", heroStack: "'Arial Black', Arial, sans-serif", logic: "A heavy condensed display, a monospaced text face, uppercase labels. No decorative type." },
    palette: { family: "raw-concrete", logic: "Unbleached grey ground, black, and safety yellow as the only colour.", example: ["#E4E2DD", "#000000", "#FFD400"] },
    layout: "Thick borders, visible boxes, tables and lists that look like forms. Links underlined. The price or call-out time is the hero.",
    heroArchetype: "form-block",
    imagery: "None or plain product photos on white. Iconography as text labels.",
  },
  {
    id: "warm-craft",
    name: "Warm craft",
    reference: "Workshop aprons, kraft-paper packaging and letterpress cards",
    type: { display: "Young Serif", text: "Instrument Sans", heroStack: "'Iowan Old Style', Palatino, serif", logic: "A soft, sturdy serif for headings, a humane sans for text. Generous line height." },
    palette: { family: "kraft-earth", logic: "Kraft and clay tones with a deep green or ink blue anchor. Warm, never beige-on-beige.", example: ["#EADBC8", "#2F3B2F", "#B5562C"] },
    layout: "Stacked sections with hand-ruled dividers, stamped labels and process steps. One idea per band.",
    heroArchetype: "stacked-label",
    imagery: "Close-ups of hands, tools and materials (the client's own only). Paper texture through CSS, never stock.",
  },
  {
    id: "architectural-monochrome",
    name: "Architectural monochrome",
    reference: "Architecture practice monographs and gallery wall text",
    type: { display: "Italiana", text: "Hanken Grotesk", heroStack: "Didot, 'Bodoni 72', serif", logic: "A light, wide display at very large size, small tracked-out sans labels." },
    palette: { family: "stone-monochrome", logic: "Stone, graphite and white. Colour only from the client's photographs.", example: ["#F2F1EF", "#2B2B2B", "#8A8580"] },
    layout: "Very wide margins, a strict baseline, captions and index numbers. Large single image or a single line of type.",
    heroArchetype: "framed-specimen",
    imagery: "Full-bleed architectural photography or plans. Strong verticals.",
  },
  {
    id: "archival-heritage",
    name: "Archival heritage",
    reference: "Museum catalogue cards, old company ledgers and seals",
    type: { display: "Libre Caslon Text", text: "Libre Franklin", heroStack: "'Book Antiqua', Palatino, serif", logic: "A classical text serif with italic for emphasis, a sober sans for UI. Numbered sections like a catalogue." },
    palette: { family: "oxblood-parchment", logic: "Parchment ground, oxblood and bottle green, gold only as a thin rule.", example: ["#F1E9D8", "#5A1E1B", "#1F3D2B"] },
    layout: "Index cards, reference numbers, dated entries and a timeline. Frames and double rules used sparingly.",
    heroArchetype: "catalogue-card",
    imagery: "Archive photographs, documents and marks the client really has. Never fake old photos.",
  },
  {
    id: "magazine-collage",
    name: "Magazine collage",
    reference: "Independent lifestyle magazines and cut-paper collage",
    type: { display: "Bricolage Grotesque", text: "Literata", heroStack: "'Avenir Next Condensed', 'Arial Narrow', sans-serif", logic: "An expressive grotesque that changes weight and width, a bookish serif for text. Headlines can overlap images." },
    palette: { family: "bright-paper", logic: "Two bright paper colours that clash on purpose, with black. Never a gradient.", example: ["#FF8FB1", "#1E6BFF", "#111111"] },
    layout: "Overlapping layers, rotated labels, pull quotes, cut-out shapes. Controlled chaos on a grid underneath.",
    heroArchetype: "collage-overlap",
    imagery: "Cut-out photographs, torn edges and stickers built in CSS or SVG.",
  },
  {
    id: "technical-spec-sheet",
    name: "Technical spec sheet",
    reference: "Engineering datasheets, part catalogues and wiring diagrams",
    type: { display: "IBM Plex Sans Condensed", text: "IBM Plex Mono", heroStack: "'Arial Narrow', 'Helvetica Neue', sans-serif", logic: "Condensed sans for headings, monospace for specifications. Tabular figures everywhere." },
    palette: { family: "blueprint", logic: "Pale drafting paper, Prussian blue line work, one warning orange.", example: ["#EEF2F5", "#123A6B", "#F26B1D"] },
    layout: "Spec tables, labelled callouts with leader lines, part numbers, revision boxes in the corner.",
    heroArchetype: "spec-table",
    imagery: "Line diagrams and exploded views in inline SVG. Photos only as numbered figures.",
  },
  {
    id: "hand-made-signage",
    name: "Hand-made signage",
    reference: "Painted shopfront signs, bakkie door lettering and market chalkboards",
    type: { display: "Alfa Slab One", text: "Atkinson Hyperlegible", heroStack: "Rockwell, 'Courier New', serif", logic: "A bold slab for the sign, a very legible sans for everything else. Big, friendly, direct." },
    palette: { family: "painted-sign", logic: "Signwriter enamel: cream, a deep red or green panel, black outline.", example: ["#FFF6E0", "#0F5C3A", "#D7261E"] },
    layout: "Sign panels with outlines and drop shadows, phone number as big as the headline, arrows and badges.",
    heroArchetype: "signboard-block",
    imagery: "The client's van, shopfront or team at work. Painted-style borders in CSS.",
  },
  {
    id: "cinematic-dark",
    name: "Cinematic dark",
    reference: "Film title sequences and theatre programmes",
    type: { display: "Bodoni Moda", text: "Red Hat Text", heroStack: "Didot, 'Bodoni 72', Georgia, serif", logic: "High-contrast didone headlines with wide tracking, a clean sans for text. Few words, large." },
    palette: { family: "night-ember", logic: "Near-black ground, warm off-white type, one ember or brass accent. No neon, no purple glow.", example: ["#0D0C0B", "#EDE6DA", "#C8873A"] },
    layout: "Letterbox bands, slow reveal of sections, credits-style lists of services.",
    heroArchetype: "letterbox",
    imagery: "Moody, low-key photography of the real place or work. Grain via CSS, never stock.",
  },
  {
    id: "botanical",
    name: "Botanical",
    reference: "Herbarium sheets and botanical illustration plates",
    type: { display: "Gloock", text: "Figtree", heroStack: "Georgia, 'Times New Roman', serif", logic: "A characterful serif for names, a soft sans for text, Latin-style labels in italic." },
    palette: { family: "herbarium", logic: "Cotton-paper ground, leaf and moss greens, a pressed-flower accent.", example: ["#F6F3EA", "#3E5C3A", "#C2577A"] },
    layout: "Specimen plates with labels, numbered figures and lots of air around a single subject.",
    heroArchetype: "specimen-plate",
    imagery: "Line-drawn botanical motifs in SVG, or the client's own photography framed like a plate.",
  },
  {
    id: "data-forward",
    name: "Data-forward",
    reference: "Annual-report infographics and transit timetables",
    type: { display: "Chivo", text: "Chivo Mono", heroStack: "'Helvetica Neue', Arial, sans-serif", logic: "A strong sans with tabular numerals, mono for figures. Numbers are the headline." },
    palette: { family: "chart-ink", logic: "White ground, a dark slate, and a categorical set of two or three chart colours.", example: ["#FFFFFF", "#1C2430", "#00A38C"] },
    layout: "Key figures, small charts, comparison tables and timelines up front. Only real numbers from the capture; no invented statistics.",
    heroArchetype: "figure-strip",
    imagery: "Charts and diagrams in SVG built from real data, or none.",
  },
  {
    id: "municipal-wayfinding",
    name: "Municipal wayfinding",
    reference: "Airport, hospital and transit signage systems",
    type: { display: "Overpass", text: "Overpass", heroStack: "'Trebuchet MS', 'Helvetica Neue', sans-serif", logic: "A signage sans in bold and regular, pictograms, arrows, numbered routes." },
    palette: { family: "transit-bands", logic: "Coloured route bands on white: one band colour per service, black text, high contrast.", example: ["#FFFFFF", "#1A1A1A", "#0072CE"] },
    layout: "Horizontal bands, arrows to each service, step numbers. Navigation is the design.",
    heroArchetype: "wayfinding-bands",
    imagery: "Pictograms in SVG. Photos inset in signage panels.",
  },
  {
    id: "risograph-zine",
    name: "Risograph zine",
    reference: "Two-colour risograph prints and photocopied zines",
    type: { display: "Darker Grotesque", text: "Courier Prime", heroStack: "'Courier New', Courier, monospace", logic: "A tall grotesque for headlines, typewriter text. Misregistered overprint effects via CSS blend modes." },
    palette: { family: "riso-duotone", logic: "Exactly two ink colours on paper, overprinted for a third.", example: ["#F7F4EE", "#FF48B0", "#0078BF"] },
    layout: "Staple-bound zine pages: page numbers, halftone panels, handwritten-style annotations (CSS, no script fonts from the web).",
    heroArchetype: "halftone-poster",
    imagery: "Halftone or duotone treatment of the client's own photos via CSS filters.",
  },
  {
    id: "nautical-chart",
    name: "Nautical chart",
    reference: "Admiralty sea charts and tide tables",
    type: { display: "Big Shoulders Display", text: "Source Serif 4", heroStack: "'Arial Narrow', 'Helvetica Neue', sans-serif", logic: "A tall condensed display, a readable serif for text, coordinates and depth figures as accents." },
    palette: { family: "chart-sea", logic: "Chart paper, shallow-water blue, buoy red and lighthouse yellow in small doses.", example: ["#F4F1E8", "#8EC5D6", "#C3302C"] },
    layout: "Contour lines and coordinates as structure, a compass-rose index, legend boxes.",
    heroArchetype: "chart-legend",
    imagery: "Contour and grid patterns in SVG. Location shown honestly, never an invented service area.",
  },
];

export const DIRECTION_BY_ID: ReadonlyMap<string, DesignDirection> = new Map(DESIGN_DIRECTIONS.map((direction) => [direction.id, direction]));

export interface AntiPattern {
  category: "Typography" | "Colour" | "Layout" | "Imagery" | "Copy" | "Components";
  rule: string;
}

/** What makes a site read as generated. Every brief and the critique use this list. */
export const ANTI_PATTERNS: readonly AntiPattern[] = [
  { category: "Typography", rule: "Inter, Roboto, Arial, Open Sans, Poppins or Montserrat as the main face by default. Use the assigned pairing." },
  { category: "Typography", rule: "One weight of one sans everywhere, with headings only slightly bigger than text." },
  { category: "Typography", rule: "Centred body copy, or paragraphs wider than about 75 characters." },
  { category: "Colour", rule: "Purple-to-blue or any decorative gradient on the hero, buttons or text." },
  { category: "Colour", rule: "Navy plus gold for anything professional, or teal plus white for anything medical, unless the client's brand already is that." },
  { category: "Colour", rule: "Glassmorphism, neon glows and soft drop shadows on every element." },
  { category: "Layout", rule: "Centred headline, sub-line and two buttons over a full-width photo, followed by an icon plus three cards grid." },
  { category: "Layout", rule: "Cards inside cards, or every section as a rounded white card on a grey page." },
  { category: "Layout", rule: "Identical section rhythm down the page: heading, sub-line, grid of three, repeat." },
  { category: "Layout", rule: "A testimonial carousel, stats counter or logo wall when there is no real material for it." },
  { category: "Imagery", rule: "Stock-photo tropes: handshakes, gavels, scales of justice, smiling call-centre agents, a spanner crossed with a pipe, a tooth with a sparkle." },
  { category: "Imagery", rule: "Generic 3D blobs, abstract waves or isometric illustrations as decoration." },
  { category: "Components", rule: "Emoji or generic icon bullets in front of every list item." },
  { category: "Components", rule: "Pill buttons with an arrow icon on every call to action, and a floating chat bubble." },
  { category: "Copy", rule: "Vague claims: \"Your trusted partner\", \"Excellence in every detail\", \"Solutions tailored to you\", \"We go the extra mile\", \"Quality you can trust\"." },
  { category: "Copy", rule: "Headlines that could belong to any business in the niche. Name the real service, place or offer." },
  { category: "Copy", rule: "Invented numbers, years, awards or reviews to fill a trust section." },
];

export interface NicheCliches {
  id: string;
  label: string;
  /** Matched against the target market, company name and goal. */
  match: RegExp;
  /** What sites in this niche usually look like. The concepts must not. */
  cliches: readonly string[];
  /** Directions far from the niche: one of these is always the wildcard. */
  wildcards: readonly string[];
}

export const NICHE_CLICHES: readonly NicheCliches[] = [
  {
    id: "law",
    label: "Law firms and attorneys",
    match: /\b(law|legal|attorneys?|lawyers?|conveyanc\w*|advocates?|litigation|notar\w*|estate planning)\b/i,
    cliches: ["navy and gold", "serif logo with scales of justice or a column", "gavel or bookshelf stock photo", "\"Your trusted legal partner\"", "a centred hero over a boardroom photo", "three practice-area cards"],
    wildcards: ["magazine-collage", "municipal-wayfinding", "risograph-zine", "data-forward", "botanical"],
  },
  {
    id: "plumbing",
    label: "Plumbers",
    match: /\b(plumb\w*|geysers?|drains?|leaks?|burst pipes?)\b/i,
    cliches: ["blue and white with a water-drop icon", "a smiling plumber stock photo with arms crossed", "\"24/7 emergency\" in a red starburst", "a spanner-and-pipe logo", "three service cards with icons"],
    wildcards: ["architectural-monochrome", "editorial-broadsheet", "botanical", "cinematic-dark", "nautical-chart"],
  },
  {
    id: "electrical",
    label: "Electricians",
    match: /\b(electric\w*|wiring|coc|certificates? of compliance|load ?shedding|inverters?|solar)\b/i,
    cliches: ["yellow and black with a lightning bolt", "a stock photo of hands in a distribution board", "\"Powering your future\"", "a dark hero with an electric-blue glow", "icon-card grid of services"],
    wildcards: ["botanical", "archival-heritage", "magazine-collage", "editorial-broadsheet", "warm-craft"],
  },
  {
    id: "dental",
    label: "Dentists and orthodontists",
    match: /\b(dent\w*|orthodont\w*|teeth|oral health|smile)\b/i,
    cliches: ["teal or mint and white", "a perfect-smile stock photo", "a tooth icon with a sparkle", "\"Your smile is our priority\"", "rounded cards and soft shadows everywhere"],
    wildcards: ["swiss-grid", "risograph-zine", "technical-spec-sheet", "editorial-broadsheet", "nautical-chart"],
  },
  {
    id: "accounting",
    label: "Accountants and bookkeepers",
    match: /\b(account\w*|bookkeep\w*|tax|audit\w*|payroll|sars|financial statements?)\b/i,
    cliches: ["corporate blue and grey", "a calculator, pen and graph stock photo", "\"Your numbers, our passion\"", "a laptop-on-desk hero", "pricing cards with a 'popular' badge"],
    wildcards: ["warm-craft", "hand-made-signage", "magazine-collage", "botanical", "cinematic-dark"],
  },
  {
    id: "auto",
    label: "Auto workshops and mechanics",
    match: /\b(auto\w*|mechanics?|workshops?|panel ?beat\w*|tyres?|car services?|vehicles?|gearbox\w*|brakes?)\b/i,
    cliches: ["black, red and chrome", "a checkered-flag or piston logo", "a sports-car stock photo", "\"Driven by excellence\"", "a dark hero with a diagonal red slash"],
    wildcards: ["botanical", "swiss-grid", "archival-heritage", "editorial-broadsheet", "municipal-wayfinding"],
  },
  {
    id: "restaurant",
    label: "Restaurants and cafes",
    match: /\b(restaurants?|caf[eé]s?|bistros?|eatery|eateries|takeaways?|diners?|bakery|bakeries|coffee)\b/i,
    cliches: ["a dark full-bleed food photo with white script type", "chalkboard texture", "\"A taste of ...\"", "a centred logo over a plate", "a menu as a PDF link"],
    wildcards: ["technical-spec-sheet", "swiss-grid", "data-forward", "municipal-wayfinding", "nautical-chart"],
  },
];

/** A niche we have no map for: the general clichés still apply. */
export const GENERAL_NICHE: NicheCliches = {
  id: "general",
  label: "Local service business",
  match: /$^/,
  cliches: ["a centred hero over a stock photo", "an icon plus three cards grid", "a blue primary button", "\"Quality you can trust\""],
  wildcards: ["magazine-collage", "risograph-zine", "nautical-chart", "technical-spec-sheet", "botanical"],
};

/** The niche a run is in, from what the brief says about the client. */
export function detectNiche(run: { targetMarket: string; company: string; conversionGoal?: string }): NicheCliches {
  // The target market is the best signal; the company name settles the rest ("Homeowners" for Total Electric).
  for (const source of [run.targetMarket, run.company, run.conversionGoal ?? ""]) {
    const niche = NICHE_CLICHES.find((entry) => entry.match.test(source));
    if (niche) return niche;
  }
  return GENERAL_NICHE;
}

export interface RubricCriterion {
  id: string;
  criterion: string;
  /** What a 5 looks like. */
  five: string;
}

/** Eight criteria, each scored 0 to 5: 40 in all. */
export const CRITIQUE_RUBRIC: readonly RubricCriterion[] = [
  { id: "niche", criterion: "Escapes the niche default", five: "Nobody would guess the niche from the layout and palette alone, yet it fits the business." },
  { id: "direction", criterion: "Commits to its assigned direction", five: "The direction's type, colour, layout grammar and imagery are all visible, not just one of them." },
  { id: "type", criterion: "Typography", five: "A deliberate pairing with clear hierarchy and scale contrast; none of the default faces." },
  { id: "colour", criterion: "Colour", five: "A clear colour logic, contrast of 4.5:1 or better for text, no decorative gradients." },
  { id: "layout", criterion: "Layout and composition", five: "A composition specific to this concept; no centred hero plus three cards, no nested cards." },
  { id: "copy", criterion: "Copy specificity", five: "Names the real service, place and next step; no vague claims, nothing invented." },
  { id: "brand", criterion: "Use of the client's brand", five: "Logo, colours and photos used correctly where they exist, or a confident wordmark where they do not." },
  { id: "craft", criterion: "Craft and accessibility", five: "Semantic landmarks, visible focus, works at 390px and 1440px, nothing broken or clipped." },
];

export const RUBRIC_MAX = DESIGN_RUBRIC_MAX;
/** A concept scoring below this goes back for one automatic revision. */
export const RUBRIC_PASS = DESIGN_RUBRIC_PASS;
