// Full-screen photo viewer with zoom.
//   - Pinch with two fingers, double-tap, or the Zoom buttons (mouse wheel on a laptop)
//   - Drag to move around while zoomed in
//   - Swipe left/right (when not zoomed) or Prev/Next to switch photos
//   - Close, Escape, or the phone's Back button closes it
//
// The drawing is shown on top of the photo, exactly lined up, at every zoom level.

import { setOverlay } from './router.js';

const MAX_ZOOM = 5;

// photos: [{ photo: Blob, drawing: Blob | null }]. onClose(index) gets the photo shown last.
// onDraw(index): if given, a "Draw" button closes the viewer and starts drawing on that photo.
export function openViewer(photos, start = 0, { onClose, onDraw } = {}) {
  if (!photos.length) return;
  let index = Math.min(Math.max(0, start), photos.length - 1);
  let scale = 1;
  let tx = 0;          // pan offset in screen pixels
  let ty = 0;
  let urls = [];

  const overlay = document.createElement('div');
  overlay.className = 'viewer';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Photo, full screen');
  overlay.innerHTML = `
    <div class="viewer-top">
      <span class="viewer-count" aria-live="polite"></span>
      ${onDraw ? '<button type="button" class="btn viewer-btn" data-act="draw">Draw</button>' : ''}
      <button type="button" class="btn viewer-btn" data-act="close">Close</button>
    </div>
    <div class="viewer-stage">
      <div class="viewer-box">
        <img class="viewer-photo" alt="" draggable="false">
        <img class="viewer-drawing" alt="" draggable="false" hidden>
      </div>
    </div>
    <div class="viewer-bottom">
      <button type="button" class="btn viewer-btn" data-act="prev">‹ Prev</button>
      <button type="button" class="btn viewer-btn" data-act="zoom-out">− Zoom out</button>
      <button type="button" class="btn viewer-btn" data-act="zoom-in">+ Zoom in</button>
      <button type="button" class="btn viewer-btn" data-act="next">Next ›</button>
    </div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('no-scroll');

  const stage = overlay.querySelector('.viewer-stage');
  const box = overlay.querySelector('.viewer-box');
  const photoImg = overlay.querySelector('.viewer-photo');
  const drawingImg = overlay.querySelector('.viewer-drawing');
  const $ = (s) => overlay.querySelector(s);

  // ---- Showing a photo ----

  function freeUrls() {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = [];
  }

  function show(i) {
    index = i;
    scale = 1; tx = 0; ty = 0;
    freeUrls();
    const p = photos[index];
    const photoUrl = URL.createObjectURL(p.photo);
    urls.push(photoUrl);
    photoImg.onload = layout;
    photoImg.src = photoUrl;
    photoImg.alt = `Photo ${index + 1} of ${photos.length}`;
    drawingImg.hidden = !p.drawing;
    if (p.drawing) {
      const d = URL.createObjectURL(p.drawing);
      urls.push(d);
      drawingImg.src = d;
    }
    $('.viewer-count').textContent = photos.length > 1 ? `Photo ${index + 1} of ${photos.length}` : 'Photo';
    $('[data-act="prev"]').hidden = $('[data-act="next"]').hidden = photos.length < 2;
    $('[data-act="prev"]').disabled = index === 0;
    $('[data-act="next"]').disabled = index === photos.length - 1;
    apply();
  }

  // Fit the photo inside the screen (same shape), before zooming.
  function layout() {
    const w = photoImg.naturalWidth || 1;
    const h = photoImg.naturalHeight || 1;
    const fit = Math.min(stage.clientWidth / w, stage.clientHeight / h);
    box.style.width = `${Math.floor(w * fit)}px`;
    box.style.height = `${Math.floor(h * fit)}px`;
    apply();
  }

  // Keep the zoomed photo from being dragged off screen, then draw it.
  function apply() {
    const maxX = Math.max(0, (box.offsetWidth * scale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (box.offsetHeight * scale - stage.clientHeight) / 2);
    tx = Math.min(maxX, Math.max(-maxX, tx));
    ty = Math.min(maxY, Math.max(-maxY, ty));
    box.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    $('[data-act="zoom-out"]').disabled = scale <= 1;
    $('[data-act="zoom-in"]').disabled = scale >= MAX_ZOOM;
  }

  // Zoom to newScale, keeping the point (px, py) (relative to the stage centre) still.
  function zoomTo(newScale, px = 0, py = 0) {
    let s = Math.min(MAX_ZOOM, Math.max(1, newScale));
    if (s < 1.02) s = 1;     // snap back to exactly "not zoomed" (avoids 1.0000000002)
    tx = px - ((px - tx) * s) / scale;
    ty = py - ((py - ty) * s) / scale;
    scale = s;
    if (scale === 1) { tx = 0; ty = 0; }
    apply();
  }

  // Point on the stage, measured from its centre.
  function fromCentre(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    return [clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2)];
  }

  // ---- Touch / mouse ----

  const pointers = new Map();
  let pinch = null;        // { dist, scale }
  let drag = null;         // { x, y, tx, ty, startX, startY, moved }
  let lastTap = 0;

  stage.addEventListener('pointerdown', (e) => {
    try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale };
      drag = null;
    } else if (pointers.size === 1) {
      drag = { x: e.clientX, y: e.clientY, tx, ty, startX: e.clientX, startY: e.clientY, moved: false };
    }
  });

  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const [mx, my] = fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2);
      zoomTo(pinch.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist), mx, my);
    } else if (drag) {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) drag.moved = true;
      if (scale > 1) {          // zoomed in: drag moves the photo
        tx = drag.tx + (e.clientX - drag.x);
        ty = drag.ty + (e.clientY - drag.y);
        apply();
      }
    }
  });

  function onPointerEnd(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!drag || pointers.size > 0) {
      if (pointers.size === 0) drag = null;
      return;
    }
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && e.type === 'pointerup') {
      // Double-tap: zoom in on that spot, or back out.
      const now = Date.now();
      if (now - lastTap < 300) {
        const [px, py] = fromCentre(e.clientX, e.clientY);
        zoomTo(scale > 1 ? 1 : 2.5, px, py);
        lastTap = 0;
      } else {
        lastTap = now;
      }
    } else if (scale === 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      go(index + (dx < 0 ? 1 : -1));   // swipe to the next/previous photo
    }
    drag = null;
  }
  stage.addEventListener('pointerup', onPointerEnd);
  stage.addEventListener('pointercancel', onPointerEnd);

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [px, py] = fromCentre(e.clientX, e.clientY);
    zoomTo(scale * Math.exp(-e.deltaY * 0.002), px, py);
  }, { passive: false });

  // ---- Buttons and keys ----

  function go(i) {
    if (i >= 0 && i < photos.length && i !== index) show(i);
  }

  overlay.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'close') close();
    if (act.dataset.act === 'draw') { const i = index; close(); onDraw(i); }
    if (act.dataset.act === 'prev') go(index - 1);
    if (act.dataset.act === 'next') go(index + 1);
    if (act.dataset.act === 'zoom-in') zoomTo(scale * 1.6);
    if (act.dataset.act === 'zoom-out') zoomTo(scale / 1.6);
  });

  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') go(index - 1);
    else if (e.key === 'ArrowRight') go(index + 1);
    else if (e.key === '+' || e.key === '=') zoomTo(scale * 1.6);
    else if (e.key === '-') zoomTo(scale / 1.6);
  }
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', layout);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    setOverlay(null);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', layout);
    document.body.classList.remove('no-scroll');
    freeUrls();
    overlay.remove();
    if (onClose) onClose(index);
  }

  setOverlay(close);     // the phone's Back button closes the viewer
  show(index);
  $('[data-act="close"]').focus();
  return { close };
}
