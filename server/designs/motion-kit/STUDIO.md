# Motion studio kit

This folder is yours for this film. AgentOS set it up; you make the film here.

## What is already here

- `render.mjs` — the renderer. Reads `film.config.json`, serves this folder, and drives `index.html`
  in headless Chromium through `window.seek(t)`. You may extend it; keep its commands working.
  - `node render.mjs --sheet --round N` → `sheet/round-N.png`, one frame per beat (from `beats.json`).
  - `node render.mjs --at 1.5,4.25` → spot frames in `sheet/`.
  - `node render.mjs` → `out/final.mp4` (the first format). `node render.mjs --format 1:1` → `out/final-1x1.mp4`.
  - The page is opened as `index.html?width=W&height=H&format=F`. Read those to lay out each format.
  - If `score.wav` exists it is muxed in. `--mb 6` sets `window.MB` for films that do sub-frame motion blur.
- `film.config.json` — `{ duration, fps, bpm, formats }`. Edit it if the film needs something else.
- `node_modules` — linked; `playwright` (with Chromium) is available. `ffmpeg` and `ffprobe` are on PATH.
- `reference/` — a finished AgentOS film (Pantry Pilot, 15s, 9:16): `film.js`, `synth.mjs`, `index.html`.
  It shows the contract working: canvas drawing as a pure function of time, seeded noise, springs,
  sub-frame motion blur, a synthesized score, loudnorm to -14 LUFS and a measured `beats.json`.
  Learn from its mechanics. Do not reuse its content, layout or look.
- `assets/brand/` — brand material the operator chose, when there is any.
- `BRIEF.md` — the brief, again, plus workspace context when the film belongs to one.

## What AgentOS reads back

- `sheet/round-N.png` — each review round's contact sheet, shown live to the operator.
- `scores.json` — an array, one entry per round:
  `{"round": 1, "scores": {"hook": 7, "readability": 7, "motion": 8, "variety": 6, "brand": 7, "sync": 8}, "fixes": ["…", "…", "…"]}`
- `out/*.mp4` — every finished film is filed into Creative when you finish.
