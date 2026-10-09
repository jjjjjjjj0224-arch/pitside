// Notebook template editor (#/template/build, /competition, /programming).
//   1. Upload your notebook as a PDF (or a picture of one page) and tap a sample page.
//   2. Add boxes on the page for the photo, caption, date... and drag/resize them.
//   3. Preview with your newest entry, then Save.
// Everything stays on the phone: the PDF is read here and never uploaded.

import { goBack } from '../router.js';
import { getAllEntries } from '../db.js';
import { getSettings, saveExportOptions } from '../settings.js';
import { openPdf } from '../pdfpages.js';
import { loadImage, canvasToBlob } from '../image.js';
import { renderTemplateImage } from '../render.js';
import { audioFileName } from '../exporter.js';
import {
  BOX_KINDS, kindLabel, TEXT_SIZES, getTemplate, saveTemplate, deleteTemplate, newBox, sampleCoverColor,
} from '../templates.js';
import { TYPE_LABELS, esc, confirmDialog, toast, UrlBag } from '../ui.js';

const PAGE_WIDTH = 1920;          // sample pages are kept 1920 pixels wide (sharp on a slide)
const THUMB_WIDTH = 220;
const PAGES_PER_BATCH = 24;

export async function renderTemplateEditor(el, type) {
  if (!TYPE_LABELS[type]) {
    el.innerHTML = '<main class="page"><h1>Unknown entry type</h1><a class="btn btn-primary btn-block" href="#/settings">Settings</a></main>';
    return {};
  }
  const urls = new UrlBag();
  const saved = await getTemplate(type);
  // Working copy (saved only when you tap Save).
  let tpl = saved ? { ...saved, boxes: saved.boxes.map((b) => ({ ...b })) } : null;
  let pdf = null;
  let selectedId = null;
  let zoom = 1;
  let dirty = false;
  let pagePixels = null;      // canvas with the sample page, to pick cover colors from

  function header() {
    return `
      <header class="topbar">
        <button type="button" class="btn btn-ghost" data-act="back">Back</button>
        <h1>${esc(TYPE_LABELS[type])} template</h1>
        <span class="topbar-spacer"></span>
      </header>`;
  }

  // ======================= Step 1: pick a sample page =======================

  function drawPicker() {
    el.innerHTML = `${header()}
      <main class="page template">
        <section class="card">
          <h2 class="section-title">1. Your notebook</h2>
          <p>Upload your engineering notebook as a <strong>PDF</strong> (Google Slides: File &gt; Download &gt; PDF).
            You can also use a picture of one page. It stays on this phone; nothing is uploaded.</p>
          <button type="button" class="btn btn-primary btn-block btn-lg" data-act="choose-file">Choose notebook PDF</button>
          <input type="file" accept="application/pdf,image/*" data-input="notebook" hidden>
          <p class="form-error" role="alert" hidden></p>
          ${tpl ? '<button type="button" class="btn btn-secondary btn-block" data-act="back-to-editor">Keep the current sample page</button>' : ''}
        </section>
        <section class="card page-picker" hidden>
          <h2 class="section-title">2. Tap a sample page for ${esc(TYPE_LABELS[type])} entries</h2>
          <p class="hint">Pick a page that looks the way ${esc(TYPE_LABELS[type])} entries should look.</p>
          <div class="page-grid"></div>
          <button type="button" class="btn btn-secondary btn-block" data-act="more-pages" hidden>Show more pages</button>
        </section>
      </main>`;
    wireCommon();
    const $ = (s) => el.querySelector(s);
    const input = $('[data-input="notebook"]');
    const showError = (m) => { const b = $('.form-error'); b.textContent = m; b.hidden = !m; };

    $('[data-act="choose-file"]').addEventListener('click', () => input.click());
    const keep = $('[data-act="back-to-editor"]');
    if (keep) keep.addEventListener('click', () => drawEditor());

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      showError('');
      const btn = $('[data-act="choose-file"]');
      btn.disabled = true;
      btn.textContent = 'Opening…';
      try {
        if (file.type.startsWith('image/')) {
          await usePage(await imageToPage(file), file.name);
          return;
        }
        if (pdf) pdf.close();
        pdf = await openPdf(file);
        pdf.name = file.name;
        $('.page-picker').hidden = false;
        $('.page-grid').innerHTML = '';
        await showPages(1);
        $('.page-picker').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        console.error(err);
        showError('Couldn\'t open that file. Make sure it\'s a PDF (or a picture of a page).');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Choose another file';
      }
    });

    // Page thumbnails, a batch at a time (big notebooks have many pages).
    async function showPages(from) {
      const grid = $('.page-grid');
      const to = Math.min(pdf.pageCount, from + PAGES_PER_BATCH - 1);
      for (let n = from; n <= to; n++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'page-thumb';
        btn.dataset.page = n;
        btn.innerHTML = `<span class="page-thumb-img"></span><span class="page-thumb-num">Page ${n}</span>`;
        grid.appendChild(btn);
      }
      const more = $('[data-act="more-pages"]');
      more.hidden = to >= pdf.pageCount;
      more.onclick = () => showPages(to + 1);
      for (let n = from; n <= to; n++) {
        const canvas = await pdf.render(n, THUMB_WIDTH);
        const slot = grid.querySelector(`[data-page="${n}"] .page-thumb-img`);
        if (slot) slot.appendChild(canvas);
      }
    }

    $('.page-grid').addEventListener('click', async (e) => {
      const thumb = e.target.closest('[data-page]');
      if (!thumb) return;
      thumb.disabled = true;
      thumb.querySelector('.page-thumb-num').textContent = 'Loading…';
      const n = Number(thumb.dataset.page);
      const canvas = await pdf.render(n, PAGE_WIDTH);
      await usePage(canvas, `${pdf.name}, page ${n}`);
    });
  }

  // A picture of a page -> canvas 1920 wide.
  async function imageToPage(file) {
    const img = await loadImage(file);
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_WIDTH;
    canvas.height = Math.round((img.naturalHeight / img.naturalWidth) * PAGE_WIDTH);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function usePage(canvas, source) {
    const page = await canvasToBlob(canvas, 'image/jpeg', 0.92);
    const boxes = tpl ? tpl.boxes : [];
    tpl = { type, page, width: canvas.width, height: canvas.height, source, boxes };
    pagePixels = canvas;
    dirty = true;
    if (pdf) { pdf.close(); pdf = null; }
    await drawEditor();
    if (!boxes.length) toast('Now add boxes where the photo and text should go.');
  }

  // ======================= Step 2: boxes on the page =======================

  async function ensurePixels() {
    if (pagePixels) return pagePixels;
    const img = await loadImage(tpl.page);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    pagePixels = c;
    return c;
  }

  async function drawEditor() {
    urls.revokeAll();
    el.innerHTML = `${header()}
      <main class="page template">
        <section class="card">
          <div class="template-head">
            <span class="muted">Sample: ${esc(tpl.source || 'page')}</span>
            <button type="button" class="btn btn-ghost btn-small" data-act="change-page">Change page</button>
          </div>
          <div class="zoom-row" role="group" aria-label="Zoom">
            <span class="label-small">Zoom</span>
            ${[1, 1.5, 2, 3].map((z) => `<button type="button" class="chip" data-zoom="${z}" aria-pressed="${z === zoom}">${z}×</button>`).join('')}
          </div>
          <div class="page-scroll">
            <div class="page-stage" style="width:${zoom * 100}%">
              <img class="page-img" src="${urls.make(tpl.page)}" alt="Sample notebook page" draggable="false">
              <div class="box-layer"></div>
            </div>
          </div>
          <p class="hint">Drag a box to move it; drag its corner to resize. Tap a box to change it.</p>
        </section>

        <section class="card">
          <h2 class="label-small">Add a box</h2>
          <div class="chips add-boxes">
            ${BOX_KINDS.map((k) => `<button type="button" class="chip" data-add="${k.kind}">+ ${esc(k.label)}</button>`).join('')}
          </div>
        </section>

        <section class="card box-panel" hidden></section>

        <section class="card">
          <button type="button" class="btn btn-secondary btn-block" data-act="preview">Preview with my newest ${esc(TYPE_LABELS[type])} entry</button>
          <img class="template-preview" alt="Preview of an exported entry" hidden>
          <p class="hint preview-note" hidden></p>
        </section>

        <p class="form-error" role="alert" hidden></p>
        <div class="button-row">
          <button type="button" class="btn btn-primary btn-lg" data-act="save">Save template</button>
          ${saved ? '<button type="button" class="btn btn-danger" data-act="remove">Remove</button>' : ''}
        </div>
      </main>`;
    wireCommon();
    wireEditor();
    drawBoxes();
    drawPanel();
  }

  function drawBoxes() {
    const layer = el.querySelector('.box-layer');
    if (!layer) return;
    layer.innerHTML = tpl.boxes.map((b) => `
      <div class="t-box${b.id === selectedId ? ' selected' : ''}${b.kind === 'photo' ? ' photo' : ''}" data-box="${b.id}"
           style="left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%;${b.cover ? `background:${b.coverColor};` : ''}">
        <span class="t-box-label" style="color:${b.kind === 'photo' ? '#fff' : b.color}">${esc(kindLabel(b.kind))}</span>
        <span class="t-handle" data-handle="${b.id}" aria-hidden="true"></span>
      </div>`).join('');
  }

  function drawPanel() {
    const panel = el.querySelector('.box-panel');
    const b = tpl.boxes.find((x) => x.id === selectedId);
    panel.hidden = !b;
    if (!b) return;
    const isPhoto = b.kind === 'photo';
    panel.innerHTML = `
      <div class="template-head">
        <h2 class="section-title">${esc(kindLabel(b.kind))}</h2>
        <button type="button" class="btn btn-ghost btn-small btn-danger-text" data-act="delete-box">Delete box</button>
      </div>
      <label class="option"><input type="checkbox" data-prop="cover" ${b.cover ? 'checked' : ''}>
        <span>Cover the old content under this box</span></label>
      <div class="prop-row" ${b.cover ? '' : 'hidden'}>
        <label class="color-field"><input type="color" data-prop="coverColor" value="${esc(b.coverColor)}"><span>Cover color</span></label>
        <button type="button" class="btn btn-secondary btn-small" data-act="pick-cover">Match the page</button>
      </div>
      ${isPhoto ? `
        <fieldset class="field">
          <legend class="label-small">Photo</legend>
          <label class="option"><input type="radio" name="fit" value="contain" ${b.fit !== 'cover' ? 'checked' : ''}> <span>Show the whole photo</span></label>
          <label class="option"><input type="radio" name="fit" value="cover" ${b.fit === 'cover' ? 'checked' : ''}> <span>Fill the box (crops the edges)</span></label>
        </fieldset>` : `
        <div class="prop-row">
          <label class="color-field"><input type="color" data-prop="color" value="${esc(b.color)}"><span>Text color</span></label>
          <label class="option"><input type="checkbox" data-prop="bold" ${b.bold ? 'checked' : ''}> <span>Bold</span></label>
        </div>
        <div class="prop-group" role="group" aria-label="Text size">
          <span class="label-small">Size</span>
          ${Object.keys(TEXT_SIZES).map((s) => `<button type="button" class="chip" data-size="${s}" aria-pressed="${b.size === s}">${s}</button>`).join('')}
        </div>
        <div class="prop-group" role="group" aria-label="Font">
          <span class="label-small">Font</span>
          ${[['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']].map(([f, n]) => `<button type="button" class="chip" data-font="${f}" aria-pressed="${b.font === f}">${n}</button>`).join('')}
        </div>
        <div class="prop-group" role="group" aria-label="Alignment">
          <span class="label-small">Align</span>
          ${[['left', 'Left'], ['center', 'Center'], ['right', 'Right']].map(([a, n]) => `<button type="button" class="chip" data-align="${a}" aria-pressed="${b.align === a}">${n}</button>`).join('')}
        </div>`}`;
  }

  function selected() {
    return tpl.boxes.find((x) => x.id === selectedId);
  }

  function changed() {
    dirty = true;
    drawBoxes();
  }

  function wireEditor() {
    const $ = (s) => el.querySelector(s);

    $('[data-act="change-page"]').addEventListener('click', () => drawPicker());

    el.querySelector('.zoom-row').addEventListener('click', (e) => {
      const z = e.target.closest('[data-zoom]');
      if (!z) return;
      zoom = Number(z.dataset.zoom);
      $('.page-stage').style.width = `${zoom * 100}%`;
      el.querySelectorAll('[data-zoom]').forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.zoom) === zoom)));
    });

    // Add a box in the visible part of the page, with the page's color guessed for the cover.
    el.querySelector('.add-boxes').addEventListener('click', async (e) => {
      const add = e.target.closest('[data-add]');
      if (!add) return;
      const box = newBox(add.dataset.add, 0.05 + (tpl.boxes.length % 5) * 0.06, 0.08 + (tpl.boxes.length % 5) * 0.06);
      const px = await ensurePixels();
      box.coverColor = sampleCoverColor(px.getContext('2d'), box, px.width, px.height);
      box.color = contrastText(box.coverColor);
      tpl.boxes.push(box);
      selectedId = box.id;
      changed();
      drawPanel();
      $('.page-scroll').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Dragging and resizing boxes (touch and mouse).
    const stage = $('.page-stage');
    let drag = null;
    stage.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('[data-handle]');
      const boxEl = e.target.closest('[data-box]');
      if (!boxEl) return;
      e.preventDefault();
      const b = tpl.boxes.find((x) => x.id === boxEl.dataset.box);
      if (selectedId !== b.id) {
        // Just move the highlight (redrawing would replace the box being dragged).
        selectedId = b.id;
        stage.querySelectorAll('[data-box]').forEach((n) => n.classList.toggle('selected', n === boxEl));
        drawPanel();
      }
      const rect = stage.getBoundingClientRect();
      drag = { b, mode: handle ? 'resize' : 'move', sx: e.clientX, sy: e.clientY, start: { ...b }, rect, moved: false };
      try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      e.preventDefault();
      const dx = (e.clientX - drag.sx) / drag.rect.width;
      const dy = (e.clientY - drag.sy) / drag.rect.height;
      if (Math.abs(dx) + Math.abs(dy) > 0.002) drag.moved = true;
      const { b, start } = drag;
      if (drag.mode === 'move') {
        b.x = Math.min(1 - b.w, Math.max(0, start.x + dx));
        b.y = Math.min(1 - b.h, Math.max(0, start.y + dy));
      } else {
        b.w = Math.min(1 - b.x, Math.max(0.02, start.w + dx));
        b.h = Math.min(1 - b.y, Math.max(0.02, start.h + dy));
      }
      const node = stage.querySelector(`[data-box="${b.id}"]`);
      Object.assign(node.style, { left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` });
    });
    const endDrag = () => { if (drag && drag.moved) dirty = true; drag = null; };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    // Tapping the page (not a box) unselects.
    stage.addEventListener('click', (e) => {
      if (!e.target.closest('[data-box]') && selectedId) { selectedId = null; drawBoxes(); drawPanel(); }
    });

    // Box settings panel.
    const panel = $('.box-panel');
    panel.addEventListener('input', (e) => {
      const b = selected();
      if (!b) return;
      const prop = e.target.dataset.prop;
      if (prop === 'coverColor' || prop === 'color') { b[prop] = e.target.value; changed(); }
    });
    panel.addEventListener('change', (e) => {
      const b = selected();
      if (!b) return;
      const prop = e.target.dataset.prop;
      if (prop === 'cover') { b.cover = e.target.checked; changed(); drawPanel(); }
      if (prop === 'bold') { b.bold = e.target.checked; changed(); }
      if (e.target.name === 'fit') { b.fit = e.target.value; changed(); }
    });
    panel.addEventListener('click', async (e) => {
      const b = selected();
      if (!b) return;
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.size) b.size = t.dataset.size;
      else if (t.dataset.font) b.font = t.dataset.font;
      else if (t.dataset.align) b.align = t.dataset.align;
      else if (t.dataset.act === 'pick-cover') {
        const px = await ensurePixels();
        b.coverColor = sampleCoverColor(px.getContext('2d'), b, px.width, px.height);
      } else if (t.dataset.act === 'delete-box') {
        tpl.boxes = tpl.boxes.filter((x) => x.id !== b.id);
        selectedId = null;
      } else return;
      changed();
      drawPanel();
    });

    // Preview with the newest entry of this type (or a sample).
    $('[data-act="preview"]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const entry = (await getAllEntries()).find((x) => x.type === type) || await sampleEntry(type);
        const png = await renderTemplateImage(entry, tpl, audioFileName(entry), 0);
        const img = $('.template-preview');
        img.src = urls.make(png);
        img.hidden = false;
        const note = $('.preview-note');
        note.hidden = false;
        note.textContent = entry.id === 'sample' ? 'Using sample text (you have no entries of this type yet).' : `Using: ${entry.caption ? entry.caption.split('\n')[0] : 'your newest entry'}`;
        img.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } finally {
        btn.disabled = false;
      }
    });

    $('[data-act="save"]').addEventListener('click', async () => {
      if (!tpl.boxes.length) {
        const err = $('.form-error');
        err.textContent = 'Add at least one box (for example Photo and Caption) first.';
        err.hidden = false;
        return;
      }
      await saveTemplate(type, tpl);
      // Use the template for this type's exports.
      const opts = getSettings().export[type];
      await saveExportOptions(type, { ...opts, layout: 'template' });
      dirty = false;
      toast(`${TYPE_LABELS[type]} template saved. Exports now use your notebook layout.`);
      goBack('#/settings');
    });

    const removeBtn = $('[data-act="remove"]');
    if (removeBtn) {
      removeBtn.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: `Remove the ${TYPE_LABELS[type]} template?`,
          message: 'Exports of this type go back to the standard PitSide layout.',
          confirmText: 'Remove',
          danger: true,
        });
        if (!ok) return;
        await deleteTemplate(type);
        const opts = getSettings().export[type];
        await saveExportOptions(type, { ...opts, layout: 'standard' });
        dirty = false;
        toast('Template removed');
        goBack('#/settings');
      });
    }
  }

  function wireCommon() {
    el.querySelector('[data-act="back"]').addEventListener('click', () => goBack('#/settings'));
  }

  if (tpl) await drawEditor(); else drawPicker();

  return {
    async canLeave() {
      if (!dirty) return true;
      return confirmDialog({
        title: 'Leave without saving?',
        message: 'Your changes to this template will be lost.',
        confirmText: 'Leave',
        cancelText: 'Keep editing',
        danger: true,
      });
    },
    unmount() {
      urls.revokeAll();
      if (pdf) pdf.close();
    },
  };
}

// Black or white text, whichever reads better on the cover color.
function contrastText(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#111111' : '#FFFFFF';
}

// Placeholder entry for the preview when there are no entries of this type yet.
async function sampleEntry(type) {
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 900;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6B7280';
  ctx.fillRect(0, 0, 1200, 900);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '600 80px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Sample photo', 600, 470);
  const photo = await canvasToBlob(c, 'image/jpeg', 0.8);
  return {
    id: 'sample', type, stage: 'build', matchNumber: 'Q12', author: getSettings().author || 'Your name',
    caption: 'Sample caption: moved the intake forward two holes so it reaches the rings without hitting the wall.',
    createdAt: new Date().toISOString(), audio: null,
    photos: [{ photo, drawing: null }],
  };
}
