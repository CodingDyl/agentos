// Synthesized score + SFX for the Pantry Pilot showreel. 120 BPM, A minor → C resolve.
// Writes score_raw.wav, then loudnorm → score.wav (-14 LUFS), then measures beats → beats.json.
import { writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SR = 44100, DUR = 15, N = SR * DUR, BEAT = 0.5;
const L = new Float32Array(N), R = new Float32Array(N);
const KICK = new Float32Array(N); // kick-only stem, for beat measurement
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mulberry32(7);
const noise = () => rng() * 2 - 1;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function add(t0, dur, gain, pan, fn, stem) {
  const s0 = Math.round(t0 * SR), n = Math.round(dur * SR);
  const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4), gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < n; i++) {
    const j = s0 + i; if (j < 0 || j >= N) { fn(i / SR); continue; }
    const v = fn(i / SR); L[j] += v * gl; R[j] += v * gr; if (stem) stem[j] += v * gain;
  }
}

// ---- instruments ----
function kick(t, g = 1) { let ph = 0; add(t, 0.45, g, 0, (x) => { ph += (2 * Math.PI * (44 + 110 * Math.exp(-x * 28))) / SR; return Math.sin(ph) * Math.exp(-x * 6.5) + (x < 0.004 ? noise() * 0.4 : 0); }, KICK); }
function boom(t, g = 1) { let ph = 0, lp = 0; add(t, 1.6, g, 0, (x) => { ph += (2 * Math.PI * (34 + 80 * Math.exp(-x * 16))) / SR; lp += 0.08 * (noise() - lp); return Math.tanh(1.6 * Math.sin(ph)) * Math.exp(-x * 2.4) + lp * 1.6 * Math.exp(-x * 5); }, KICK); }
function clap(t, g = 0.5) { let hp = 0, prev = 0; add(t, 0.3, g, 0, (x) => { const n = noise(); hp = 0.8 * (hp + n - prev); prev = n; const env = x < 0.03 ? (Math.exp(-((x % 0.01) * 300))) : Math.exp(-(x - 0.03) * 22); return hp * env; }); }
function hat(t, g = 0.12, pan = 0.3, len = 40) { let hp = 0, prev = 0; add(t, 0.12, g, pan, (x) => { const n = noise(); hp = 0.5 * (hp + n - prev); prev = n; return hp * Math.exp(-x * len); }); }
function bass(t, m, dur, g = 0.34) { const f = mtof(m); let lp = 0; add(t, dur, g, 0, (x) => { let v = 0; for (let k = 1; k <= 7; k++) v += Math.sin(2 * Math.PI * f * k * x) / k; lp += 0.18 * (v - lp); return lp * Math.min(1, x * 200) * Math.exp(-x * 3.2) * (x > dur - 0.02 ? (dur - x) / 0.02 : 1); }); }
function pluck(t, m, g = 0.16, pan = 0) { // Karplus–Strong
  const f = mtof(m), P = Math.round(SR / f), buf = new Float32Array(P); for (let i = 0; i < P; i++) buf[i] = noise(); let idx = 0;
  add(t, 0.9, g, pan, () => { const a = buf[idx], b = buf[(idx + 1) % P]; buf[idx] = 0.497 * (a + b); idx = (idx + 1) % P; return a; });
}
function pad(t, notes, dur, g = 0.05) { const ph = notes.flatMap((m) => [mtof(m) * 0.997, mtof(m) * 1.003]); let lp = 0;
  add(t, dur, g, 0, (x) => { let v = 0; for (const f of ph) v += ((x * f) % 1) * 2 - 1; lp += 0.05 * (v - lp); return lp * Math.min(1, x * 4) * Math.min(1, (dur - x) * 6); }); }
function stab(t, notes, g = 0.12) { for (const m of notes) { let lp = 0; add(t, 0.5, g, 0, (x) => { const v = ((x * mtof(m)) % 1) * 2 - 1; lp += 0.25 * (v - lp); return lp * Math.exp(-x * 7); }); } }
function whoosh(tEnd, dur = 0.5, g = 0.35) { let lp = 0, bp = 0; add(tEnd - dur, dur + 0.08, g, 0, (x) => { const q = Math.min(1, x / dur); const c = 0.02 + 0.5 * q * q; lp += c * (noise() - lp); bp += c * (lp - bp); const env = x < dur ? q * q : Math.exp(-(x - dur) * 60); return (lp - bp) * 3 * env; }); }
function riser(t, dur, g = 0.12) { let ph = 0; add(t, dur, g, 0, (x) => { const q = x / dur; ph += (2 * Math.PI * (200 + 1400 * q * q)) / SR; return (Math.sin(ph) * 0.5 + noise() * 0.5 * q) * q * q; }); }
function blip(t, f0, f1, g = 0.18, len = 30, pan = 0) { let ph = 0; add(t, 0.2, g, pan, (x) => { ph += (2 * Math.PI * (f1 + (f0 - f1) * Math.exp(-x * 40))) / SR; return Math.sin(ph) * Math.exp(-x * len); }); }
function chime(t, m, g = 0.14, pan = 0) { const f = mtof(m); add(t, 1.8, g, pan, (x) => Math.sin(2 * Math.PI * f * x + 2.2 * Math.exp(-x * 3) * Math.sin(2 * Math.PI * f * 3.5 * x)) * Math.exp(-x * 2.6)); }

// ---- harmony (per bar = 2s) ----
const CH = { Am: [57, 60, 64], F: [53, 57, 60], C: [48, 52, 55], G: [55, 59, 62] };
const BARS = ['Am', 'Am', 'F', 'C', 'G', 'Am', 'F', 'C'];

// ---- arrangement ----
// Bar 0 (0–2): four word slams, no groove.
[0, 0.5, 1.0].forEach((h, i) => { kick(h, 1); clap(h, 0.35); stab(h, CH.Am.map((m) => m + 12), 0.1); bass(h, 45 - (i === 2 ? 2 : 0), 0.45, 0.3); });
boom(1.5, 0.9); stab(1.5, [57, 64, 69], 0.12); riser(1.5, 0.5, 0.1); whoosh(2.0, 0.4, 0.4);

// Bars 1–6 (2–14): groove.
for (let b = 4; b < 28; b++) {
  const t = b * BEAT, bar = (b / 4) | 0, chord = CH[bar === 6 && b % 4 >= 2 ? 'G' : BARS[bar]];
  const build = t >= 11 && t < 12;
  kick(t, 0.95);
  if (b % 2 === 1) clap(t, 0.42);
  hat(t + 0.25, 0.13, 0.35); hat(t + 0.125, 0.05, -0.35, 70); hat(t + 0.375, 0.05, -0.35, 70);
  bass(t, chord[0] - 12, 0.22); bass(t + 0.25, chord[0] - 12 + (b % 4 === 3 ? 7 : 0), 0.22);
  const arp = [0, 1, 2, 1];
  for (let s = 0; s < 4; s++) pluck(t + s * 0.125, chord[arp[s]] + 12 + (s === 2 && b % 2 ? 12 : 0), 0.13, s % 2 ? 0.4 : -0.4);
  if (b % 4 === 0) pad(t, chord.map((m) => m + 12), 2.0);
  if (build) for (let s = 0; s < 4; s++) clap(t + s * 0.125, 0.1 + 0.25 * (t - 11));
}
// Scene SFX (locked to the same grid the visuals use)
for (let i = 0; i < 9; i++) blip(2.125 + i * 0.125, 1300, 380, 0.16, 28, (i % 3 - 1) * 0.5);   // tiles land
chime(3.25, 81, 0.1, 0.4);                                                                       // "use in 2 days"
[0, 1, 2].forEach((i) => blip(3.5 + i * 0.125, 700 + i * 250, 900 + i * 300, 0.14, 18));         // picks
whoosh(4.5, 0.5, 0.3); chime(4.5, 76, 0.16); chime(4.5, 83, 0.1, 0.3);                            // merge
for (let k = 0; k < 4; k++) blip(4.875 + k * 0.125, 1600, 500, 0.12, 35, 0.2);                   // eggs
whoosh(6.05, 0.35, 0.2);
for (let i = 1; i < 7; i++) hat(6.375 + (i - 1) * 0.125, 0.12, 0.6, 25);                         // rows slide
for (let i = 1; i < 7; i++) blip(7.0 + i * 0.07, 1800 + i * 120, 2200 + i * 120, 0.06, 45);       // row ticks
whoosh(7.85, 0.35, 0.5);                                                                          // whip pan
for (let i = 0; i < 5; i++) { blip(8.5 + i * 0.25, 2400, 1800, 0.14, 50); chime(8.5 + i * 0.25, 84 + [0, 2, 4, 7, 9][i], 0.05); } // checks
whoosh(10.0, 0.3, 0.4); blip(10.05, 180, 520, 0.25, 8);                                           // flood + bean rises
blip(11.0, 300, 900, 0.2, 10); blip(11.5, 700, 160, 0.25, 14);                                    // hop + land
riser(11.0, 1.0, 0.16); whoosh(12.0, 0.6, 0.45);
// Drop at 12: collapse into the logo
boom(12.0, 1.1); stab(12.0, CH.F.map((m) => m + 12), 0.1); chime(12.0, 72, 0.14);
for (let i = 0; i < 12; i++) blip(12.5 + i * 0.035, 1200 + i * 60, 900 + i * 60, 0.03, 60, (i / 11) * 1.2 - 0.6); // wordmark letters
// Final hit at 14: C major ring-out
boom(14.0, 0.9); pad(14.0, [60, 64, 67, 72], 1.0, 0.07); chime(14.0, 72, 0.16); chime(14.0, 79, 0.1, -0.3); chime(14.0, 76, 0.1, 0.3);
for (let s = 0; s < 4; s++) pluck(14 + s * 0.125, [72, 76, 79, 84][s], 0.12, s % 2 ? 0.4 : -0.4);
bass(14.0, 36, 0.95, 0.35);

// ---- master: dotted-8th delay send, soft clip, fade tail ----
const D = Math.round(0.375 * SR);
for (let i = D; i < N; i++) { L[i] += R[i - D] * 0.18; R[i] += L[i - D] * 0.18; }
for (let i = 0; i < N; i++) { const f = i > N - SR * 0.35 ? (N - i) / (SR * 0.35) : 1; L[i] = Math.tanh(L[i] * 0.9) * f; R[i] = Math.tanh(R[i] * 0.9) * f; }

function wav(path, chans) {
  const n = chans[0].length, c = chans.length, b = Buffer.alloc(44 + n * c * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * c * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(c, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * c * 2, 28); b.writeUInt16LE(c * 2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * c * 2, 40);
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, chans[k][i])) * 32767), 44 + (i * c + k) * 2);
  writeFileSync(path, b);
}
wav('score_raw.wav', [L, R]);

// Two-pass loudnorm to -14 LUFS, -1 dBTP.
const probe = execFileSync('ffmpeg', ['-hide_banner', '-i', 'score_raw.wav', '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).toString();
let m; try { m = JSON.parse(/\{[\s\S]*\}/.exec(execFileSync('sh', ['-c', `ffmpeg -hide_banner -i score_raw.wav -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json -f null - 2>&1`], { encoding: 'utf8' }))[0]); } catch { m = null; }
const af = m ? `loudnorm=I=-14:TP=-1:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true` : 'loudnorm=I=-14:TP=-1:LRA=11';
execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', 'score_raw.wav', '-af', af, '-ar', String(SR), 'score.wav']);
void probe;

// Measure the beat grid from the kick stem: onset = first sample crossing 30% of local peak near each expected beat.
const measured = [];
for (let b = 0; b < DUR / BEAT; b++) {
  const c = Math.round(b * BEAT * SR), w = Math.round(0.04 * SR);
  let peak = 0; for (let i = Math.max(0, c - w); i < Math.min(N, c + w); i++) peak = Math.max(peak, Math.abs(KICK[i]));
  if (peak < 0.05) continue;
  let on = c - w; while (on < c + w && Math.abs(KICK[on]) < peak * 0.3) on++;
  measured.push(+(on / SR).toFixed(4));
}
writeFileSync('beats.json', JSON.stringify({ bpm: 120, beat: BEAT, downbeats: [0, 2, 4, 6, 8, 10, 12, 14], beats: measured }, null, 2));
console.log(`beats measured: ${measured.length}`);
