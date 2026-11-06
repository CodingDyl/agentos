# How a hero is built

A direction is how a concept looks. These axes are how it is built, assigned separately so three concepts are three different pages. One composition comes from each family: image, type and interaction. AgentOS measures composition and navigation in a browser; delivering them is not optional.

# Compositions

## Full-bleed, lower third (`full-bleed-lower-third`, image-led)

One image, film or canvas fills the whole first viewport edge to edge. The headline sits low, over the image, in the bottom part of the screen. The picture does the persuading; there is no panel behind the text.

Studied from, never copied: [DRPB, Swiss law firm](https://drpb.ch/), [2SPL Patent Attorneys](https://2spl.de), [Walker Art Center](https://walkerart.org).

## Object on a stage (`object-on-stage`, image-led)

A single subject, a photographed or generated object, sits near the centre of a mostly empty stage, with one light source. Text is small and precise and sits away from the object. The emptiness is the luxury.

Studied from, never copied: [Joseph Law](https://www.forthetimes.law), [teenage engineering](https://teenage.engineering).

## Offset overlap (`offset-overlap`, image-led)

A large image placed off-grid, with the headline physically overlapping its edge so type and picture form one shape. Neither sits in a column of its own.

Studied from, never copied: [Ario Law Firm](https://ario.law/en/), [Kinfolk](https://www.kinfolk.com).

## Edge-to-edge diptych (`diptych`, image-led)

Two full-height halves with no margin. The image takes the left half, flush to the top, bottom and left edges; the words take the right half with their own colour field. A hard vertical seam, not a picture in a column.

Studied from, never copied: [Collins](https://www.wearecollins.com), [Mersi Architecture](https://mersi-architecture.com).

## Living field (`living-field`, image-led)

A full-bleed <canvas> (WebGL or 2D) draws a generative field that responds slowly to the pointer: a material, a contour map, a grain of light. Words sit on it. It must mean something for this client and have a still fallback when motion is reduced.

Studied from, never copied: [Lusion](https://lusion.co), [Obys](https://obys.agency).

## Type monument (`type-monument`, type-led)

The headline is the image: enormous, running nearly edge to edge, and locked to the page by exact alignment. Everything else is small and sits in the margins of the type.

Studied from, never copied: [Darkroom Engineering](https://darkroom.engineering), [Ario Law Firm](https://ario.law/en/).

## Statement sentence (`statement-sentence`, type-led)

One full sentence, written in the firm's own voice, set large across the page like the first line of a letter. It says something only this firm would say. No image competing with it; supporting links sit quietly beneath.

Studied from, never copied: [Collins](https://www.wearecollins.com), [Ario Law Firm](https://ario.law/en/).

## Kinetic band (`kinetic-band`, type-led)

A band of very large type, wider than the screen, drifts slowly across the page and pauses on hover and focus. Real words: what the firm does. The headline proper sits small and readable beside it. It stops when motion is reduced.

Studied from, never copied: [Darkroom Engineering](https://darkroom.engineering).

## Index as hero (`index-router`, interaction-led)

The first screen is a large typographic index of what people come for, one big row per real service or matter (mark each with data-hero-row). The headline is modest. Hovering or focusing a row changes something real, such as an image or a one-line answer, and the row links to its page.

Studied from, never copied: [GOV.UK](https://www.gov.uk), [Herzog & de Meuron](https://www.herzogdemeuron.com).

## A question first (`intake-first`, interaction-led)

The hero is a working question, in a container marked data-intake: what the visitor needs help with, answered in one click. Each answer really changes the screen and routes them to the right page and next step, from sample or real data. It feels like talking to reception, not filling in a form.

Studied from, never copied: [GOV.UK](https://www.gov.uk).

## Vertical panel rail (`panel-rail`, interaction-led)

Three to five full-height vertical panels side by side (mark each with data-hero-row), one per real service or person. Hovering or focusing one widens it and reveals its image and line; on a phone they stack and open on tap.

Studied from, never copied: [teenage engineering](https://teenage.engineering), [Mersi Architecture](https://mersi-architecture.com).

# Navigation

- **Corner menu (`corner-menu`):** The logo in one corner and a single labelled Menu button in another. The button opens a real full-screen menu with every link (Escape closes it, focus is trapped). One other link at most, for the main action.
- **Centred logo (`centred-logo`):** The logo centred at the top, links split evenly either side of it.
- **Side rail (`side-rail`):** A slim vertical rail down one side of the screen, holding the logo and links, in place of a top bar. On a phone it becomes a top bar with a working menu.
- **Bottom bar (`bottom-bar`):** The navigation is anchored to the bottom of the first screen instead of the top, like a caption strip, leaving the top of the page free for the composition.
- **Stacked corner list (`stacked-corner`):** The logo with the links stacked beneath it as a small vertical list in one corner, in the page's text face, like an index on a printed cover.

# Motion

The floor for all of them: content is visible with JavaScript off, and the page is still under `prefers-reduced-motion`.

- **Masked line reveal (`masked-line-reveal`):** The headline rises line by line from behind a mask, once, with GSAP SplitText. Slow and exact, under 1.2 seconds.
- **Aperture open (`aperture-open`):** The main image opens with an animated clip-path while settling from a slight scale. One gesture, then stillness.
- **Pointer depth (`pointer-parallax`):** Two or three layers shift a few pixels with the pointer, so the composition has physical depth. Barely noticeable until you look for it.
- **Scroll scrub (`scroll-scrub`):** The hero is pinned with ScrollTrigger, and scrolling transforms the composition into the next section, such as an image shrinking into place. Never hijack the scroll speed.
- **Living weight (`weight-shift`):** A variable font's weight or width responds to the pointer or to scroll. If the face has no such axis, animate letter-spacing or the size of one word instead.
- **Almost still (`still-with-grain`):** Nearly nothing moves: one small detail, such as a slow grain or a drifting line. Hover and focus states carry the craft.
