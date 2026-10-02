// Draws one entry as a PNG image for the engineering notebook (Google Slides).
//
//   16:9 "slide" (1920x1080): photo + drawing on the left, text on the right.
//   "square" (1080x1080):    photo on top, text underneath.
//
// Which text is printed, the size and the label color come from that entry
// type's export options in Settings.

import { loadImage, canvasToBlob, fitContain } from './image.js';
import { TYPE_LABELS, STAGE_LABELS } from './ui.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MARGIN = 64;
const TEXT_DARK = '#111827';
const TEXT_MID = '#374151';
const TEXT_LIGHT = '#4B5563';

// options: settings.export[entry.type] = { size, fields, accent }
// audioFileName: name of the voice note file in the export (if any)
export async function renderEntryImage(entry, options, audioFileName) {
  const W = options.size === 'square' ? 1080 : 1920;
  const H = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // White background.
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  const photo = entry.photo ? await loadImage(entry.photo) : null;
  const drawing = entry.photo && entry.drawing ? await loadImage(entry.drawing) : null;
  const blocks = textBlocks(entry, options, audioFileName);

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
function textBlocks(entry, options, audioFileName) {
  const f = options.fields;
  const blocks = [{ kind: 'label', text: (TYPE_LABELS[entry.type] || entry.type).toUpperCase() }];
  const meta = [];
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
