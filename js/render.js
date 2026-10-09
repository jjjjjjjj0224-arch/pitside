// Draws one entry as a PNG image for the engineering notebook (Google Slides).
//
//   16:9 "slide" (1920x1080): photo + drawing on the left, text on the right.
//   "square" (1080x1080):    photo on top, text underneath.
//
// Which text is printed, the size and the label color come from that entry
// type's export options in Settings.
//
// An entry with more photos than fit on one image makes several images ("pages",
// pageIndex picks which), marked "Photo 2 of 3" or "Photos 3–4 of 5". The caption
// goes on the first page (or is shared out / repeated, per Settings); each photo's
// own note goes on the page with that photo.

import { loadImage, canvasToBlob, fitContain, photosOf } from './image.js';
import { TYPE_LABELS, STAGE_LABELS } from './ui.js';
import { getFormat, TEXT_SIZES, FONTS } from './templates.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MARGIN = 64;
const TEXT_DARK = '#111827';
const TEXT_MID = '#374151';
const TEXT_LIGHT = '#4B5563';

// options: settings.export[entry.type] = { format, size, fields, accent, photosPerPage, captionPages, bullets }
// pageIndex: which image of the entry (see pageCountFor).
// formatId: 'standard' (PitSide layout) or a notebook format id; default: that type's own format.
// audioFileName: name of the voice note file in the export (if any)
export async function renderEntryImage(entry, options, audioFileName, pageIndex = 0, formatId = options.format) {
  // A notebook format: draw onto the sample page from your notebook.
  const template = await getFormat(formatId);
  if (template) return renderTemplateImage(entry, template, audioFileName, pageIndex, options);
  const W = options.size === 'square' ? 1080 : 1920;
  const H = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // White background.
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  const total = photosOf(entry).length;
  const pageCount = pageCountFor(entry, options);
  const onPage = photosOnPage(entry, options, null, pageIndex);
  const loaded = await Promise.all(onPage.map(async (p) => ({
    number: p.number,
    photo: await loadImage(p.photo),
    drawing: p.drawing ? await loadImage(p.drawing) : null,
    note: p.note,
  })));
  const captionText = pageText(entry, options, pageIndex, pageCount, onPage, options.fields.caption);
  const blocks = textBlocks(entry, options, audioFileName, photoLabel(onPage, total), captionText, pageIndex === 0);
  // Several photos with notes: number them, to match "Photo 3: ..." in the text.
  const tagged = loaded.length > 1 && loaded.some((p) => (p.note || '').trim());
  const drawPhotos = (box) => gridCells(box, loaded.length, 24).forEach((cell, i) => {
    const r = drawPhoto(ctx, loaded[i].photo, loaded[i].drawing, cell);
    if (tagged) drawNumberTag(ctx, r, loaded[i].number, 1);
  });

  if (!loaded.length) {
    // Caption-only entry: text uses the whole image.
    const box = { x: MARGIN, y: MARGIN, w: W - MARGIN * 2, h: H - MARGIN * 2 };
    drawText(ctx, layoutText(ctx, blocks, box.w, box.h, 1.6), box, options.accent);
  } else if (options.size === 'square') {
    // Text first (so we know how tall it is), photos get the rest of the space.
    const textW = W - MARGIN * 2;
    const layout = layoutText(ctx, blocks, textW, (H - MARGIN * 2) * 0.45, 1.1);
    const gap = 36;
    const photoBox = { x: MARGIN, y: MARGIN, w: textW, h: H - MARGIN * 2 - layout.height - gap };
    drawPhotos(photoBox);
    drawText(ctx, layout, { x: MARGIN, y: photoBox.y + photoBox.h + gap, w: textW }, options.accent);
  } else {
    // 16:9: a square photo area on the left, text on the right.
    const side = H - MARGIN * 2;
    const photoBox = { x: MARGIN, y: MARGIN, w: side, h: side };
    drawPhotos(photoBox);
    const textX = MARGIN + side + 56;
    const textBox = { x: textX, y: MARGIN, w: W - textX - MARGIN, h: side };
    drawText(ctx, layoutText(ctx, blocks, textBox.w, textBox.h, 1.4), textBox, options.accent);
  }

  return canvasToBlob(canvas, 'image/png');
}

// Photo fitted inside its box, drawing on top in exactly the same place.
// Returns where it was drawn.
function drawPhoto(ctx, photo, drawing, box) {
  const r = fitContain(photo.naturalWidth, photo.naturalHeight, box);
  ctx.drawImage(photo, r.x, r.y, r.w, r.h);
  if (drawing) ctx.drawImage(drawing, r.x, r.y, r.w, r.h);
  ctx.strokeStyle = '#D1D5DB';
  ctx.lineWidth = 2;
  ctx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
  return r;
}

// Split a box into a grid for `count` photos, picking the rows/columns that
// leave the most room for a 4:3 photo in each cell.
function gridCells(box, count, gap) {
  let best = null;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const w = (box.w - gap * (cols - 1)) / cols;
    const h = (box.h - gap * (rows - 1)) / rows;
    const score = Math.min(w / 4, h / 3);
    if (!best || score > best.score) best = { cols, w, h, score };
  }
  return Array.from({ length: count }, (_, i) => ({
    x: box.x + (i % best.cols) * (best.w + gap),
    y: box.y + Math.floor(i / best.cols) * (best.h + gap),
    w: best.w,
    h: best.h,
  }));
}

// A small numbered circle on a photo's corner (so "Photo 3: ..." notes can point to it).
function drawNumberTag(ctx, r, n, scale) {
  const radius = Math.round(26 * scale);
  const cx = r.x + radius + Math.round(10 * scale);
  const cy = r.y + radius + Math.round(10 * scale);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(17, 24, 39, 0.85)';
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 ${Math.round(30 * scale)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), cx, cy + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}

// ---- Pages: which photos and which text go on each exported image ----
// An entry with more photos than fit on one page makes several pages. The caption
// isn't repeated on all of them (unless you choose that): see pageText().

// Photo boxes of a notebook format, in reading order (top to bottom, left to right).
export function photoBoxesOf(template) {
  return template.boxes
    .filter((b) => b.kind === 'photo')
    .sort((a, b) => (Math.abs(a.y - b.y) < 0.03 ? a.x - b.x : a.y - b.y));
}

// options.photosPerPage: 1, 2, 4 or 'all' (every photo of the entry on one image).
function photosPerPage(entry, options, template) {
  if (template) return photoBoxesOf(template).length || Infinity;   // no Photo box: one page
  if (options.photosPerPage === 'all') return Math.max(1, photosOf(entry).length);
  return Math.max(1, Number(options.photosPerPage) || 1);
}

// How many images an entry makes in this layout.
export function pageCountFor(entry, options, template) {
  return Math.max(1, Math.ceil(photosOf(entry).length / photosPerPage(entry, options, template)));
}

// The photos on one page, each with its number in the whole entry (1, 2, 3...).
function photosOnPage(entry, options, template, pageIndex) {
  const per = photosPerPage(entry, options, template);
  if (per === Infinity) return [];
  return photosOf(entry)
    .map((p, i) => ({ ...p, number: i + 1 }))
    .slice(pageIndex * per, pageIndex * per + per);
}

// The caption as separate points: one per line, and one per sentence.
export function captionPoints(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[•●○▪◦]\s*|[-*–]\s+)/, '').trim())
    .filter(Boolean)
    .flatMap((line) => line.replace(/([.!?])\s+(?=[A-Z0-9"'(“])/g, '$1\n').split('\n'))
    .map((s) => s.trim())
    .filter(Boolean);
}

// The caption text for one page. options.captionPages:
//   'first' (default): the caption on the first page, "(continued)" after that
//   'spread': the caption's sentences shared out over the pages, in order
//   'every':  the whole caption on every page
// options.bullets: show it as bullet points. Each photo's own note is added as a
// bullet on the page that shows that photo.
export function pageText(entry, options, pageIndex, pageCount, pagePhotos, showCaption = true) {
  const caption = showCaption ? (entry.caption || '').trim() : '';
  const mode = options.captionPages || 'first';
  const asBullets = Boolean(options.bullets);
  let parts = [];
  if (caption) {
    const whole = asBullets ? captionPoints(caption) : [caption];
    if (pageCount === 1 || mode === 'every') parts = whole;
    else if (mode === 'spread') {
      // Shared out from the front: 3 sentences over 5 pages = one each on pages 1-3.
      const points = captionPoints(caption);
      const per = Math.ceil(points.length / pageCount);
      const share = points.slice(pageIndex * per, pageIndex * per + per);
      parts = asBullets ? share : (share.length ? [share.join(' ')] : []);
    } else if (pageIndex === 0) parts = whole;
  }
  const lines = asBullets ? parts.map((p) => `• ${p}`) : parts;
  const several = pagePhotos.length > 1;
  for (const p of pagePhotos) {
    const note = (p.note || '').trim();
    if (note) lines.push(`• ${several ? `Photo ${p.number}: ` : ''}${note}`);
  }
  if (!lines.length && caption && pageIndex > 0) lines.push('(continued)');
  return lines.join('\n');
}

// "Photo 2 of 5", "Photos 3–4 of 5", or '' for a single photo.
function photoLabel(pagePhotos, total) {
  if (total < 2 || !pagePhotos.length || pagePhotos.length === total) return '';   // all on this page: no label
  const first = pagePhotos[0].number;
  const last = pagePhotos[pagePhotos.length - 1].number;
  return first === last ? `Photo ${first} of ${total}` : `Photos ${first}–${last} of ${total}`;
}

// The pieces of text to print, in order, based on the type's settings.
function textBlocks(entry, options, audioFileName, photoLabel, captionText, firstPage) {
  const f = options.fields;
  const blocks = [{ kind: 'label', text: (TYPE_LABELS[entry.type] || entry.type).toUpperCase() }];
  const meta = [];
  if (photoLabel) meta.push(photoLabel);   // "Photo 2 of 3"
  if (f.datetime) meta.push(longDateTime(entry.createdAt));
  if (f.author && entry.author) meta.push(`Author: ${entry.author}`);
  if (f.stage && entry.stage) meta.push(`Stage: ${STAGE_LABELS[entry.stage] || entry.stage}`);
  if (f.match && entry.matchNumber) meta.push(`Match: ${entry.matchNumber}`);
  meta.forEach((text) => blocks.push({ kind: 'meta', text }));
  if (captionText) blocks.push({ kind: 'caption', text: captionText });
  if (firstPage && entry.audio && audioFileName) blocks.push({ kind: 'voice', text: `Voice note: see audio file ${audioFileName}` });
  return blocks;
}

function longDateTime(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

// Font sizes (px) at scale 1. Big enough to read on a projected slide.
function styleFor(kind, scale) {
  const s = (n) => Math.round(n * scale);
  switch (kind) {
    case 'label': return { font: `700 ${s(46)}px ${FONT}`, size: s(46), line: 1.2, before: 0, color: null };
    case 'meta': return { font: `400 ${s(30)}px ${FONT}`, size: s(30), line: 1.35, before: s(10), color: TEXT_MID };
    case 'caption': return { font: `400 ${s(36)}px ${FONT}`, size: s(36), line: 1.4, before: s(30), color: TEXT_DARK };
    case 'voice': return { font: `italic 400 ${s(27)}px ${FONT}`, size: s(27), line: 1.35, before: s(28), color: TEXT_LIGHT };
    default: return { font: `400 ${s(30)}px ${FONT}`, size: s(30), line: 1.35, before: 0, color: TEXT_DARK };
  }
}

// Wrap all text to fit maxWidth. Start with big text; if it is too tall for
// maxHeight, try smaller fonts (down to 60%); if still too tall, cut the
// caption and end it with "…".
function layoutText(ctx, blocks, maxWidth, maxHeight, startScale) {
  let layout;
  for (let scale = startScale; scale >= 0.6; scale -= 0.05) {
    layout = wrapBlocks(ctx, blocks, maxWidth, scale);
    if (layout.height <= maxHeight) return layout;
  }
  return trimToHeight(layout, maxHeight);
}

function wrapBlocks(ctx, blocks, maxWidth, scale) {
  const lines = [];
  let y = 0;
  blocks.forEach((block, i) => {
    const st = styleFor(block.kind, scale);
    ctx.font = st.font;
    if (i > 0) y += st.before;
    for (const text of wrapText(ctx, block.text, maxWidth)) {
      lines.push({ text, y, st, kind: block.kind });
      y += Math.round(st.size * st.line);
    }
    if (block.kind === 'label') y += Math.round(18 * scale);   // room for the accent bar below
  });
  return { lines, height: y, scale };
}

// Cut the caption so everything fits, but always keep the voice note line.
function trimToHeight(layout, maxHeight) {
  const lineBottom = (l) => l.y + Math.round(l.st.size * l.st.line);
  const voice = layout.lines.filter((l) => l.kind === 'voice');
  const rest = layout.lines.filter((l) => l.kind !== 'voice');
  const voiceTop = voice.length ? voice[0].y - voice[0].st.before : layout.height;
  const limit = maxHeight - (layout.height - voiceTop);

  const lines = [];
  for (const line of rest) {
    if (lineBottom(line) > limit) {
      const last = lines[lines.length - 1];
      if (last) last.text = `${last.text.replace(/\s*\S*$/, '')}…`;
      break;
    }
    lines.push({ ...line });
  }
  // Move the voice note line up to sit right after the kept text.
  const textEnd = lines.length ? lineBottom(lines[lines.length - 1]) : 0;
  voice.forEach((l) => lines.push({ ...l, y: textEnd + (l.y - voiceTop) }));
  const end = lines[lines.length - 1];
  return { lines, height: end ? lineBottom(end) : 0, scale: layout.scale };
}

// Split text into lines that fit maxWidth. Keeps the user's own line breaks
// and breaks very long words (like URLs) if needed. A "• " bullet's wrapped
// lines are indented to line up after the bullet.
function wrapText(ctx, text, maxWidth) {
  const out = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph.trim()) { out.push(''); continue; }
    const bullet = paragraph.startsWith('• ');
    const space = ctx.measureText(' ').width || 1;
    const indent = bullet ? ' '.repeat(Math.max(1, Math.round(ctx.measureText('• ').width / space))) : '';
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth) { line = test; continue; }
      if (line) out.push(line);
      line = `${indent}${word}`;
      while (ctx.measureText(line).width > maxWidth) {
        let cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function drawText(ctx, layout, box, accent) {
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  for (const line of layout.lines) {
    ctx.font = line.st.font;
    ctx.fillStyle = line.kind === 'label' ? accent : line.st.color;
    ctx.fillText(line.text, box.x, box.y + line.y);
    if (line.kind === 'label') {
      // Short accent-colored bar under the type label.
      const barY = box.y + line.y + Math.round(line.st.size * 1.2) + 2;
      ctx.fillRect(box.x, barY, Math.round(90 * layout.scale), Math.max(4, Math.round(8 * layout.scale)));
    }
  }
}

// ---- Notebook template layout ----
// The sample page is drawn first. Then each box: optionally painted over with the
// page's background color (to hide the old content), then filled with this entry.

// The text a box shows for this entry ('' = nothing to show). The caption and
// photo number boxes depend on the page: see renderTemplateImage.
function templateBoxText(kind, entry, audioFileName) {
  const d = new Date(entry.createdAt);
  switch (kind) {
    case 'label': return (TYPE_LABELS[entry.type] || entry.type).toUpperCase();
    // Page title like the notebook's "Build - ...": the design stage, or else the entry type.
    case 'title': return entry.stage ? (STAGE_LABELS[entry.stage] || entry.stage) : (TYPE_LABELS[entry.type] || entry.type);
    case 'datetime': return longDateTime(entry.createdAt);
    case 'date': return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    case 'shortDate': return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    case 'author': return entry.author || '';
    case 'stage': return entry.stage ? (STAGE_LABELS[entry.stage] || entry.stage) : '';
    case 'match': return entry.matchNumber || '';
    case 'voice': return entry.audio && audioFileName ? `Voice note: see audio file ${audioFileName}` : '';
    default: return '';
  }
}

// options: that entry type's export options (caption on several pages, bullets).
// A format with several Photo boxes fills them in reading order; more photos than
// boxes continue on the next page (pageIndex).
export async function renderTemplateImage(entry, template, audioFileName, pageIndex = 0, options = {}) {
  const page = await loadImage(template.page);
  const W = page.naturalWidth;
  const H = page.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(page, 0, 0, W, H);

  const total = photosOf(entry).length;
  const pageCount = pageCountFor(entry, options, template);
  const onPage = photosOnPage(entry, options, template, pageIndex);
  const slots = new Map(photoBoxesOf(template).map((b, i) => [b, onPage[i] || null]));
  const tagged = onPage.length > 1 && onPage.some((p) => (p.note || '').trim());
  const scale = W / 1920;

  for (const b of template.boxes) {
    const box = { x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H };
    if (b.cover) {
      ctx.fillStyle = b.coverColor || '#FFFFFF';
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }
    if (b.kind === 'photo') {
      const p = slots.get(b);
      if (!p) continue;
      const photo = await loadImage(p.photo);
      const drawing = p.drawing ? await loadImage(p.drawing) : null;
      const r = drawTemplatePhoto(ctx, photo, drawing, box, b.fit);
      if (tagged) drawNumberTag(ctx, r, p.number, scale);
      continue;
    }
    let text;
    if (b.kind === 'caption') text = pageText(entry, options, pageIndex, pageCount, onPage);
    else if (b.kind === 'photoNumber') text = photoLabel(onPage, total);
    else if (b.kind === 'voice' && pageIndex > 0) text = '';     // the voice note line only on the first page
    else text = templateBoxText(b.kind, entry, audioFileName);
    if (text) drawTemplateText(ctx, text, box, b, scale);
  }
  return canvasToBlob(canvas, 'image/png');
}

// fit 'contain': whole photo inside the box. 'cover': fill the box, cropping the edges.
// Returns the part of the box the photo shows in.
function drawTemplatePhoto(ctx, photo, drawing, box, fit) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  let r;
  if (fit === 'cover') {
    const s = Math.max(box.w / photo.naturalWidth, box.h / photo.naturalHeight);
    const w = photo.naturalWidth * s;
    const h = photo.naturalHeight * s;
    r = { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
  } else {
    r = fitContain(photo.naturalWidth, photo.naturalHeight, box);
  }
  ctx.drawImage(photo, r.x, r.y, r.w, r.h);
  if (drawing) ctx.drawImage(drawing, r.x, r.y, r.w, r.h);
  ctx.restore();
  return {
    x: Math.max(r.x, box.x),
    y: Math.max(r.y, box.y),
    w: Math.min(r.x + r.w, box.x + box.w) - Math.max(r.x, box.x),
    h: Math.min(r.y + r.h, box.y + box.h) - Math.max(r.y, box.y),
  };
}

// Text in a box: wrapped, shrunk (down to half size) if it doesn't fit, then cut with "…".
function drawTemplateText(ctx, text, box, b, scale) {
  const font = FONTS[b.font] || FONTS.sans;
  const weight = b.bold ? 700 : 400;
  let size = (TEXT_SIZES[b.size] || TEXT_SIZES.M) * scale;
  const minSize = size * 0.5;
  let lines;
  for (;;) {
    ctx.font = `${weight} ${Math.round(size)}px ${font}`;
    lines = wrapText(ctx, text, box.w);
    if (lines.length * size * 1.3 <= box.h || size <= minSize) break;
    size *= 0.9;
  }
  const lineH = size * 1.3;
  const maxLines = Math.max(1, Math.floor(box.h / lineH));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s*\S*$/, '')}…`;
  }
  ctx.fillStyle = b.color || '#111111';
  ctx.textBaseline = 'top';
  ctx.textAlign = b.align === 'center' ? 'center' : b.align === 'right' ? 'right' : 'left';
  const x = b.align === 'center' ? box.x + box.w / 2 : b.align === 'right' ? box.x + box.w : box.x;
  // In a one-line box (title, date...) the text sits in the middle of its height;
  // in a tall box (caption) text starts at the top.
  const top = lines.length === 1 && box.h < size * 2.6 ? box.y + (box.h - size) / 2 : box.y;
  lines.forEach((line, i) => ctx.fillText(line, x, top + i * lineH));
  ctx.textAlign = 'left';
}

// A made-up entry, so previews work before there are any entries.
let samplePhotos = null;
export async function sampleEntry(type, author) {
  if (!samplePhotos) {
    samplePhotos = [];
    for (const [n, from, to] of [[1, '#9CA3AF', '#4B5563'], [2, '#93C5FD', '#1E3A8A'], [3, '#FCA5A5', '#7F1D1D']]) {
      const c = document.createElement('canvas');
      c.width = 1200;
      c.height = 900;
      const ctx = c.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 1200, 900);
      g.addColorStop(0, from);
      g.addColorStop(1, to);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1200, 900);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `600 72px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(`Sample photo ${n}`, 600, 470);
      samplePhotos.push(await canvasToBlob(c, 'image/jpeg', 0.8));
    }
  }
  return {
    id: 'sample',
    type,
    stage: 'build',
    photos: [
      { photo: samplePhotos[0], drawing: null, note: 'The intake before the change.' },
      { photo: samplePhotos[1], drawing: null, note: 'Moved 2 holes forward.' },
      { photo: samplePhotos[2], drawing: null, note: '' },
    ],
    caption: 'Sample caption: moved the intake 2 holes forward. Now it reaches the rings without hitting the wall.',
    audio: null,
    matchNumber: type === 'competition' ? 'Q12' : null,
    author: author || 'Your name',
    createdAt: new Date().toISOString(),
  };
}
