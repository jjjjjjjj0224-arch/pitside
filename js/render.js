// Draws one entry as a PNG image for the engineering notebook (Google Slides).
//
//   16:9 "slide" (1920x1080): photo + drawing on the left, text on the right.
//   "square" (1080x1080):    photo on top, text underneath.
//
// Which text is printed, the size and the label color come from that entry
// type's export options in Settings.
//
// An entry with several photos makes one image per photo (photoIndex picks which),
// each marked "Photo 2 of 3".

import { loadImage, canvasToBlob, fitContain, photosOf } from './image.js';
import { TYPE_LABELS, STAGE_LABELS } from './ui.js';
import { getFormat, TEXT_SIZES, FONTS } from './templates.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MARGIN = 64;
const TEXT_DARK = '#111827';
const TEXT_MID = '#374151';
const TEXT_LIGHT = '#4B5563';

// options: settings.export[entry.type] = { format, size, fields, accent }
// formatId: 'standard' (PitSide layout) or a notebook format id; default: that type's own format.
// audioFileName: name of the voice note file in the export (if any)
export async function renderEntryImage(entry, options, audioFileName, photoIndex = 0, formatId = options.format) {
  // A notebook format: draw onto the sample page from your notebook.
  const template = await getFormat(formatId);
  if (template) return renderTemplateImage(entry, template, audioFileName, photoIndex);
  const W = options.size === 'square' ? 1080 : 1920;
  const H = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // White background.
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  const photos = photosOf(entry);
  const chosen = photos[photoIndex] || null;
  const photo = chosen ? await loadImage(chosen.photo) : null;
  const drawing = chosen && chosen.drawing ? await loadImage(chosen.drawing) : null;
  const blocks = textBlocks(entry, options, audioFileName, photos.length > 1 ? `Photo ${photoIndex + 1} of ${photos.length}` : null);

  if (!photo) {
    // Caption-only entry: text uses the whole image.
    const box = { x: MARGIN, y: MARGIN, w: W - MARGIN * 2, h: H - MARGIN * 2 };
    drawText(ctx, layoutText(ctx, blocks, box.w, box.h, 1.6), box, options.accent);
  } else if (options.size === 'square') {
    // Text first (so we know how tall it is), photo gets the rest of the space.
    const textW = W - MARGIN * 2;
    const layout = layoutText(ctx, blocks, textW, (H - MARGIN * 2) * 0.45, 1.1);
    const gap = 36;
    const photoBox = { x: MARGIN, y: MARGIN, w: textW, h: H - MARGIN * 2 - layout.height - gap };
    drawPhoto(ctx, photo, drawing, photoBox);
    drawText(ctx, layout, { x: MARGIN, y: photoBox.y + photoBox.h + gap, w: textW }, options.accent);
  } else {
    // 16:9: a square photo area on the left, text on the right.
    const side = H - MARGIN * 2;
    const photoBox = { x: MARGIN, y: MARGIN, w: side, h: side };
    drawPhoto(ctx, photo, drawing, photoBox);
    const textX = MARGIN + side + 56;
    const textBox = { x: textX, y: MARGIN, w: W - textX - MARGIN, h: side };
    drawText(ctx, layoutText(ctx, blocks, textBox.w, textBox.h, 1.4), textBox, options.accent);
  }

  return canvasToBlob(canvas, 'image/png');
}

// Photo fitted inside its box, drawing on top in exactly the same place.
function drawPhoto(ctx, photo, drawing, box) {
  const r = fitContain(photo.naturalWidth, photo.naturalHeight, box);
  ctx.drawImage(photo, r.x, r.y, r.w, r.h);
  if (drawing) ctx.drawImage(drawing, r.x, r.y, r.w, r.h);
  ctx.strokeStyle = '#D1D5DB';
  ctx.lineWidth = 2;
  ctx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
}

// The pieces of text to print, in order, based on the type's settings.
function textBlocks(entry, options, audioFileName, photoLabel) {
  const f = options.fields;
  const blocks = [{ kind: 'label', text: (TYPE_LABELS[entry.type] || entry.type).toUpperCase() }];
  const meta = [];
  if (photoLabel) meta.push(photoLabel);   // "Photo 2 of 3"
  if (f.datetime) meta.push(longDateTime(entry.createdAt));
  if (f.author && entry.author) meta.push(`Author: ${entry.author}`);
  if (f.stage && entry.stage) meta.push(`Stage: ${STAGE_LABELS[entry.stage] || entry.stage}`);
  if (f.match && entry.matchNumber) meta.push(`Match: ${entry.matchNumber}`);
  meta.forEach((text) => blocks.push({ kind: 'meta', text }));
  if (f.caption && entry.caption && entry.caption.trim()) blocks.push({ kind: 'caption', text: entry.caption.trim() });
  if (entry.audio && audioFileName) blocks.push({ kind: 'voice', text: `Voice note: see audio file ${audioFileName}` });
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
// and breaks very long words (like URLs) if needed.
function wrapText(ctx, text, maxWidth) {
  const out = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph.trim()) { out.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth) { line = test; continue; }
      if (line) out.push(line);
      line = word;
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

// The text a box shows for this entry ('' = nothing to show).
export function templateBoxText(kind, entry, audioFileName, photoIndex, photoCount) {
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
    case 'caption': return (entry.caption || '').trim();
    case 'voice': return entry.audio && audioFileName ? `Voice note: see audio file ${audioFileName}` : '';
    case 'photoNumber': return photoCount > 1 ? `Photo ${photoIndex + 1} of ${photoCount}` : '';
    default: return '';
  }
}

export async function renderTemplateImage(entry, template, audioFileName, photoIndex = 0) {
  const page = await loadImage(template.page);
  const W = page.naturalWidth;
  const H = page.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(page, 0, 0, W, H);

  const photos = photosOf(entry);
  const chosen = photos[photoIndex] || null;
  const photo = chosen ? await loadImage(chosen.photo) : null;
  const drawing = chosen && chosen.drawing ? await loadImage(chosen.drawing) : null;
  const scale = W / 1920;

  for (const b of template.boxes) {
    const box = { x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H };
    if (b.cover) {
      ctx.fillStyle = b.coverColor || '#FFFFFF';
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }
    if (b.kind === 'photo') {
      if (photo) drawTemplatePhoto(ctx, photo, drawing, box, b.fit);
      continue;
    }
    const text = templateBoxText(b.kind, entry, audioFileName, photoIndex, photos.length);
    if (text) drawTemplateText(ctx, text, box, b, scale);
  }
  return canvasToBlob(canvas, 'image/png');
}

// fit 'contain': whole photo inside the box. 'cover': fill the box, cropping the edges.
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
let samplePhoto = null;
export async function sampleEntry(type, author) {
  if (!samplePhoto) {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 900;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 1200, 900);
    g.addColorStop(0, '#9CA3AF');
    g.addColorStop(1, '#4B5563');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1200, 900);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `600 72px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('Sample photo', 600, 470);
    samplePhoto = await canvasToBlob(c, 'image/jpeg', 0.8);
  }
  return {
    id: 'sample',
    type,
    stage: 'build',
    photos: [{ photo: samplePhoto, drawing: null }],
    caption: 'Sample caption: moved the intake 2 holes forward so it reaches the rings without hitting the wall.',
    audio: null,
    matchNumber: type === 'competition' ? 'Q12' : null,
    author: author || 'Your name',
    createdAt: new Date().toISOString(),
  };
}
