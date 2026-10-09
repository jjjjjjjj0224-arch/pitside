// Notebook templates: a sample page from your own notebook, plus boxes that say
// where each part of an entry goes (photo, caption, date...). Export then draws
// each entry onto that page, so it looks like the rest of your notebook.
//
// One template per entry type, stored on the phone (IndexedDB, settings store):
//   {
//     type, page: Blob (the sample page picture), width, height, source,
//     boxes: [{ id, kind, x, y, w, h,              // position, as fractions of the page (0..1)
//               cover, coverColor,                 // paint over the old content first?
//               color, size, font, align, bold,    // text style
//               fit }]                             // photo: 'contain' (whole photo) or 'cover' (fill box)
//   }

import { readKey, writeKey, deleteKey } from './db.js';

export const BOX_KINDS = [
  { kind: 'photo', label: 'Photo' },
  { kind: 'label', label: 'Entry type' },
  { kind: 'datetime', label: 'Date and time' },
  { kind: 'date', label: 'Date only' },
  { kind: 'author', label: 'Author' },
  { kind: 'stage', label: 'Design stage' },
  { kind: 'match', label: 'Match number' },
  { kind: 'caption', label: 'Caption' },
  { kind: 'voice', label: 'Voice note line' },
  { kind: 'photoNumber', label: 'Photo number' },
];
export const kindLabel = (kind) => (BOX_KINDS.find((k) => k.kind === kind) || { label: kind }).label;

// Text sizes, in pixels on a page 1920 pixels wide (scaled for other sizes).
export const TEXT_SIZES = { S: 26, M: 36, L: 48, XL: 64 };
export const FONTS = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

const key = (type) => `template:${type}`;
const cache = new Map();

export async function getTemplate(type) {
  if (!cache.has(type)) cache.set(type, (await readKey(key(type))) || null);
  return cache.get(type);
}

export async function saveTemplate(type, template) {
  await writeKey(key(type), template);
  cache.set(type, template);
}

export async function deleteTemplate(type) {
  await deleteKey(key(type));
  cache.set(type, null);
}

let nextId = Date.now();
// A new box with sensible defaults (the editor then lets you move and style it).
export function newBox(kind, x = 0.3, y = 0.3) {
  const isPhoto = kind === 'photo';
  const isCaption = kind === 'caption';
  return {
    id: `b${nextId++}`,
    kind,
    x, y,
    w: isPhoto ? 0.4 : isCaption ? 0.4 : 0.3,
    h: isPhoto ? 0.5 : isCaption ? 0.3 : 0.07,
    cover: true,
    coverColor: '#FFFFFF',
    color: '#111111',
    size: isCaption || kind === 'voice' ? 'M' : kind === 'label' ? 'L' : 'M',
    font: 'sans',
    align: 'left',
    bold: kind === 'label',
    fit: 'contain',
  };
}

// The most common color along the edge of a box on the page: a good guess for
// the page's background there (used to paint over the old content).
export function sampleCoverColor(ctx, box, width, height) {
  const x0 = Math.max(0, Math.floor(box.x * width));
  const y0 = Math.max(0, Math.floor(box.y * height));
  const x1 = Math.min(width - 1, Math.ceil((box.x + box.w) * width));
  const y1 = Math.min(height - 1, Math.ceil((box.y + box.h) * height));
  const counts = new Map();
  const add = (x, y) => {
    const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
    const k = [r, g, b].map((v) => Math.round(v / 8) * 8).join(',');   // group similar colors
    counts.set(k, (counts.get(k) || 0) + 1);
  };
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / steps);
    const y = Math.round(y0 + ((y1 - y0) * i) / steps);
    add(x, y0); add(x, y1); add(x0, y); add(x1, y);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
  return `#${best.map((v) => Math.min(255, v).toString(16).padStart(2, '0')).join('')}`;
}
