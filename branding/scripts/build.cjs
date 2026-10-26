// Generates every Remy logo asset from the ASCII source.
//   cd branding/scripts && npm i --no-save figlet@1.8.0 opentype.js@1.3.4 && node build.cjs
// SVGs are written as outlined paths, so they render identically everywhere.
// PNGs are rasterized afterwards by render.sh (headless Chrome).

const fs = require('node:fs');
const path = require('node:path');
const figlet = require('figlet');
const opentype = require('opentype.js');

const ROOT = path.resolve(__dirname, '..');
const loadFont = (weight) => opentype.loadSync(path.join(ROOT, `fonts/JetBrainsMono-${weight}.ttf`));
const LOGO = loadFont('Bold');
const TEXT = loadFont('Medium');

// Below 1.1 the brackets and underscores collide with the next row.
const LINE_HEIGHT = 1.1;
const TAGLINE = 'Your assistant, anywhere.';

const C = {
  ink: '#0F0F10',
  paper: '#EDEBE6',
  stone: '#8C8A85',
  signal: '#A8C49A',
};

// The wordmark brightens slightly from top to bottom, echoing its density ramp.
// Kept subtle: the top rows must stay readable.
const RAMP = {
  dark: ['#B9B6AF', '#FFFFFF'],
  light: ['#4A4845', C.ink],
};

const glyph = (ch) => {
  const lines = figlet
    .textSync(ch, { font: 'Cosmike', horizontalLayout: 'full' })
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.length > 0);
  const w = Math.max(...lines.map((l) => l.length));
  return lines.map((l) => l.padEnd(w));
};

// Figlet's own kerning smashes the letters together (E's foot runs into M),
// so each glyph is set whole and spaced by hand. gaps[i] = spaces after letter i.
const ascii = (text, gaps = []) => {
  const glyphs = [...text].map(glyph);
  return glyphs[0].map((_, row) =>
    glyphs
      .map((g, i) => g[row] + ' '.repeat(gaps[i] ?? 0))
      .join('')
      .replace(/\s+$/, ''),
  );
};

// Lay out ASCII rows on a monospace grid and return one outlined path.
function outline(lines, size, x0 = 0, y0 = 0, font = LOGO) {
  const cellW = (font.charToGlyph('M').advanceWidth / font.unitsPerEm) * size;
  const cellH = size * LINE_HEIGHT;
  const ascent = size * 0.8;
  let d = '';
  lines.forEach((line, row) => {
    [...line].forEach((ch, col) => {
      if (ch === ' ') return;
      d += font.getPath(ch, x0 + col * cellW, y0 + row * cellH + ascent, size).toPathData(2);
    });
  });
  const cols = Math.max(...lines.map((l) => l.length));
  return { d, w: cols * cellW, h: lines.length * cellH };
}

// Outline at the origin, measure the real ink, then center that box in (W, H).
function centered(lines, size, W, H, dy = 0) {
  const o = outline(lines, size);
  const bb = pathBounds(o.d);
  const x = (W - (bb.x2 - bb.x1)) / 2 - bb.x1;
  const y = (H - (bb.y2 - bb.y1)) / 2 - bb.y1 + dy;
  return { ...outline(lines, size, x, y), top: y + bb.y1, bottom: y + bb.y2 };
}

function pathBounds(d) {
  const n = d.match(/-?\d+(\.\d+)?/g).map(Number);
  const xs = n.filter((_, i) => i % 2 === 0);
  const ys = n.filter((_, i) => i % 2 === 1);
  return { x1: Math.min(...xs), x2: Math.max(...xs), y1: Math.min(...ys), y2: Math.max(...ys) };
}

const ramp = (id, [from, to], y1, y2) =>
  `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${y1.toFixed(1)}" x2="0" y2="${y2.toFixed(1)}">` +
  `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`;

// Ink background with a soft central lift and fine grain: depth without decoration.
const backdrop = (W, H) => ({
  defs:
    `<radialGradient id="lift" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#1A1A1C"/><stop offset="1" stop-color="#0A0A0B"/></radialGradient>` +
    `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.05 0"/></filter>`,
  body: `<rect width="${W}" height="${H}" fill="url(#lift)"/><rect width="${W}" height="${H}" filter="url(#grain)"/>`,
});

// Uppercase, widely tracked line of small text, centered on cx.
function tracked(text, size, tracking, cx, baseline) {
  const chars = [...text.toUpperCase()];
  const adv = chars.map((ch) => TEXT.getAdvanceWidth(ch, size) + size * tracking);
  const width = adv.reduce((a, b) => a + b, 0) - size * tracking;
  let x = cx - width / 2;
  let d = '';
  chars.forEach((ch, i) => {
    d += TEXT.getPath(ch, x, baseline, size).toPathData(2);
    x += adv[i];
  });
  return { d, x1: cx - width / 2, x2: cx + width / 2 };
}

function svg(w, h, body, defs = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${body}</svg>\n`;
}

function write(rel, content) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log('wrote', rel);
}

const word = ascii('REMY', [1, 2, 2]);
const mark = ascii('R');
write('logo/remy-wordmark.txt', `${word.join('\n')}\n`);
write('logo/remy-mark.txt', `${mark.join('\n')}\n`);

// Logos: transparent background, one per ink.
for (const [name, lines] of [['wordmark', word], ['mark', mark]]) {
  const o = outline(lines, 40);
  const w = Math.ceil(o.w);
  const h = Math.ceil(o.h);
  for (const bg of ['dark', 'light']) {
    const file = svg(w, h, `<path fill="url(#r)" d="${o.d}"/>`, ramp('r', RAMP[bg], 0, h));
    write(`logo/remy-${name}-on-${bg}.svg`, file);
    // The org profile README references these from its own folder.
    if (name === 'wordmark') write(`github/profile/remy-wordmark-on-${bg}.svg`, file);
  }
}

// GitHub avatar: the mark, optically centered.
{
  const S = 1024;
  const bg = backdrop(S, S);
  const o = centered(mark, 84, S, S);
  write(
    'github/avatar.svg',
    svg(S, S, `${bg.body}<path fill="url(#r)" d="${o.d}"/>`, bg.defs + ramp('r', RAMP.dark, o.top, o.bottom)),
  );
}

// GitHub social preview (1280x640): wordmark, tracked tagline, signal cursor.
{
  const W = 1280;
  const H = 640;
  const bg = backdrop(W, H);
  const o = centered(word, 30, W, H, -34);
  const t = tracked(TAGLINE, 17, 0.32, W / 2, o.bottom + 86);
  const body =
    bg.body +
    `<path fill="url(#r)" d="${o.d}"/>` +
    `<path fill="${C.stone}" d="${t.d}"/>` +
    `<rect x="${(t.x2 + 12).toFixed(1)}" y="${(o.bottom + 86 - 15).toFixed(1)}" width="10" height="19" fill="${C.signal}"/>`;
  write('github/social-preview.svg', svg(W, H, body, bg.defs + ramp('r', RAMP.dark, o.top, o.bottom)));
}
