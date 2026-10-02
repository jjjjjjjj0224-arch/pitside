// Draw mode: full-screen photo with a transparent canvas on top.
//
// The drawing is a SEPARATE transparent PNG, the same size as the photo.
// The original photo is never changed. Reopening Draw loads the old drawing
// so the user can keep editing or clear it.
//
// Undo works by keeping a list of actions (each stroke, or "clear") and
// redrawing them all from the start.

import { loadImage, canvasToBlob } from './image.js';

const COLORS = [
  { name: 'Red', value: '#FF3B30' },
  { name: 'Yellow', value: '#FFD60A' },
  { name: 'White', value: '#FFFFFF' },
];
// Line widths as a fraction of the photo's longest side, so lines look the
// same on big and small photos.
const WIDTHS = [
  { name: 'Thin', value: 1 / 160 },
  { name: 'Thick', value: 1 / 64 },
];

// Opens draw mode. Returns { done, finish }:
//   done   - Promise that resolves with the new drawing Blob (or null if empty)
//   finish - closes draw mode as if Done was pressed (used by the Back button)
export function openDrawMode(photoBlob, drawingBlob) {
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });

  const overlay = document.createElement('div');
  overlay.className = 'draw-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Draw on photo');
  overlay.innerHTML = `
    <div class="draw-stage">
      <div class="draw-box">
        <img class="draw-photo" alt="Photo being drawn on">
        <canvas class="draw-canvas" aria-label="Drawing area. Use touch or mouse to draw."></canvas>
      </div>
      <p class="draw-loading">Loading photo…</p>
    </div>
    <div class="draw-toolbar">
      <div class="draw-row" role="group" aria-label="Pen color">
        <span class="draw-row-label">Pen</span>
        ${COLORS.map((c, i) => `
          <button type="button" class="btn draw-tool" data-color="${c.value}" aria-pressed="${i === 0}">
            <span class="swatch" style="background:${c.value}" aria-hidden="true"></span>${c.name}
          </button>`).join('')}
      </div>
      <div class="draw-row" role="group" aria-label="Line width">
        <span class="draw-row-label">Line</span>
        ${WIDTHS.map((w, i) => `
          <button type="button" class="btn draw-tool" data-width="${w.value}" aria-pressed="${i === 0}">${w.name}</button>`).join('')}
      </div>
      <div class="draw-row draw-actions">
        <button type="button" class="btn draw-tool" data-act="undo">Undo</button>
        <button type="button" class="btn draw-tool" data-act="clear">Clear</button>
        <button type="button" class="btn btn-primary draw-done" data-act="done">Done</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('no-scroll');   // stop the page scrolling behind

  const stage = overlay.querySelector('.draw-stage');
  const box = overlay.querySelector('.draw-box');
  const photoEl = overlay.querySelector('.draw-photo');
  const canvas = overlay.querySelector('.draw-canvas');
  const ctx = canvas.getContext('2d');
  const undoBtn = overlay.querySelector('[data-act="undo"]');

  let color = COLORS[0].value;
  let widthFraction = WIDTHS[0].value;
  let base = null;           // the previously saved drawing, if any
  let actions = [];          // [{ kind: 'stroke', color, width, points: [[x,y],...] } | { kind: 'clear' }]
  let activeStroke = null;
  let activePointer = null;
  let ready = false;
  let closed = false;
  let photoUrl = null;

  // ---- Load the photo and old drawing ----

  (async () => {
    const photo = await loadImage(photoBlob);
    canvas.width = photo.naturalWidth;
    canvas.height = photo.naturalHeight;
    photoUrl = URL.createObjectURL(photoBlob);
    photoEl.src = photoUrl;
    if (drawingBlob) base = await loadImage(drawingBlob);
    overlay.querySelector('.draw-loading').remove();
    ready = true;
    layout();
    redraw();
  })().catch((err) => {
    console.error(err);
    finish();
  });

  // Size the photo + canvas to fit the screen, keeping the photo's shape.
  function layout() {
    if (!ready) return;
    const availW = stage.clientWidth;
    const availH = stage.clientHeight;
    const scale = Math.min(availW / canvas.width, availH / canvas.height);
    box.style.width = `${Math.floor(canvas.width * scale)}px`;
    box.style.height = `${Math.floor(canvas.height * scale)}px`;
  }
  window.addEventListener('resize', layout);

  // ---- Drawing ----

  function strokeWidth() {
    return Math.max(2, Math.round(Math.max(canvas.width, canvas.height) * widthFraction));
  }

  function drawStroke(s) {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (s.points.length === 1) {          // a single tap makes a dot
      const [x, y] = s.points[0];
      ctx.beginPath();
      ctx.arc(x, y, s.width / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(s.points[0][0], s.points[0][1]);
    for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i][0], s.points[i][1]);
    ctx.stroke();
  }

  // Everything after the last "clear" is visible. The old drawing (base) only
  // shows if there has been no clear.
  function lastClearIndex() {
    for (let i = actions.length - 1; i >= 0; i--) if (actions[i].kind === 'clear') return i;
    return -1;
  }

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const lastClear = lastClearIndex();
    if (base && lastClear === -1) ctx.drawImage(base, 0, 0, canvas.width, canvas.height);
    actions.slice(lastClear + 1).forEach(drawStroke);
    undoBtn.disabled = actions.length === 0;
  }

  function isEmpty() {
    const lastClear = lastClearIndex();
    const strokesAfter = actions.slice(lastClear + 1).length;
    return strokesAfter === 0 && (lastClear !== -1 || !base);
  }

  // Convert a pointer position on screen to a pixel on the photo.
  function toCanvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) / rect.width) * canvas.width,
      ((e.clientY - rect.top) / rect.height) * canvas.height,
    ];
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!ready || activePointer !== null) return;   // ignore a second finger
    e.preventDefault();
    activePointer = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* keep drawing without capture */ }
    activeStroke = { kind: 'stroke', color, width: strokeWidth(), points: [toCanvasPoint(e)] };
    actions.push(activeStroke);
    drawStroke(activeStroke);
    undoBtn.disabled = false;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointer) return;
    e.preventDefault();
    // getCoalescedEvents gives every point the finger passed, for smoother lines.
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const pts = activeStroke.points;
    const start = pts.length - 1;
    for (const ev of (events.length ? events : [e])) pts.push(toCanvasPoint(ev));
    // Draw just the new piece (faster than redrawing everything).
    ctx.strokeStyle = activeStroke.color;
    ctx.lineWidth = activeStroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[start][0], pts[start][1]);
    for (let i = start + 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  });

  function endStroke(e) {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    activeStroke = null;
    redraw();   // redraw cleanly (joins the pieces)
  }
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  // Extra guard for iPhone: never let a touch on the canvas scroll the page.
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  // ---- Toolbar ----

  overlay.querySelector('.draw-toolbar').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.color) {
      color = btn.dataset.color;
      overlay.querySelectorAll('[data-color]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    } else if (btn.dataset.width) {
      widthFraction = Number(btn.dataset.width);
      overlay.querySelectorAll('[data-width]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    } else if (btn.dataset.act === 'undo') {
      actions.pop();
      redraw();
    } else if (btn.dataset.act === 'clear') {
      if (!isEmpty()) {
        actions.push({ kind: 'clear' });
        redraw();
      }
    } else if (btn.dataset.act === 'done') {
      finish();
    }
  });

  function onKey(e) {
    if (e.key === 'Escape') finish();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { actions.pop(); redraw(); }
  }
  document.addEventListener('keydown', onKey);

  // ---- Done ----

  async function finish() {
    if (closed) return;
    closed = true;
    let result;
    if (!ready || actions.length === 0) {
      result = drawingBlob || null;              // nothing changed: keep the old drawing
    } else if (isEmpty()) {
      result = null;                              // everything cleared: no drawing
    } else {
      const doneBtn = overlay.querySelector('[data-act="done"]');
      doneBtn.textContent = 'Saving…';
      doneBtn.disabled = true;
      result = await canvasToBlob(canvas, 'image/png');
    }
    window.removeEventListener('resize', layout);
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('no-scroll');
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    overlay.remove();
    resolveDone(result);
  }

  overlay.querySelector('[data-act="done"]').focus();
  return { done, finish };
}
