#!/usr/bin/env node
/**
 * Contact-sheet / blind A-B compositor for critique.
 *
 * Contact sheet (labelled grid):
 *   node tools/sheet.mjs --images "shots/burnout/pass1-01.png,shots/burnout/pass1-02.png" \
 *     --labels "chase,crash" --out shots/burnout/sheet.png --cols 2
 *
 * Blind A/B (order randomised, key written next to the output):
 *   node tools/sheet.mjs --ab "shots/a.png,shots/b.png" --out shots/ab.png
 *
 * Renders the grid in a headless browser and screenshots it, so no image libs are needed.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]?.startsWith('--') ? 'true' : arr[i + 1]]);
    return acc;
  }, [])
);

const out = args.out || 'shots/sheet.png';
const cellW = parseInt(args.cellW ?? '860', 10);
const blind = !!args.ab;
let images = (args.ab || args.images || '').split(',').map((s) => s.trim()).filter(Boolean);
let labels = (args.labels || '').split(',').map((s) => s.trim()).filter(Boolean);
const cols = parseInt(args.cols ?? (blind ? '2' : String(Math.min(2, images.length))), 10);

if (!images.length) {
  console.error('no --images or --ab given');
  process.exit(1);
}

let key = null;
if (blind) {
  const tagged = images.map((p, i) => ({ p, i }));
  for (let i = tagged.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tagged[i], tagged[j]] = [tagged[j], tagged[i]];
  }
  images = tagged.map((t) => t.p);
  labels = tagged.map((_, i) => String.fromCharCode(65 + i));
  key = tagged.map((t, i) => `${String.fromCharCode(65 + i)} = ${t.p}`).join('\n');
}

const dataUris = images.map((p) => {
  const b = readFileSync(resolve(p));
  return `data:image/png;base64,${b.toString('base64')}`;
});

const cells = dataUris
  .map((d, i) => `<figure><img src="${d}"><figcaption>${labels[i] ?? `#${i + 1}`}</figcaption></figure>`)
  .join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#0a0a0c;font-family:ui-sans-serif,system-ui,sans-serif;color:#e6e9f0}
  .grid{display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:14px;padding:14px}
  figure{margin:0}
  img{display:block;width:${cellW}px;height:auto;border-radius:6px;border:1px solid #23293a}
  figcaption{padding:8px 2px 0;font-size:20px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#aab3c6}
</style></head><body><div class="grid">${cells}</div></body></html>`;

mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: cols * (cellW + 14) + 14, height: 800 } });
await page.setContent(html, { waitUntil: 'load' });
await page.waitForTimeout(300);
await page.screenshot({ path: out, fullPage: true });
await browser.close();

console.log(`saved ${out}`);
if (key) {
  const keyPath = out.replace(/\.png$/, '.key.txt');
  writeFileSync(keyPath, key + '\n');
  console.log(`key written to ${keyPath} (do NOT read it until after you have judged)`);
}
