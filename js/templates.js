// Notebook formats ("templates"): a sample page from your own notebook, plus boxes
// that say where each part of an entry goes (photo, caption, date...). Export then
// draws each entry onto that page, so it looks like the rest of your notebook.
//
// You can keep several formats. Each entry type has a default one (Settings), which
// "Auto" uses on the Export screen; Export can also put everything in one format.
//
// Stored on the phone (IndexedDB, settings store):
//   'formats'      -> [{ id, name }]   (the list, in the order they were made)
//   'format:<id>'  -> {
//     id, name, page: Blob (the sample page picture), width, height, source,
//     boxes: [{ id, kind, x, y, w, h,              // position, as fractions of the page (0..1)
//               cover, coverColor,                 // paint over the old content first?
//               color, size, font, align, bold,    // text style
//               fit }]                             // photo: 'contain' (whole photo) or 'cover' (fill box)
//   }
// The built-in PitSide layout is the format id 'standard' (not stored here).

import { readKey, writeKey, deleteKey } from './db.js';
import { TYPES, TYPE_LABELS } from './ui.js';

export const STANDARD = 'standard';

export const BOX_KINDS = [
  { kind: 'photo', label: 'Photo' },
  { kind: 'title', label: 'Title (stage or type)' },
  { kind: 'label', label: 'Entry type' },
  { kind: 'datetime', label: 'Date and time' },
  { kind: 'date', label: 'Date only' },
  { kind: 'shortDate', label: 'Date (07/09/2025)' },
  { kind: 'author', label: 'Author' },
  { kind: 'stage', label: 'Design stage' },
  { kind: 'match', label: 'Match number' },
  { kind: 'caption', label: 'Caption' },
  { kind: 'voice', label: 'Voice note line' },
  { kind: 'photoNumber', label: 'Photo number' },
];
export const kindLabel = (kind) => (BOX_KINDS.find((k) => k.kind === kind) || { label: kind }).label;

// Text sizes, in pixels on a page 1920 pixels wide (scaled for other sizes).
export const TEXT_SIZES = { S: 26, M: 36, L: 48, XL: 64, XXL: 120 };
export const FONTS = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  // Handwriting, for titles. Uses whichever handwriting font the phone has.
  hand: '"Caveat", "Ink Free", "Segoe Print", "Bradley Hand", Noteworthy, "Comic Sans MS", cursive',
};

const key = (id) => `format:${id}`;
const cache = new Map();     // id -> format (or null)
let list = null;             // [{ id, name }]
let loading = null;

// Load the list once. Older versions kept one template per entry type
// ('template:build'...): those become formats with the id 'legacy-<type>'
// (settings.js points each type's default at that id).
function ready() {
  if (!loading) {
    loading = (async () => {
      list = await readKey('formats');
      if (Array.isArray(list)) return;
      list = [];
      for (const type of TYPES) {
        const old = await readKey(`template:${type}`);
        if (!old) continue;
        const id = `legacy-${type}`;
        const format = { ...old, id, name: `${TYPE_LABELS[type]} notebook page` };
        delete format.type;
        await writeKey(key(id), format);
        await deleteKey(`template:${type}`);
        list.push({ id, name: format.name });
      }
      await writeKey('formats', list);
    })();
  }
  return loading;
}

// [{ id, name }] of every saved format.
export async function listFormats() {
  await ready();
  return list.map((f) => ({ ...f }));
}

// The whole format (with its page picture), or null.
export async function getFormat(id) {
  if (!id || id === STANDARD) return null;
  await ready();
  if (!cache.has(id)) cache.set(id, (await readKey(key(id))) || null);
  return cache.get(id);
}

// Save a format (new ones get an id). Returns it.
export async function saveFormat(format) {
  await ready();
  const saved = { ...format, id: format.id || `f${Date.now().toString(36)}`, name: (format.name || '').trim() || 'My notebook page' };
  await writeKey(key(saved.id), saved);
  cache.set(saved.id, saved);
  const i = list.findIndex((f) => f.id === saved.id);
  if (i === -1) list.push({ id: saved.id, name: saved.name }); else list[i] = { id: saved.id, name: saved.name };
  await writeKey('formats', list);
  return saved;
}

export async function deleteFormat(id) {
  await ready();
  await deleteKey(key(id));
  cache.set(id, null);
  list = list.filter((f) => f.id !== id);
  await writeKey('formats', list);
}

// "PitSide layout" or the format's name.
export async function formatName(id) {
  if (!id || id === STANDARD) return 'PitSide layout';
  const f = await getFormat(id);
  return f ? f.name : 'PitSide layout';
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

// ---- Format files (to share a format with teammates or another phone) ----
// A .pitside-template.json file: the name and boxes, plus the sample page as a data: URL.

const FILE_TAG = 'pitside-template';

export async function templateToFile(format) {
  const page = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(format.page);
  });
  const { name, width, height, source, boxes } = format;
  const json = JSON.stringify({ format: FILE_TAG, version: 1, name, width, height, source, boxes, page });
  const fileName = (name || 'PitSide format').replace(/[^\w -]+/g, '').trim() || 'PitSide format';
  return new File([json], `${fileName}.pitside-template.json`, { type: 'application/json' });
}

export const isTemplateFile = (file) => /\.json$/i.test(file.name) || file.type === 'application/json';

// Read a format file (as a new, unsaved format). Throws if it isn't one.
export async function templateFromFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { data = null; }
  if (!data || data.format !== FILE_TAG || !Array.isArray(data.boxes) || !/^data:image\//.test(data.page || '')) {
    throw new Error('Not a PitSide template file');
  }
  const page = await (await fetch(data.page)).blob();
  const boxes = data.boxes
    .filter((b) => BOX_KINDS.some((k) => k.kind === b.kind))
    .map((b) => ({ ...newBox(b.kind), ...b, id: `b${nextId++}` }));
  const name = data.name || file.name.replace(/\.pitside-template\.json$|\.json$/i, '');
  return { name, page, width: data.width, height: data.height, source: data.source || file.name, boxes };
}
