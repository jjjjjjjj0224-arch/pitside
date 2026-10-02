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
      <p class="draw-hint" aria-hidden="true">One finger draws · two fingers zoom and move</p>
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
      <div class="draw-row" role="group" aria-label="Zoom">
        <span class="draw-row-label">Zoom</span>
        <button type="button" class="btn draw-tool" data-act="zoom-out" aria-label="Zoom out">− Out</button>
        <button type="button" class="btn draw-tool" data-act="zoom-in" aria-label="Zoom in">+ In</button>
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
    const fit = Math.min(availW / canvas.width, availH / canvas.height);
    box.style.width = `${Math.floor(canvas.width * fit)}px`;
    box.style.height = `${Math.floor(canvas.height * fit)}px`;
    applyView();
  }
  window.addEventListener('resize', layout);

  // ---- Zoom (scale) and move (tx, ty) ----
  // The photo and canvas zoom together, so the drawing always lines up.
  // Drawing still works while zoomed: toCanvasPoint() uses the zoomed position.

  const MAX_ZOOM = 6;
  let zoom = 1;
  let tx = 0;
  let ty = 0;
  const zoomInBtn = overlay.querySelector('[data-act="zoom-in"]');
  const zoomOutBtn = overlay.querySelector('[data-act="zoom-out"]');

  function applyView() {
    // Don't let the photo be moved off screen.
    const maxX = Math.max(0, (box.offsetWidth * zoom - stage.clientWidth) / 2);
    const maxY = Math.max(0, (box.offsetHeight * zoom - stage.clientHeight) / 2);
    tx = Math.min(maxX, Math.max(-maxX, tx));
    ty = Math.min(maxY, Math.max(-maxY, ty));
    box.style.transform = `translate(${tx}px, ${ty}px) scale(${zoom})`;
    zoomOutBtn.disabled = zoom <= 1;
    zoomInBtn.disabled = zoom >= MAX_ZOOM;
  }

  // A point on screen, measured from the middle of the drawing area.
  function fromCentre(x, y) {
    const r = stage.getBoundingClientRect();
    return [x - (r.left + r.width / 2), y - (r.top + r.height / 2)];
  }

  // Zoom to z, keeping the spot (px, py) under the finger/mouse still.
  function zoomTo(z, px = 0, py = 0) {
    let s = Math.min(MAX_ZOOM, Math.max(1, z));
    if (s < 1.02) s = 1;     // snap back to exactly "not zoomed" (avoids 1.0000000002)
    tx = px - ((px - tx) * s) / zoom;
    ty = py - ((py - ty) * s) / zoom;
    zoom = s;
    if (zoom === 1) { tx = 0; ty = 0; }
    applyView();
  }

  // ---- Drawing ----

  // Line width in photo pixels. Divided by the zoom, so a line looks the same
  // thickness on screen and you can draw finer details when zoomed in.
  function strokeWidth() {
    return Math.max(1, Math.round((Math.max(canvas.width, canvas.height) * widthFraction) / zoom));
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

  // Touch / mouse on the drawing area:
  //   one finger (or left mouse button) draws,
  //   two fingers pinch to zoom and drag to move,
  //   right/middle mouse button drags to move, mouse wheel zooms.
  const pointers = new Map();
  let pinch = null;      // two-finger gesture: where it started
  let mousePan = null;

  stage.addEventListener('pointerdown', (e) => {
    if (!ready) return;
    e.preventDefault();
    try { stage.setPointerCapture(e.pointerId); } catch { /* keep going without capture */ }
    if (e.pointerType === 'mouse' && e.button !== 0) {
      mousePan = { x: e.clientX, y: e.clientY, tx, ty };
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      activePointer = e.pointerId;
      activeStroke = { kind: 'stroke', color, width: strokeWidth(), points: [toCanvasPoint(e)] };
      actions.push(activeStroke);
      drawStroke(activeStroke);
      undoBtn.disabled = false;
    } else if (pointers.size === 2) {
      // A second finger means zoom/move, not draw: take back the line just started.
      if (activeStroke) {
        const i = actions.lastIndexOf(activeStroke);
        if (i !== -1) actions.splice(i, 1);
        activeStroke = null;
        activePointer = null;
        redraw();
      }
      const [a, b] = [...pointers.values()];
      pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mid: fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2),
        zoom, tx, ty,
      };
    }
  });

  stage.addEventListener('pointermove', (e) => {
    if (mousePan && e.pointerType === 'mouse') {
      tx = mousePan.tx + (e.clientX - mousePan.x);
      ty = mousePan.ty + (e.clientY - mousePan.y);
      applyView();
      return;
    }
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch && pointers.size >= 2) {
      // Zoom by how far apart the fingers are; move by where their middle goes.
      const [a, b] = [...pointers.values()];
      let z = Math.min(MAX_ZOOM, Math.max(1, pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist)));
      if (z < 1.02) z = 1;
      const [mx, my] = fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2);
      // Keep the photo spot that was under the fingers' middle under it now.
      tx = mx - (z * (pinch.mid[0] - pinch.tx)) / pinch.zoom;
      ty = my - (z * (pinch.mid[1] - pinch.ty)) / pinch.zoom;
      zoom = z;
      if (zoom === 1) { tx = 0; ty = 0; }
      applyView();
      return;
    }
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

  function endPointer(e) {
    if (mousePan && e.pointerType === 'mouse') { mousePan = null; return; }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (e.pointerId === activePointer) {
      activePointer = null;
      activeStroke = null;
      redraw();   // redraw cleanly (joins the pieces)
    }
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [px, py] = fromCentre(e.clientX, e.clientY);
    zoomTo(zoom * Math.exp(-e.deltaY * 0.002), px, py);
  }, { passive: false });
  // Extra guard for iPhone: never let a touch here scroll the page or zoom the whole app.
  stage.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

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
    } else if (btn.dataset.act === 'zoom-in') {
      zoomTo(zoom * 1.6);
    } else if (btn.dataset.act === 'zoom-out') {
      zoomTo(zoom / 1.6);
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
