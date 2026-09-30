// Pantry Pilot — 15s showreel. Pure function of time: window.seek(t) paints frame t.
// 1080x1920, 120 BPM (beat = 0.5s, bar = 2s). No timers, no Math.random, no carried state.
const W = 1080, H = 1920, DUR = 15;
const COL = {
  paper: '#F1F8F4', white: '#FFFFFF', ink: '#10231A', logo: '#1F4036',
  green: '#2E7D32', lime: '#64D27A', mid: '#4CAF50', muted: '#647273',
  mutedDark: '#A8B6AE', hair: 'rgba(0,0,0,0.08)',
};

// ---------- math ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const eo = (x) => 1 - Math.pow(1 - x, 3);
const eio = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const expo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const back = (x) => { const c = 2.2, c3 = c + 1; return 1 + c3 * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
// Damped spring, u in seconds since start. 0 → 1 with overshoot.
const spring = (u, f = 2, d = 8) => (u <= 0 ? 0 : 1 - Math.exp(-d * u) * Math.cos(2 * Math.PI * f * u));
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = (seed) => mulberry32(seed * 9973 + 17)();
function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(a, b, k) { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], clamp(k)))).join(',')})`; }

// ---------- canvas + assets ----------
const main = document.getElementById('c'); main.width = W; main.height = H;
const mctx = main.getContext('2d');
const scratch = document.createElement('canvas'); scratch.width = W; scratch.height = H;
const sctx = scratch.getContext('2d');
let ctx = mctx;

const IMG = {};
function loadImg(k, src) { return new Promise((res) => { const i = new Image(); i.onload = () => i.decode().then(() => { IMG[k] = i; res(); }); i.src = src; }); }
const fonts = [
  new FontFace('Man', 'url(assets/Manrope_800ExtraBold.ttf)', { weight: '800' }),
  new FontFace('Int', 'url(assets/Inter_500Medium.ttf)', { weight: '500' }),
  new FontFace('Int', 'url(assets/Inter_600SemiBold.ttf)', { weight: '600' }),
];
window.ready = Promise.all([
  ...fonts.map((f) => f.load().then((ff) => document.fonts.add(ff))),
  loadImg('wave', 'assets/waving_bean.png'),
  loadImg('cele', 'assets/celebrate_bean.png'),
  loadImg('wink', 'assets/winking_bean.png'),
]);

const LOGO = new Path2D('M508.749 317.399C516.777 287.314 508.991 253.884 485.389 230.282C461.788 206.681 428.36 198.895 398.273 206.923C376.231 184.928 343.39 174.956 311.148 183.596C278.906 192.234 255.45 217.292 247.36 247.361C217.291 255.451 192.233 278.91 183.595 311.149C174.957 343.391 184.927 376.232 206.924 398.274C198.896 428.359 206.683 461.789 230.284 485.391C253.885 508.992 287.313 516.779 317.401 508.75C339.442 530.745 372.286 540.717 404.525 532.079C436.767 523.441 460.223 498.384 468.313 468.315C498.383 460.224 523.44 436.766 532.078 404.526C540.716 372.285 530.747 339.443 508.749 317.402V317.399ZM470.899 244.776C486.892 260.77 493.488 282.601 490.687 303.412L415.577 260.046C412.411 258.218 408.509 258.218 405.345 260.046L317.401 310.82V277.526C317.401 275.191 318.652 273.005 320.676 271.837L387.644 233.174C414.178 218.353 448.346 222.223 470.901 244.776H470.899ZM357.837 311.144L398.275 334.491V381.185L357.837 404.532L317.398 381.185V334.491L357.837 311.144ZM264.776 269.693C265.207 239.305 285.644 211.649 316.453 203.393C338.3 197.54 360.505 202.744 377.127 215.573L302.014 258.937C298.848 260.764 296.898 264.144 296.898 267.798V369.346L268.065 352.699C266.043 351.531 264.776 349.353 264.776 347.017V269.691V269.693ZM203.391 316.454C209.244 294.608 224.854 277.978 244.276 269.999V356.73C244.276 360.384 246.226 363.763 249.392 365.591L337.337 416.365L308.503 433.013C306.481 434.181 303.961 434.188 301.939 433.02L234.971 394.357C208.868 378.789 195.138 347.261 203.391 316.454ZM244.775 470.9C228.781 454.906 222.186 433.075 224.986 412.264L300.096 455.63C303.263 457.457 307.164 457.457 310.328 455.63L398.273 404.856V438.149C398.273 440.485 397.022 442.671 394.997 443.839L328.029 482.502C301.495 497.322 267.327 493.452 244.772 470.9H244.775ZM450.897 445.982C450.466 476.371 430.029 504.027 399.22 512.283C377.373 518.136 355.168 512.932 338.547 500.102L413.659 456.738C416.826 454.911 418.775 451.532 418.775 447.877V346.329L447.609 362.977C449.631 364.145 450.897 366.323 450.897 368.659V445.985V445.982ZM512.282 399.221C506.429 421.068 490.819 437.697 471.397 445.676V358.946C471.397 355.292 469.448 351.912 466.281 350.085L378.336 299.311L407.17 282.663C409.192 281.495 411.712 281.487 413.734 282.655L480.702 321.318C506.805 336.887 520.536 368.415 512.282 399.221Z');
const LC = 357.8; // logo path centre in its own units (~350 wide)
function logoXf(cx, cy, s, rot) { ctx.translate(cx, cy); ctx.rotate(rot); ctx.scale(s, s); ctx.translate(-LC, -LC); }

// ---------- drawing helpers ----------
function bg(c) { ctx.fillStyle = c; ctx.fillRect(-W, -H, W * 3, H * 3); }
function font(size, f = 'M', w = 800) { ctx.font = `${f === 'M' ? 800 : w} ${size}px ${f === 'M' ? 'Man' : 'Int'}`; ctx.letterSpacing = (f === 'M' ? -0.035 * size : 0) + 'px'; }
function T(s, x, y, { size = 100, f = 'M', w = 800, c = COL.logo, al = 'left' } = {}) {
  font(size, f, w); ctx.fillStyle = c; ctx.textAlign = al; ctx.textBaseline = 'alphabetic'; ctx.fillText(s, x, y);
}
function measure(s, size, f = 'M', w = 800) { font(size, f, w); return ctx.measureText(s).width; }
// Masked line rise: pin 0→1 brings it up into place, pout 0→1 pushes it out the top.
function rise(s, x, y, size, pin, pout = 0, o = {}) {
  if (pin <= 0 || pout >= 1) return;
  ctx.save(); ctx.beginPath(); ctx.rect(-W, y - size * 1.0, W * 3, size * 1.28); ctx.clip();
  T(s, x, y + (1 - pin) * size * 1.15 - pout * size * 1.15, { size, ...o }); ctx.restore();
}
// Word slam: arrives oversized and settles with a spring.
function slam(s, x, y, size, u, o = {}) {
  if (u < 0) return;
  const sc = 1 + 1.15 * (1 - spring(u, 2.6, 9));
  ctx.save(); ctx.globalAlpha *= clamp(u / 0.05); ctx.translate(x, y - size * 0.35); ctx.scale(sc, sc);
  T(s, 0, size * 0.35, { size, ...o }); ctx.restore();
}
function circlePath(x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2); }
function tick(cx, cy, s, k, c, lw) { // checkmark drawn 0→1
  if (k <= 0) return;
  const pts = [[-0.42, 0.02], [-0.12, 0.32], [0.46, -0.3]];
  const l1 = Math.hypot(0.3, 0.3), l2 = Math.hypot(0.58, 0.62), L = (l1 + l2) * k;
  ctx.save(); ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
  ctx.moveTo(cx + pts[0][0] * s, cy + pts[0][1] * s);
  if (L <= l1) { const q = L / l1; ctx.lineTo(cx + lerp(pts[0][0], pts[1][0], q) * s, cy + lerp(pts[0][1], pts[1][1], q) * s); }
  else { const q = (L - l1) / l2; ctx.lineTo(cx + pts[1][0] * s, cy + pts[1][1] * s); ctx.lineTo(cx + lerp(pts[1][0], pts[2][0], q) * s, cy + lerp(pts[1][1], pts[2][1], q) * s); }
  ctx.stroke(); ctx.restore();
}

// Line icons on a ~130px box, stroke only.
function icon(name, x, y, s, c) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.strokeStyle = c; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
  switch (name) {
    case 'egg': ctx.ellipse(0, 4, 46, 60, 0, 0, 7); break;
    case 'tomato': ctx.arc(0, 12, 54, 0, 7); ctx.moveTo(0, -42); ctx.lineTo(0, -64); ctx.moveTo(-28, -36); ctx.lineTo(0, -44); ctx.lineTo(28, -36); break;
    case 'carrot': ctx.moveTo(-30, -28); ctx.lineTo(30, -28); ctx.lineTo(0, 64); ctx.closePath(); ctx.moveTo(-14, 4); ctx.lineTo(4, 4); ctx.moveTo(-5, 30); ctx.lineTo(7, 30);
      ctx.moveTo(0, -28); ctx.lineTo(-16, -60); ctx.moveTo(0, -28); ctx.lineTo(0, -66); ctx.moveTo(0, -28); ctx.lineTo(16, -60); break;
    case 'milk': ctx.moveTo(-36, -18); ctx.lineTo(-36, 64); ctx.lineTo(36, 64); ctx.lineTo(36, -18); ctx.lineTo(24, -44); ctx.lineTo(-24, -44); ctx.closePath();
      ctx.moveTo(-36, -18); ctx.lineTo(36, -18); ctx.rect(-12, -64, 24, 20); break;
    case 'bread': ctx.moveTo(-50, 58); ctx.lineTo(-50, -6); ctx.bezierCurveTo(-80, -22, -58, -60, 0, -60); ctx.bezierCurveTo(58, -60, 80, -22, 50, -6); ctx.lineTo(50, 58); ctx.closePath();
      ctx.moveTo(-22, -26); ctx.lineTo(-10, -8); ctx.moveTo(8, -26); ctx.lineTo(20, -8); break;
    case 'lemon': ctx.ellipse(0, 0, 56, 40, -0.35, 0, 7); ctx.moveTo(52, -24); ctx.lineTo(66, -32); ctx.moveTo(-52, 24); ctx.lineTo(-66, 32); break;
    case 'pepper': ctx.moveTo(-10, -34); ctx.bezierCurveTo(-62, -44, -64, 22, -44, 50); ctx.bezierCurveTo(-30, 70, -10, 62, 0, 54); ctx.bezierCurveTo(10, 62, 30, 70, 44, 50);
      ctx.bezierCurveTo(64, 22, 62, -44, 10, -34); ctx.closePath(); ctx.moveTo(0, -36); ctx.bezierCurveTo(0, -56, 10, -62, 24, -64); break;
    case 'onion': ctx.moveTo(0, -64); ctx.bezierCurveTo(10, -40, 62, -20, 56, 20); ctx.bezierCurveTo(52, 56, 20, 64, 0, 64); ctx.bezierCurveTo(-20, 64, -52, 56, -56, 20);
      ctx.bezierCurveTo(-62, -20, -10, -40, 0, -64); ctx.moveTo(0, -36); ctx.bezierCurveTo(-24, -8, -24, 38, 0, 62); break;
    case 'cheese': ctx.moveTo(-60, 44); ctx.lineTo(60, 44); ctx.lineTo(60, -34); ctx.lineTo(-60, 4); ctx.closePath(); ctx.moveTo(28, 14); ctx.arc(18, 14, 10, 0, 7); ctx.moveTo(-12, 28); ctx.arc(-20, 28, 7, 0, 7); break;
  }
  ctx.stroke(); ctx.restore();
}

// ---------- shared layout ----------
const TILES = [['Eggs', 'egg'], ['Tomatoes', 'tomato'], ['Carrots', 'carrot'], ['Milk', 'milk'], ['Bread', 'bread'], ['Lemons', 'lemon'], ['Peppers', 'pepper'], ['Onions', 'onion'], ['Cheese', 'cheese']];
const CHOSEN = [0, 1, 6];
const TS = 290;
const tileXY = (i) => [75 + (i % 3) * 320, 640 + ((i / 3) | 0) * 320];
const CARD = { cx: 540, cy: 1120, w: 900, h: 1000 };
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MEALS = [['Green shakshuka', 'egg'], ['Lemon pasta', 'lemon'], ['Tomato soup', 'tomato'], ['Egg fried rice', 'egg'], ['Veggie tacos', 'pepper'], ['Pepper frittata', 'pepper'], ['Leftovers night', 'bread']];
const rowY = (i) => 560 + i * 175;
const GROC = ['Feta', 'Fresh spinach', 'Chickpeas', 'Greek yogurt', 'Sourdough'];
const CHECK_T = (i) => 8.5 + i * 0.25;
const grocY = (i) => 660 + i * 150;

function tile(i, x, y, s, a, inv, rot) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha *= a; ctx.translate(x + TS / 2, y + TS / 2); ctx.rotate(rot); ctx.scale(s, s);
  ctx.beginPath(); ctx.roundRect(-TS / 2, -TS / 2, TS, TS, 46);
  ctx.fillStyle = mix(COL.white, COL.logo, inv); ctx.fill();
  if (inv < 0.5) { ctx.strokeStyle = COL.hair; ctx.lineWidth = 3; ctx.stroke(); }
  icon(TILES[i][1], 0, -28, 1, mix(COL.logo, COL.lime, inv));
  T(TILES[i][0], 0, 110, { size: 40, f: 'I', w: 600, c: mix(COL.muted, COL.paper, inv), al: 'center' });
  ctx.restore();
}

// ---------- scene 1: the question (0–2) ----------
function s1(t) {
  bg(COL.ink);
  let sx = 0, sy = 0;
  for (const h of [0, 0.5, 1, 1.5]) if (t >= h) { const d = t - h, a = 30 * Math.exp(-d * 13); sx += a * Math.sin(d * 83 + h * 7); sy += a * Math.cos(d * 71 + h * 3); }
  ctx.save(); ctx.translate(sx, sy);
  if (t >= 1.5) { // giant question mark crashes in behind
    const s = spring(t - 1.5, 2.2, 7.5);
    ctx.save(); ctx.translate(640, 1780); ctx.rotate((1 - s) * -1.1); ctx.scale(0.3 + 0.7 * s, 0.3 + 0.7 * s);
    T('?', 0, 0, { size: 1000, c: COL.green, al: 'center' }); ctx.restore();
  }
  slam("WHAT'S", 84, 640, 215, t - 0.0, { c: COL.paper });
  slam('FOR', 84, 860, 215, t - 0.5, { c: COL.lime });
  slam('DINNER', 84, 1080, 215, t - 1.0, { c: COL.paper });
  const u = eo(prog(t, 1.02, 1.3)); // underline wipe
  if (u > 0) { ctx.fillStyle = COL.lime; ctx.fillRect(84, 1122, 790 * u, 22); }
  ctx.restore();
}

// ---------- scene 2+3: pantry → match (1.8–6) ----------
function titleA(t) {
  const out = eo(prog(t, 4.0, 4.3));
  rise('What you', 75, 330, 118, eo(prog(t, 2.0, 2.35)), out);
  rise('already have.', 75, 458, 118, eo(prog(t, 2.08, 2.43)), out, { c: COL.green });
}
function titleB(t, outT = 99) {
  const out = eo(prog(t, outT, outT + 0.3));
  rise('Dinner,', 75, 330, 118, eo(prog(t, 4.5, 4.85)), out);
  rise('decided.', 75, 458, 118, eo(prog(t, 4.58, 4.93)), out, { c: COL.green });
}
function panArt(t, eggT) {
  ctx.save(); ctx.rotate(t * 0.12);
  ctx.fillStyle = COL.ink;
  ctx.save(); ctx.rotate(-0.55); ctx.beginPath(); ctx.roundRect(190, -26, 230, 52, 26); ctx.fill(); ctx.restore();
  circlePath(0, 0, 228); ctx.fill();
  circlePath(0, 0, 192); ctx.fillStyle = COL.mid; ctx.fill();
  for (let i = 0; i < 26; i++) {
    const a = rnd(i) * 6.283, r = Math.sqrt(rnd(i + 50)) * 170;
    circlePath(Math.cos(a) * r, Math.sin(a) * r, 5 + rnd(i + 90) * 14); ctx.fillStyle = i % 2 ? '#3E9B43' : COL.lime; ctx.fill();
  }
  for (let k = 0; k < 4; k++) {
    const s = spring(t - (eggT + k * 0.125), 2.4, 8); if (s <= 0) continue;
    const a = k * Math.PI / 2 + 0.6, ex = Math.cos(a) * 98, ey = Math.sin(a) * 98;
    ctx.save(); ctx.translate(ex, ey); ctx.scale(s, s); ctx.rotate(a);
    ctx.beginPath(); ctx.ellipse(0, 0, 62, 52, 0, 0, 7); ctx.fillStyle = COL.white; ctx.fill();
    circlePath(6, -2, 25); ctx.fillStyle = '#F4DFA0'; ctx.fill();
    circlePath(-2, -10, 7); ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}
function chip(x, y, label, k) {
  if (k <= 0) return;
  const w = measure(label, 32, 'I', 600) + 56;
  ctx.save(); ctx.translate(x + w / 2, y + 30); ctx.scale(back(k), back(k)); ctx.globalAlpha *= clamp(k * 3);
  ctx.beginPath(); ctx.roundRect(-w / 2, -30, w, 60, 30); ctx.strokeStyle = COL.green; ctx.lineWidth = 4; ctx.stroke();
  T(label, 0, 11, { size: 32, f: 'I', w: 600, c: COL.green, al: 'center' });
  ctx.restore();
  return w;
}
function cardContent(t) { // local coords, card centred at 0,0
  const { w, h } = CARD;
  ctx.save(); ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, 560, [48, 48, 0, 0]); ctx.clip();
  ctx.fillStyle = COL.green; ctx.fillRect(-w / 2, -h / 2, w, 560);
  ctx.translate(-20, -220); panArt(t, 4.875); ctx.restore();
  rise('Green shakshuka', -392, 170, 76, eo(prog(t, 5.0, 5.3)));
  rise('Eggs · Tomatoes · Peppers', -392, 238, 38, eo(prog(t, 5.12, 5.42)), 0, { f: 'I', w: 500, c: COL.muted });
  const w1 = chip(-392, 282, '20 min', prog(t, 5.25, 5.55)) || 0;
  chip(-392 + w1 + 18, 282, '3 from your pantry', prog(t, 5.375, 5.675));
  const b = eo(prog(t, 5.5, 5.8));
  if (b > 0) {
    ctx.save(); ctx.beginPath(); ctx.rect(-w / 2, 370, w, 130); ctx.clip();
    ctx.translate(0, (1 - b) * 120); ctx.beginPath(); ctx.roundRect(-392, 378, 784, 92, 46); ctx.fillStyle = COL.green; ctx.fill();
    T('Cook this', 0, 438, { size: 40, f: 'I', w: 600, c: COL.white, al: 'center' }); ctx.restore();
  }
}
function drawCard(t, sc) {
  ctx.save(); ctx.translate(CARD.cx, CARD.cy); ctx.scale(sc, sc);
  ctx.beginPath(); ctx.roundRect(-CARD.w / 2, -CARD.h / 2, CARD.w, CARD.h, 48); ctx.fillStyle = COL.white; ctx.fill();
  ctx.strokeStyle = COL.hair; ctx.lineWidth = 3; ctx.stroke();
  cardContent(t); ctx.restore();
}
function s2(t) {
  bg(COL.paper);
  titleA(t); titleB(t);
  for (let i = 0; i < 9; i++) {
    const [x, y] = tileXY(i), chosen = CHOSEN.includes(i), u = t - (2.125 + i * 0.125);
    if (u < 0) continue;
    const sp = spring(u, 2.0, 8.5);
    let yy = y - 460 * (1 - sp), rot = (rnd(i + 3) - 0.5) * 0.9 * (1 - sp), a = clamp(u / 0.08), s = 1, inv = 0;
    if (chosen) {
      const ci = CHOSEN.indexOf(i), ti = 3.5 + ci * 0.125;
      inv = eo(prog(t, ti, ti + 0.15)); s = 1 + 0.1 * Math.sin(Math.PI * prog(t, ti, ti + 0.25));
      if (t >= 4.0) { // fly to the pot
        const k = eio(prog(t, 4.0, 4.5)), sx0 = x + TS / 2, sy0 = y + TS / 2, ex = 540, ey = 900;
        const cxp = (sx0 + ex) / 2 + (ci - 1) * 380, cyp = Math.min(sy0, ey) - 380;
        const bx = (1 - k) * (1 - k) * sx0 + 2 * (1 - k) * k * cxp + k * k * ex, by = (1 - k) * (1 - k) * sy0 + 2 * (1 - k) * k * cyp + k * k * ey;
        s = lerp(1, 0.35, k); rot = (ci - 1 || 1) * 2.2 * k; a = k < 0.98 ? 1 : 0;
        tile(i, bx - TS / 2, by - TS / 2, s, a, inv, rot); continue;
      }
    } else {
      const d = eo(prog(t, 3.55, 3.95)); a *= 1 - 0.78 * d; s = 1 - 0.1 * d;
      a *= 1 - prog(t, 4.0, 4.25);
    }
    tile(i, x, yy, s, a, inv, rot);
  }
  // expiry callout on Peppers (the thing that drives tonight's meal)
  const e = prog(t, 3.2, 3.5);
  if (e > 0 && t < 4.05) {
    const [x, y] = tileXY(6), dash = 4 * TS;
    ctx.save(); ctx.beginPath(); ctx.roundRect(x - 10, y - 10, TS + 20, TS + 20, 54);
    ctx.setLineDash([dash * eo(e), dash]); ctx.strokeStyle = COL.lime; ctx.lineWidth = 10; ctx.globalAlpha = 1 - prog(t, 3.85, 4.05); ctx.stroke(); ctx.restore();
    const k = prog(t, 3.25, 3.55), label = 'Use in 2 days', w = measure(label, 34, 'I', 600) + 60;
    ctx.save(); ctx.translate(x + 30 + w / 2, y - 34); ctx.scale(back(k), back(k)); ctx.globalAlpha = clamp(k * 3) * (1 - prog(t, 3.85, 4.05));
    ctx.beginPath(); ctx.roundRect(-w / 2, -34, w, 68, 34); ctx.fillStyle = COL.green; ctx.fill();
    T(label, 0, 12, { size: 34, f: 'I', w: 600, c: COL.white, al: 'center' }); ctx.restore();
  }
  // merge rings
  for (let r = 0; r < 2; r++) {
    const k = prog(t, 4.45 + r * 0.07, 4.9 + r * 0.07); if (k <= 0 || k >= 1) continue;
    circlePath(540, 900, lerp(40, 760, expo(k))); ctx.strokeStyle = r ? COL.green : COL.lime; ctx.lineWidth = 46 * (1 - k); ctx.stroke();
  }
  if (t >= 4.5) drawCard(t, spring(t - 4.5, 1.7, 7.5));
}

// ---------- scene 4: plan (6–8) ----------
function row(i, x, y, w, fill, dayC, mealC, a, markK) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha *= a;
  ctx.beginPath(); ctx.roundRect(x, y, w, 150, 36); ctx.fillStyle = fill; ctx.fill();
  if (i) { ctx.strokeStyle = COL.hair; ctx.lineWidth = 3; ctx.stroke(); }
  T(DAYS[i], x + 44, y + 58, { size: 34, f: 'I', w: 600, c: dayC });
  T(MEALS[i][0], x + 44, y + 118, { size: 54, c: mealC });
  const cx = x + w - 88, cy = y + 75;
  circlePath(cx, cy, 50); ctx.fillStyle = i ? mix(COL.paper, COL.green, markK) : COL.white; ctx.fill();
  if (markK < 0.5 || !i) icon(MEALS[i][1], cx, cy, 0.42 * (1 - (i ? eo(markK * 2) : 0)), COL.green);
  if (i) tick(cx, cy, 52, prog(markK, 0.4, 1), COL.white, 9);
  ctx.restore();
}
function s4(t) {
  bg(COL.paper);
  titleB(t, 6.0);
  rise('The week,', 75, 300, 118, eo(prog(t, 6.15, 6.5)));
  rise('planned.', 75, 428, 118, eo(prog(t, 6.23, 6.58)), 0, { c: COL.green });
  // shakshuka card collapses into Monday
  const k = eio(prog(t, 6.0, 6.45));
  const x = lerp(CARD.cx - CARD.w / 2, 75, k), y = lerp(CARD.cy - CARD.h / 2, rowY(0), k), w = lerp(CARD.w, 930, k), h = lerp(CARD.h, 150, k);
  if (k < 1) {
    ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, lerp(48, 36, k)); ctx.fillStyle = mix(COL.white, COL.green, k); ctx.fill(); ctx.clip();
    ctx.globalAlpha = 1 - clamp(k / 0.45); ctx.translate(x + w / 2, y + h / 2); cardContent(t); ctx.restore();
  }
  row(0, 75, rowY(0) + (1 - k) * 0, 930, COL.green, '#CFE8D3', COL.white, prog(k, 0.6, 1), 0);
  for (let i = 1; i < 7; i++) {
    const ti = 6.375 + (i - 1) * 0.125, s = expo(prog(t, ti, ti + 0.45));
    ctx.save(); ctx.translate(1150 * (1 - s), 0);
    row(i, 75, rowY(i), 930, COL.white, COL.muted, COL.logo, clamp(s * 4), prog(t, 7.0 + i * 0.07, 7.25 + i * 0.07));
    ctx.restore();
  }
}

// ---------- scene 5: groceries (7.6–10) ----------
function s5(t) {
  bg(COL.ink);
  rise('Shopping,', 75, 300, 118, 1, 0, { c: COL.paper });
  rise('sorted.', 75, 428, 118, 1, 0, { c: COL.lime });
  let left = 5, lastC = -9;
  for (let i = 0; i < 5; i++) {
    const c = CHECK_T(i), k = t - c, y = grocY(i);
    if (k >= 0) { left--; lastC = c; }
    const pop = spring(k, 2.6, 9), cx = 130, cy = y;
    circlePath(cx, cy, 38); ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 5; ctx.stroke();
    if (k >= 0) { circlePath(cx, cy, 38 * pop); ctx.fillStyle = COL.lime; ctx.fill(); tick(cx, cy, 44, prog(k, 0.03, 0.16), COL.ink, 9); }
    const dim = prog(k, 0.05, 0.25);
    ctx.save(); ctx.globalAlpha = 1 - 0.62 * dim;
    T(GROC[i], 205, cy + 20, { size: 58, f: 'I', w: 600, c: COL.paper });
    const sw = measure(GROC[i], 58, 'I', 600) * eo(prog(k, 0.05, 0.22));
    if (sw > 0) { ctx.fillStyle = COL.paper; ctx.fillRect(205, cy - 3, sw, 6); }
    ctx.restore();
  }
  T('left to buy', 80, 1455, { size: 44, f: 'I', w: 500, c: COL.mutedDark });
  const r = eo(prog(t, lastC, lastC + 0.2)), base = 1780, size = 400;
  ctx.save(); ctx.beginPath(); ctx.rect(0, base - size * 0.78, W, size * 0.9); ctx.clip();
  if (r < 1) T(String(left + 1), 70, base - r * size * 0.85, { size, c: COL.lime });
  T(String(left), 70, base + (1 - r) * size * 0.85, { size, c: COL.lime });
  ctx.restore();
}

// ---------- scene 6: mascot (9.75–12.35) ----------
function s6(t) {
  bg(COL.green);
  ctx.save(); ctx.globalAlpha = 0.16; logoXf(540, 1150, 3.3, t * 0.22); ctx.fillStyle = COL.lime; ctx.fill(LOGO); ctx.restore();
  slam('Less waste.', 75, 330, 130, t - 10.5, { c: COL.white });
  slam('Less stress.', 75, 480, 130, t - 11.0, { c: COL.ink });
  // bean: rise in with stretch, hop on 11.0, land on 11.5
  const sp = spring(t - 10.05, 1.7, 7);
  let ty = (1 - sp) * 1150, sx = 1, sy = 1 + 0.28 * clamp(1 - sp);
  sx = 1 - 0.14 * clamp(1 - sp);
  if (t >= 10.9 && t < 11.0) { const q = prog(t, 10.9, 11.0); sy = 1 - 0.12 * q; sx = 1 + 0.1 * q; }
  if (t >= 11.0 && t < 11.5) { const q = prog(t, 11.0, 11.5); ty -= 300 * Math.sin(Math.PI * q); sy = 1 + 0.12 * Math.cos(Math.PI * q); sx = 1 - 0.06 * Math.cos(Math.PI * q); }
  if (t >= 11.5) { const q = 0.17 * Math.exp(-(t - 11.5) * 8) * Math.cos((t - 11.5) * 26); sy = 1 - q; sx = 1 + q * 0.8; }
  const img = t < 11.0 ? IMG.wave : IMG.cele, S = 1150, foot = 1840;
  ctx.save(); ctx.translate(540, foot + ty); ctx.scale(sx, sy);
  ctx.drawImage(img, -S / 2, -S * 0.84, S, S); ctx.restore();
}

// ---------- scene 7: resolve (11.75–15) ----------
const LX = 540, LY = 800, LS = 1.45;
function s7(t) {
  bg(COL.paper);
  const lift = eio(prog(t, 14.0, 14.4));
  const bs = spring(t - 14.0, 2.0, 7.5);
  if (bs > 0) { // winking bean peeks up from the bottom edge on the final hit
    const S = 820;
    ctx.save(); ctx.translate(540, 2010 + (1 - bs) * 700); ctx.rotate((1 - bs) * 0.4); ctx.scale(1 + 0.1 * (1 - bs), 1 - 0.1 * (1 - bs));
    ctx.drawImage(IMG.wink, -S / 2, -S * 0.84, S, S); ctx.restore();
  }
  ctx.save(); ctx.translate(0, -230 * lift);
  if (t >= 12.35) {
    const u = t - 12.35, pulse = 0.07 * Math.exp(-u * 6) * Math.sin(u * 22) + (t >= 14 ? 0.05 * Math.exp(-(t - 14) * 7) * Math.sin((t - 14) * 24) : 0);
    ctx.save(); logoXf(LX, LY, LS * (1 + pulse), u * 0.06); ctx.fillStyle = COL.green; ctx.fill(LOGO); ctx.restore();
  }
  // wordmark, letter by letter
  const word = 'Pantry Pilot', size = 138, total = measure(word, size);
  let x0 = LX - total / 2;
  ctx.save(); ctx.beginPath(); ctx.rect(0, 1300 - size, W, size * 1.3); ctx.clip();
  for (let i = 0; i < word.length; i++) {
    const pre = measure(word.slice(0, i), size), s = spring(t - (12.5 + i * 0.035), 2.2, 9);
    if (s <= 0) continue;
    T(word[i], x0 + pre, 1300 + 170 * (1 - s), { size, c: COL.logo });
  }
  ctx.restore();
  const tl = eo(prog(t, 13.1, 13.45));
  ctx.save(); ctx.beginPath(); ctx.rect(0, 1340, W, 80); ctx.clip();
  T("Know what's for dinner.", LX, 1398 + (1 - tl) * 70, { size: 58, f: 'I', w: 500, c: COL.muted, al: 'center' }); ctx.restore();
  const b = prog(t, 13.6, 14.0);
  if (b > 0) {
    const flash = t >= 14 ? Math.exp(-(t - 14) * 5) : 0;
    ctx.save(); ctx.translate(LX, 1570); ctx.scale(back(b), back(b));
    ctx.beginPath(); ctx.roundRect(-270, -58, 540, 116, 58); ctx.fillStyle = mix(COL.green, COL.mid, flash); ctx.fill();
    T('Become a tester', 0, 16, { size: 44, f: 'I', w: 600, c: COL.white, al: 'center' }); ctx.restore();
  }
  ctx.restore();
}

// ---------- timeline ----------
function frame(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  if (t < 1.8) s1(t);
  else if (t < 2.2) { // iris out of the question mark's dot
    s1(t); const k = prog(t, 1.8, 2.2), r = 2400 * Math.pow(k, 2.3);
    ctx.save(); circlePath(640, 1720, r); ctx.clip(); s2(t); ctx.restore();
    circlePath(640, 1720, r); ctx.strokeStyle = COL.lime; ctx.lineWidth = 34 * (1 - k); ctx.stroke();
  }
  else if (t < 6) s2(t);
  else if (t < 7.6) s4(t);
  else if (t < 8.05) { // whip pan
    const k = eio(prog(t, 7.6, 8.05));
    ctx.save(); ctx.translate(-k * W, 0); s4(t); ctx.restore();
    ctx.save(); ctx.translate(W - k * W, 0); s5(t); ctx.restore();
  }
  else if (t < 9.75) s5(t);
  else if (t < 10.12) { // last checkbox floods the screen
    s5(t); const k = prog(t, 9.75, 10.12), r = 2400 * Math.pow(k, 2.2);
    ctx.save(); circlePath(130, grocY(4), r); ctx.clip(); s6(t); ctx.restore();
  }
  else if (t < 11.75) s6(t);
  else if (t < 12.35) { // green world collapses into the logo
    s7(t); const k = eio(prog(t, 11.75, 12.35)), sc = LS * Math.pow(26, 1 - k), rot = (1 - k) * -1.3;
    ctx.save(); logoXf(LX, LY, sc, rot); ctx.clip(LOGO); ctx.setTransform(1, 0, 0, 1, 0, 0); s6(t); ctx.restore();
  }
  else s7(t);
}

// Sub-frame motion blur: running average of N samples across a 180° shutter.
window.MB = 1;
window.seek = function (t) {
  const N = window.MB | 0;
  if (N <= 1) { ctx = mctx; frame(t); return; }
  for (let k = 0; k < N; k++) {
    ctx = sctx; frame(clamp(t + (k / N - 0.5) / 60, 0, DUR - 1e-3));
    mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.globalAlpha = 1 / (k + 1); mctx.drawImage(scratch, 0, 0);
  }
  mctx.globalAlpha = 1; ctx = mctx;
};
window.DUR = DUR;

if (location.search.includes('preview')) {
  window.ready.then(() => { const t0 = performance.now(); const loop = () => { window.seek(((performance.now() - t0) / 1000) % DUR); requestAnimationFrame(loop); }; loop(); });
} else window.ready.then(() => window.seek(0));
