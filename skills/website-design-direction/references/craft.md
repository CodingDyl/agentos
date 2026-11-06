# Craft notes for a hero

Read this before writing any code. The rest of the brief says what to make; this says how to make it look finished. A top agency's page differs from a generated one in a few specific, checkable ways.

## Start from the idea

- The hero expresses one thought from `design/STRATEGY.md`. If you can move it to a competitor by changing the name, you have made a template.
- Decide what the first second shows and what the fifth second shows. Those are different moments.
- Write the real copy first. Layout built around placeholder lengths breaks on real words.

## Typography

- Commit to a scale with big jumps. A headline at 1.5 times the body says nothing; one at 8 to 20 times says something. Use two or three sizes in the first screen, not six.
- Set display type tight: line height 0.9 to 1.05, tracking slightly negative at large sizes, never below -0.04em. Set body at 1.5 to 1.7 and 45 to 70 characters wide.
- Use `font-variant-numeric: tabular-nums` wherever figures align, and `text-wrap: balance` on headings.
- One family doing several jobs through weight and width usually beats a third typeface.
- Use only the two faces in your `fonts.css`. Nothing falls back silently: if the face did not load, the concept fails.

## Composition

- Make the assigned composition the first thing you see, not a decoration on a stacked layout. It is measured.
- Use the whole screen, and let things touch edges, cross each other or be cropped on purpose. Timid margins around everything read as a template.
- Use asymmetry with a reason, and align to something: every element should share an edge or axis with another.
- Leave one large area empty. Whitespace you can point at is a decision; even padding everywhere is a default.
- At 390px wide, recompose. Do not shrink: choose what the phone sees first, keep the idea and let the rest move below.

## Colour and surface

- Pick a ground on purpose, then a small number of colours with jobs. One accent, used rarely, earns attention.
- Tint neutrals toward the palette rather than using pure grey. Secondary text on a coloured surface takes that surface's hue.
- Shadows, where used, have an offset and soft blur. Prefer flat surfaces and real overlaps to floating cards.
- Theme the parts nobody draws: `::selection`, focus rings, underline offset, caret colour, scrollbars. This is the cheapest sign a page was made rather than assembled.

## Imagery

- An image has a job in the idea. If it only fills a box, remove it and make the type bigger.
- Treat images: crop hard, choose one light, and match them to the palette. Avoid the even, shadowless stock look.
- No image at all is a fine answer when a strong graphic or type idea carries the page.

## Motion

- One authored moment, not a fade on everything. Start from a visible default, so nothing is lost if a script fails.
- Ease out strongly (`expo.out`, `power4.out`), under 1.2 seconds for an entrance, 150 to 300 milliseconds for hover and focus.
- Animate transform, opacity, clip-path and font axes. Respect `prefers-reduced-motion`: the page is complete and still.
- GSAP, ScrollTrigger, SplitText and Lenis are in `design/kit/motion/`. Register plugins before use, and wait for `document.fonts.ready` before splitting text.

## Working parts

- Everything that looks clickable is clickable and does something. Every control has hover, focus, active and disabled states, and targets are at least 44px on a phone.
- A menu opens, traps focus and closes on Escape. A form validates, explains errors next to the field and shows a real confirmation.
- Sample data is plausible, clearly marked `Demo: sample data` with `data-demo="true"`, and never an invented fact about the client.

## Before you finish

Look at your own page, if you can render it, and ask:

1. With the logo covered, could this be any firm in the niche? Then the idea is not there yet.
2. Is the first thing I see the assigned composition?
3. Did I add a small label above the headline? Delete it.
4. What is the single best detail here, and would someone notice its absence?
5. Would I put my name on this, next to the best agency work I know?
