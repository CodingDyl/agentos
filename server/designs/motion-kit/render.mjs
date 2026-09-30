// AgentOS motion studio renderer. Reads film.config.json; drives index.html's window.seek(t).
//
//   node render.mjs --sheet [--round N]   one frame per beat → sheet/round-N.png (or sheet/contact.png)
//   node render.mjs --at 1.5,4.25          spot frames → sheet/at-<t>.png
//   node render.mjs [--format 1:1] [--out out/final-1x1.mp4]
//                                          full render, H.264 yuv420p CRF 16, + score.wav when present
//
// The page is loaded as index.html?width=W&height=H&format=F, so one timeline can lay itself out per format.
import http from 'node:http';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { extname, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const ROOT = dirname(fileURLToPath(import.meta.url));
process.chdir(ROOT);
const config = JSON.parse(readFileSync('film.config.json', 'utf8'));
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const SIZES = { '9:16': [1080, 1920], '1:1': [1080, 1080], '16:9': [1920, 1080] };
const format = flag('--format') ?? config.formats?.[0] ?? '9:16';
const [width, height] = SIZES[format] ?? [config.width ?? 1080, config.height ?? 1920];
const FPS = config.fps ?? 30, DUR = config.duration ?? 15, MB = Number(flag('--mb') ?? config.motionBlur ?? 1);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.wav': 'audio/wav' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const p = resolve(ROOT, '.' + (rel === '/' ? '/index.html' : rel));
  if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[extname(p).toLowerCase()] || 'application/octet-stream' }); res.end(readFileSync(p));
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => { console.error('PAGE ERROR', e.message); process.exitCode = 1; });
page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
await page.goto(`http://localhost:${port}/?width=${width}&height=${height}&format=${encodeURIComponent(format)}`);
await page.evaluate(async (mb) => { await window.ready; if (mb > 1) window.MB = mb; }, MB);
// The film draws to its first <canvas>, or the page is screenshotted when it has none.
const hasCanvas = await page.evaluate(() => Boolean(document.querySelector('canvas')));
const grab = async (t) => {
  if (hasCanvas) return Buffer.from(await page.evaluate((t) => { window.seek(t); return document.querySelector('canvas').toDataURL('image/png').split(',')[1]; }, t), 'base64');
  await page.evaluate((t) => window.seek(t), t);
  return page.screenshot({ type: 'png' });
};

mkdirSync('sheet', { recursive: true }); mkdirSync('out', { recursive: true });
if (args.includes('--sheet') || args.includes('--at')) {
  let times;
  if (args.includes('--at')) times = flag('--at').split(',').map(Number);
  else {
    // One frame per beat, a quarter-beat in so each shows its beat's move landing.
    const beats = existsSync('beats.json') ? JSON.parse(readFileSync('beats.json', 'utf8')) : null;
    const beat = beats?.beat ?? 60 / (config.bpm ?? 120);
    const grid = beats?.beats?.length ? beats.beats : Array.from({ length: Math.floor(DUR / beat) }, (_, i) => i * beat);
    times = grid.map((t) => Math.min(DUR - 1 / FPS, t + beat / 4));
  }
  const files = [];
  for (const t of times) { const f = `sheet/at-${t.toFixed(2)}.png`; writeFileSync(f, await grab(t)); files.push(f); }
  if (args.includes('--sheet')) {
    const cols = width >= height ? 6 : 10, tw = width >= height ? 320 : 216, th = Math.round(tw * height / width);
    const name = flag('--round') ? `sheet/round-${flag('--round')}.png` : 'sheet/contact.png';
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...files.flatMap((f) => ['-i', f]), '-filter_complex',
      files.map((_, i) => `[${i}]scale=${tw}:${th}[v${i}]`).join(';') + ';' + files.map((_, i) => `[v${i}]`).join('') +
      (files.length > 1 ? `xstack=inputs=${files.length}:fill=black:layout=` + files.map((_, i) => `${(i % cols) * tw}_${Math.floor(i / cols) * th}`).join('|') : 'null'),
      name]);
    console.log(name);
  } else console.log(files.join('\n'));
} else {
  const out = flag('--out') ?? (format === (config.formats?.[0] ?? '9:16') ? 'out/final.mp4' : `out/final-${format.replace(':', 'x')}.mp4`);
  mkdirSync(dirname(out), { recursive: true });
  const audio = existsSync('score.wav') ? ['-i', 'score.wav', '-c:a', 'aac', '-b:a', '256k'] : [];
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-', ...audio.slice(0, 2),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', ...audio.slice(2), '-t', String(DUR), '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = 0; f < FPS * DUR; f++) {
    const buf = await grab(f / FPS);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 60 === 0) console.log(`frame ${f}/${FPS * DUR}`);
  }
  ff.stdin.end(); await new Promise((r) => ff.on('close', r));
  console.log(out);
}
await browser.close(); server.close();
