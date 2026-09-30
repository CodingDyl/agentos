// node render.mjs              → full render: out/pantry-pilot-showreel.mp4 (H.264 yuv420p CRF 16 + score)
// node render.mjs --sheet      → sheet/contact.png, one frame per beat (at beat + 0.25s)
// node render.mjs --at 1.5,4.6 → sheet/at-<t>.png spot frames
import http from 'node:http';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const ROOT = dirname(fileURLToPath(import.meta.url));
process.chdir(ROOT);
const FPS = 30, DUR = 15, MB = 6;
const args = process.argv.slice(2);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  const p = join(ROOT, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => { console.error('PAGE ERROR', e.message); process.exitCode = 1; });
await page.goto(`http://localhost:${port}/`);
await page.evaluate(async (mb) => { await window.ready; window.MB = mb; }, MB);
const grab = async (t) => Buffer.from(await page.evaluate((t) => { window.seek(t); return document.getElementById('c').toDataURL('image/png').split(',')[1]; }, t), 'base64');

mkdirSync('sheet', { recursive: true }); mkdirSync('out', { recursive: true });
if (args[0] === '--sheet' || args[0] === '--at') {
  const times = args[0] === '--sheet' ? Array.from({ length: 30 }, (_, b) => b * 0.5 + 0.25) : args[1].split(',').map(Number);
  const files = [];
  for (const t of times) { const f = `sheet/at-${t.toFixed(2)}.png`; writeFileSync(f, await grab(t)); files.push(f); }
  if (args[0] === '--sheet') {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...files.flatMap((f) => ['-i', f]), '-filter_complex',
      files.map((_, i) => `[${i}]scale=216:384[v${i}]`).join(';') + ';' +
      files.map((_, i) => `[v${i}]`).join('') + `xstack=inputs=${files.length}:layout=` + files.map((_, i) => `${(i % 10) * 216}_${Math.floor(i / 10) * 384}`).join('|'),
      'sheet/contact.png']);
    console.log('sheet/contact.png');
  } else console.log(files.join('\n'));
} else {
  if (!existsSync('score.wav') || args.includes('--resynth')) execFileSync('node', ['synth.mjs'], { stdio: 'inherit' });
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-', '-i', 'score.wav',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-t', String(DUR), '-movflags', '+faststart', 'out/pantry-pilot-showreel.mp4'], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = 0; f < FPS * DUR; f++) {
    const buf = await grab(f / FPS);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 60 === 0) process.stdout.write(`frame ${f}/${FPS * DUR}\n`);
  }
  ff.stdin.end(); await new Promise((r) => ff.on('close', r));
  console.log('out/pantry-pilot-showreel.mp4');
}
await browser.close(); server.close();
