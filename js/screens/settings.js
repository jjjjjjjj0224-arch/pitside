// Settings: author name, default type, export options per type, storage,
// delete all, privacy note. Every change saves straight away.

import { getAllEntries, deleteAllEntries, entryBytes, isStoragePersistent } from '../db.js';
import { getSettings, saveSettings, saveExportOptions } from '../settings.js';
import { goBack } from '../router.js';
import { renderEntryImage } from '../render.js';
import { canvasToBlob } from '../image.js';
import { audioFileName } from '../exporter.js';
import { isCloudConfigured } from '../cloud.js';
import { getTeam, renameMe } from '../team.js';
import { TYPES, TYPE_LABELS, ACCENTS, esc, formatBytes, confirmDialog, toast, UrlBag } from '../ui.js';

const FIELD_LABELS = [
  ['caption', 'Caption'],
  ['datetime', 'Date and time'],
  ['author', 'Author'],
  ['stage', 'Stage'],
  ['match', 'Match number'],
];

export async function renderSettings(el) {
  let settings = getSettings();
  let entries = await getAllEntries();
  const urls = new UrlBag();

  el.innerHTML = `
    <header class="topbar">
      <button type="button" class="btn btn-ghost" data-act="back">Back</button>
      <h1>Settings</h1>
      <span class="topbar-spacer"></span>
    </header>
    <main class="page settings">
      <section class="card">
        <label class="label" for="author">Your name</label>
        <input id="author" class="input" type="text" maxlength="60" autocomplete="name"
               autocapitalize="words" value="${esc(settings.author)}">
        <p class="hint">Added as the author of new entries${getTeam() ? ', and the name your team sees' : ''}.</p>
        <p class="form-error" data-author-error role="alert" hidden>Your name can't be empty.</p>
      </section>

      ${isCloudConfigured() ? `
      <section class="card">
        <h2 class="section-title">Team</h2>
        <p>${getTeam() ? `You're in <strong>${esc(getTeam().teamName)}</strong>.` : 'Not in a team yet.'}</p>
        <a class="btn btn-secondary btn-block" href="#/team">${getTeam() ? 'Open team' : 'Join or create a team'}</a>
      </section>` : ''}

      <section class="card">
        <h2 class="label" id="default-type-label">Default entry type</h2>
        <div class="segmented" role="group" aria-labelledby="default-type-label">
          ${TYPES.map((t) => `<button type="button" class="seg-btn" data-default-type="${t}">${TYPE_LABELS[t]}</button>`).join('')}
        </div>
        <p class="hint">Picked automatically on the New entry screen.</p>
      </section>

      <section class="card">
        <h2 class="section-title">Export options</h2>
        <p class="hint">Each entry type has its own image style.</p>
        ${TYPES.map((t) => exportOptionsHtml(t)).join('')}
      </section>

      <section class="card">
        <h2 class="section-title">Storage</h2>
        <p class="storage-text">Counting…</p>
        <p class="hint persist-text"></p>
        <button type="button" class="btn btn-danger btn-block" data-act="delete-all">Delete all entries</button>
      </section>

      <section class="card">
        <h2 class="section-title">Privacy</h2>
        <p>PitSide stores your name, your settings and your entries (photos, drawings, voice notes, captions,
          match numbers and dates) in this browser on this phone. There is no email, password or account to make.</p>
        <p>If you join a team, entries with "Share with team" switched on are uploaded to your team's online
          storage (Supabase), with your name. Only members of your team can see them. Entries that aren't
          shared never leave the phone, unless you tap Share or Export.</p>
        <p class="hint">Deleting the app or clearing this browser's website data also deletes your entries, so export them regularly.</p>
      </section>

      <p class="hint center">PitSide v1.2</p>
    </main>`;

  const $ = (s) => el.querySelector(s);

  // ---- Author ----
  const authorInput = $('#author');
  const authorError = $('[data-author-error]');
  authorInput.addEventListener('change', async () => {
    const name = authorInput.value.trim();
    if (!name) {
      authorError.hidden = false;
      authorInput.value = settings.author;
      return;
    }
    authorError.hidden = true;
    settings = await saveSettings({ author: name });
    toast('Name saved');
    // Teammates see the new name too (if online; otherwise it stays as before).
    if (getTeam()) renameMe(name).catch((err) => console.warn('Team name not updated', err));
  });

  // ---- Default type ----
  function showDefaultType() {
    el.querySelectorAll('[data-default-type]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.defaultType === settings.defaultType)));
  }
  $('.segmented').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-default-type]');
    if (!btn) return;
    settings = await saveSettings({ defaultType: btn.dataset.defaultType });
    showDefaultType();
  });
  showDefaultType();

  // ---- Export options per type ----
  for (const type of TYPES) {
    const box = el.querySelector(`[data-export-type="${type}"]`);
    const opts = settings.export[type];
    box.querySelectorAll('input[data-size]').forEach((r) => { r.checked = r.value === opts.size; });
    box.querySelectorAll('input[data-field]').forEach((c) => { c.checked = Boolean(opts.fields[c.dataset.field]); });
    box.querySelectorAll('input[data-accent]').forEach((r) => { r.checked = r.value === opts.accent; });

    box.addEventListener('change', async () => {
      const next = {
        size: box.querySelector('input[data-size]:checked').value,
        fields: {},
        accent: box.querySelector('input[data-accent]:checked').value,
      };
      box.querySelectorAll('input[data-field]').forEach((c) => { next.fields[c.dataset.field] = c.checked; });
      settings = await saveExportOptions(type, next);
      box.querySelector('summary .type-badge').style.setProperty('--accent', next.accent);
      updatePreview(type);
    });
    box.addEventListener('toggle', () => { if (box.open) updatePreview(type); });
  }

  // Preview of the exported image, using the newest entry of that type
  // (or a sample if there is none yet).
  const previewToken = {};
  async function updatePreview(type) {
    const box = el.querySelector(`[data-export-type="${type}"]`);
    if (!box.open) return;
    const img = box.querySelector('.export-preview');
    const token = (previewToken[type] = {});
    const entry = entries.find((e) => e.type === type) || await sampleEntry(type, settings.author);
    try {
      const png = await renderEntryImage(entry, settings.export[type], audioFileName(entry));
      if (previewToken[type] !== token) return;   // a newer preview started
      img.src = urls.make(png);
      img.hidden = false;
    } catch (err) {
      console.error(err);
    }
  }

  // ---- Storage ----
  async function showStorage() {
    const bytes = entries.reduce((sum, e) => sum + entryBytes(e), 0);
    $('.storage-text').textContent = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} · about ${formatBytes(bytes)}`;
    const persistent = await isStoragePersistent();
    $('.persist-text').textContent = persistent
      ? 'This browser has agreed to keep your entries even when the phone is low on space.'
      : 'Tip: install PitSide to your home screen so the browser is less likely to clear your entries.';
    $('[data-act="delete-all"]').disabled = entries.length === 0;
  }
  showStorage();

  // Delete all: confirm twice.
  $('[data-act="delete-all"]').addEventListener('click', async () => {
    const first = await confirmDialog({
      title: 'Delete all entries?',
      message: `This removes all ${entries.length} entries from this phone. Export first if you still need them.`
        + `${getTeam() ? ' Entries you already shared stay with your team.' : ''}`,
      confirmText: 'Delete all',
      danger: true,
    });
    if (!first) return;
    const second = await confirmDialog({
      title: 'Are you sure?',
      message: 'Every photo, drawing, voice note and caption will be gone. This can\'t be undone.',
      confirmText: 'Yes, delete everything',
      cancelText: 'Keep my entries',
      danger: true,
    });
    if (!second) return;
    await deleteAllEntries();
    entries = await getAllEntries();
    showStorage();
    toast('All entries deleted');
  });

  $('[data-act="back"]').addEventListener('click', () => goBack('#/home'));

  return { unmount: () => urls.revokeAll() };

  // HTML for one type's export options (inside a collapsible <details>).
  function exportOptionsHtml(type) {
    const n = `exp-${type}`;
    return `
      <details class="export-type" data-export-type="${type}">
        <summary><span class="type-badge" style="--accent:${esc(settings.export[type].accent)}">${TYPE_LABELS[type]}</span> export</summary>
        <fieldset class="field">
          <legend class="label-small">Image size</legend>
          <label class="option"><input type="radio" name="${n}-size" data-size value="slide"> <span>Slide 16:9 (1920 × 1080)</span></label>
          <label class="option"><input type="radio" name="${n}-size" data-size value="square"> <span>Square (1080 × 1080)</span></label>
        </fieldset>
        <fieldset class="field">
          <legend class="label-small">Print on the image</legend>
          ${FIELD_LABELS.map(([key, label]) => `
            <label class="option"><input type="checkbox" data-field="${key}"> <span>${label}</span></label>`).join('')}
        </fieldset>
        <fieldset class="field">
          <legend class="label-small">Label color</legend>
          <div class="accent-list">
            ${ACCENTS.map((a) => `
              <label class="option accent-option">
                <input type="radio" name="${n}-accent" data-accent value="${a.value}">
                <span class="accent-swatch" style="background:${a.value}" aria-hidden="true"></span>
                <span>${a.name}</span>
              </label>`).join('')}
          </div>
        </fieldset>
        <p class="label-small">Preview</p>
        <img class="export-preview" alt="Preview of an exported ${TYPE_LABELS[type]} image" hidden>
      </details>`;
  }
}

// A made-up entry so the preview works before any entries exist.
let samplePhoto = null;
async function sampleEntry(type, author) {
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
    ctx.font = '600 72px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Sample photo', 600, 470);
    samplePhoto = await canvasToBlob(c, 'image/jpeg', 0.8);
  }
  return {
    id: 'sample',
    type,
    stage: 'build',
    photo: samplePhoto,
    drawing: null,
    caption: 'Sample caption: moved the intake 2 holes forward so it reaches the rings without hitting the wall.',
    audio: null,
    matchNumber: type === 'competition' ? 'Q12' : null,
    author: author || 'Your name',
    createdAt: new Date().toISOString(),
  };
}
