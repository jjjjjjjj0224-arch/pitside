// Export screen: pick entry types, a date range and a format (with previews), then make a ZIP with
// one PNG per entry, the voice notes, and entries.csv.

import { getAllEntries, getAllTeamEntries } from '../db.js';
import { getSettings } from '../settings.js';
import { getTeams } from '../team.js';
import { loadTeamFiles } from '../sync.js';
import { photosOf } from '../image.js';
import { goBack } from '../router.js';
import { buildExportZip, canShareFile, downloadBlob, shareOrDownload, previewImage, pageCount } from '../exporter.js';
import { listFormats, formatName } from '../templates.js';
import { sampleEntry } from '../render.js';
import { openViewer } from '../viewer.js';
import { TYPES, TYPE_LABELS, esc, formatBytes, formatShortDate, toast, UrlBag } from '../ui.js';

// Keep the user's choices while the app is open.
const choice = {
  source: 'mine',    // 'mine', or a team id (that whole team's shared entries)
  includePhotos: true,   // add a photos/ folder with the full-size photos
  slides: true,      // add slides.pptx: one editable slide per entry (move photos and text yourself)
  format: 'auto',    // 'auto' (each type's own format), 'standard' (PitSide layout) or a format id
  types: new Set(TYPES),
  range: 'week',     // 'week' | 'last7' | 'custom' | 'all'
  from: null,        // 'YYYY-MM-DD' for custom
  to: null,
};

const pad = (n) => String(n).padStart(2, '0');
const toInputDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// Work out the start and end time for the chosen range.
function rangeBounds() {
  const now = new Date();
  const today = startOfDay(now);
  const endOfToday = new Date(today.getTime() + 86400000 - 1);
  if (choice.range === 'week') {
    // This week = since Monday.
    const daysSinceMonday = (today.getDay() + 6) % 7;
    return { from: new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysSinceMonday), to: endOfToday };
  }
  if (choice.range === 'last7') {
    return { from: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6), to: endOfToday };
  }
  if (choice.range === 'custom') {
    const [fy, fm, fd] = choice.from.split('-').map(Number);
    const [ty, tm, td] = choice.to.split('-').map(Number);
    return { from: new Date(fy, fm - 1, fd), to: new Date(ty, tm - 1, td, 23, 59, 59, 999) };
  }
  return { from: null, to: null };   // all entries
}

export async function renderExport(el) {
  const settings = getSettings();
  const entries = await getAllEntries();
  const teams = getTeams();
  const teamEntries = teams.length ? await getAllTeamEntries() : [];
  if (choice.source !== 'mine' && !teams.some((t) => t.teamId === choice.source)) choice.source = 'mine';
  // Formats to choose from: Auto, the PitSide layout, then your notebook formats.
  const formats = [
    { id: 'auto', name: 'Auto' },
    { id: 'standard', name: 'PitSide layout' },
    ...await listFormats(),
  ];
  if (!formats.some((f) => f.id === choice.format)) choice.format = 'auto';
  // "Build: 96969Y Build" for each type, for the Auto note.
  const typeFormatNames = Object.fromEntries(await Promise.all(TYPES.map(async (t) => [t, await formatName(settings.export[t].format)])));
  const urls = new UrlBag();
  if (!choice.from) {
    const today = new Date();
    choice.to = toInputDate(today);
    choice.from = toInputDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6));
  }

  el.innerHTML = `
    <header class="topbar">
      <button type="button" class="btn btn-ghost" data-act="back">Back</button>
      <h1>Export</h1>
      <span class="topbar-spacer"></span>
    </header>
    <main class="page export">
      ${teams.length ? `
      <fieldset class="field">
        <legend class="label">Entries from</legend>
        <div class="option-list">
          <label class="option"><input type="radio" name="source" value="mine"> <span>Just mine</span></label>
          ${teams.map((t) => `<label class="option"><input type="radio" name="source" value="${esc(t.teamId)}"> <span>Whole team: ${esc(t.teamName)}</span></label>`).join('')}
        </div>
      </fieldset>` : ''}

      <fieldset class="field">
        <legend class="label">Entry types</legend>
        <div class="chips">
          ${TYPES.map((t) => `<button type="button" class="chip chip-check" data-type="${t}">${TYPE_LABELS[t]}</button>`).join('')}
        </div>
      </fieldset>

      <fieldset class="field">
        <legend class="label">Dates</legend>
        <div class="option-list">
          ${[['week', 'This week'], ['last7', 'Last 7 days'], ['custom', 'Custom'], ['all', 'All entries']].map(([v, label]) => `
            <label class="option"><input type="radio" name="range" value="${v}"> <span>${label}</span></label>`).join('')}
        </div>
        <div class="custom-dates" hidden>
          <label class="date-field"><span class="label-small">From</span><input type="date" class="input" data-date="from"></label>
          <label class="date-field"><span class="label-small">To</span><input type="date" class="input" data-date="to"></label>
        </div>
        <p class="hint range-text"></p>
      </fieldset>

      <fieldset class="field">
        <legend class="label">Format</legend>
        <div class="format-row">
          ${formats.map((f) => `
            <button type="button" class="format-card" data-format="${esc(f.id)}" aria-pressed="false">
              <span class="format-img"><img alt="" hidden></span>
              <span class="format-name">${esc(f.name)}</span>
            </button>`).join('')}
        </div>
        <p class="hint format-note"></p>
        <a class="btn btn-ghost btn-small" href="#/template/new">+ New format from my notebook</a>
      </fieldset>

      <label class="option">
        <input type="checkbox" data-include-photos>
        <span>Also include the full-size photos (a "photos" folder, for writing the notebook)</span>
      </label>

      <label class="option">
        <input type="checkbox" data-slides>
        <span>Also make editable slides (slides.pptx): one slide per entry with all its photos and captions,
          each one separate so you can move them around. Google Slides: File &gt; Import slides.</span>
      </label>

      <p class="match-count" aria-live="polite"></p>
      <p class="form-error" role="alert" hidden></p>

      <button type="button" class="btn btn-primary btn-block btn-lg" data-act="export">Export</button>
      <p class="hint">Makes a ZIP with one slide image per photo (ready for Google Slides), each voice note, a spreadsheet file (entries.csv), and the photos themselves if ticked above.</p>

      <section class="export-result" hidden aria-live="polite">
        <h2 class="label">ZIP ready</h2>
        <p class="result-text"></p>
        <div class="button-row">
          <button type="button" class="btn btn-primary" data-act="share-zip" hidden>Share ZIP</button>
          <button type="button" class="btn btn-secondary" data-act="download-zip">Download ZIP</button>
        </div>
      </section>
    </main>`;

  const $ = (s) => el.querySelector(s);
  const exportBtn = $('[data-act="export"]');
  const countEl = $('.match-count');
  const errorEl = $('.form-error');
  const result = $('.export-result');
  let zipFile = null;
  let working = false;

  function matching() {
    const { from, to } = rangeBounds();
    const source = choice.source === 'mine' ? entries : teamEntries.filter((e) => e.teamId === choice.source);
    return source.filter((e) => {
      if (!choice.types.has(e.type)) return false;
      const t = new Date(e.createdAt);
      return (!from || t >= from) && (!to || t <= to);
    });
  }

  // ---- Format previews ----
  // Each card shows the newest matching entry in that format (or a sample entry).
  async function previewEntry() {
    const newest = matching().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    const type = newest ? newest.type : [...choice.types][0] || TYPES[0];
    const sample = await sampleEntry(type, settings.author);
    if (!newest) return sample;
    if (choice.source === 'mine') return newest;
    // A teammate's entry: its photos may not be on this phone yet, so use the sample photo.
    const mine = entries.find((e) => e.id === newest.id);
    return mine || { ...sample, ...newest, id: newest.id, photos: sample.photos, audio: null };
  }

  let previewKey = null;
  let previewTimer = null;
  let previewRun = 0;
  function schedulePreviews() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(drawPreviews, 250);
  }
  async function drawPreviews() {
    const entry = await previewEntry();
    const key = `${entry.id}|${entry.type}`;
    if (key === previewKey) return;
    previewKey = key;
    const run = ++previewRun;
    // The chosen format first, so the one that matters shows up soonest.
    const order = [...formats].sort((a, b) => (b.id === choice.format) - (a.id === choice.format));
    for (const f of order) {
      if (run !== previewRun) return;     // filters changed: a newer run took over
      try {
        const jpeg = await previewImage(entry, settings, f.id);
        if (run !== previewRun) return;
        const img = el.querySelector(`[data-format="${CSS.escape(f.id)}"] img`);
        if (!img) return;                 // left the screen
        urls.revoke(img.src);
        img.src = urls.make(jpeg);
        img.hidden = false;
      } catch (err) {
        console.warn('Preview failed', f.id, err);
      }
    }
  }

  function showFormat() {
    el.querySelectorAll('[data-format]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.format === choice.format)));
    const note = $('.format-note');
    if (choice.format === 'auto') {
      note.textContent = `Each type uses its own format (set in Settings): ${[...choice.types].map((t) => `${TYPE_LABELS[t]}: ${typeFormatNames[t]}`).join(' · ')}.`;
    } else {
      note.textContent = `Every entry is made in ${formats.find((f) => f.id === choice.format).name}. Tap it again to see it bigger.`;
    }
  }

  $('.format-row').addEventListener('click', async (e) => {
    const card = e.target.closest('[data-format]');
    if (!card) return;
    if (card.dataset.format !== choice.format) {
      choice.format = card.dataset.format;
      update();
      return;
    }
    // Tapping the chosen one again: see the preview full size.
    const entry = await previewEntry();
    const big = await previewImage(entry, settings, choice.format, 1600);
    openViewer([{ photo: big, drawing: null }], 0);
  });

  function update() {
    showFormat();
    schedulePreviews();
    el.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-pressed', String(choice.types.has(b.dataset.type))));
    el.querySelectorAll('input[name="range"]').forEach((r) => { r.checked = r.value === choice.range; });
    el.querySelectorAll('input[name="source"]').forEach((r) => { r.checked = r.value === choice.source; });
    $('[data-include-photos]').checked = choice.includePhotos;
    $('[data-slides]').checked = choice.slides;
    $('.custom-dates').hidden = choice.range !== 'custom';
    $('[data-date="from"]').value = choice.from;
    $('[data-date="to"]').value = choice.to;

    const { from, to } = rangeBounds();
    let problem = '';
    if (choice.range === 'custom' && from > to) problem = 'The From date is after the To date.';
    if (choice.types.size === 0) problem = 'Choose at least one entry type.';
    $('.range-text').textContent = from ? `${formatShortDate(from)} – ${formatShortDate(to)}` : 'Every saved entry';

    const n = problem ? 0 : matching().length;
    countEl.textContent = `${n} ${n === 1 ? 'entry matches' : 'entries match'}`;
    errorEl.textContent = problem;
    errorEl.hidden = !problem;
    exportBtn.disabled = working || n === 0;
    result.hidden = true;     // choices changed: old ZIP no longer matches
    zipFile = null;
  }

  el.querySelector('.chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-type]');
    if (!chip) return;
    const t = chip.dataset.type;
    if (choice.types.has(t)) choice.types.delete(t); else choice.types.add(t);
    update();
  });
  el.querySelectorAll('input[name="range"]').forEach((r) => r.addEventListener('change', () => {
    choice.range = r.value;
    update();
  }));
  el.querySelectorAll('input[name="source"]').forEach((r) => r.addEventListener('change', () => {
    choice.source = r.value;
    update();
  }));
  $('[data-slides]').addEventListener('change', (e) => {
    choice.slides = e.target.checked;
    update();
  });
  $('[data-include-photos]').addEventListener('change', (e) => {
    choice.includePhotos = e.target.checked;
    update();
  });

  // Team export: teammates' photos and voice notes are downloaded first
  // (kept on the phone afterwards). My own entries use the copies on this phone.
  async function withFiles(list) {
    if (choice.source === 'mine') return list;
    const mine = new Map(entries.map((e) => [e.id, e]));
    const ready = [];
    for (let i = 0; i < list.length; i++) {
      exportBtn.textContent = `Downloading… ${i + 1} of ${list.length}`;
      const rec = list[i];
      ready.push(mine.get(rec.id) || await loadTeamFiles(rec, { photos: true, audio: true }));
    }
    return ready;
  }
  el.querySelectorAll('[data-date]').forEach((input) => input.addEventListener('change', () => {
    if (input.value) choice[input.dataset.date] = input.value;
    update();
  }));
  $('[data-act="back"]').addEventListener('click', () => goBack('#/home'));

  exportBtn.addEventListener('click', async () => {
    if (!matching().length || working) return;
    working = true;
    exportBtn.disabled = true;
    let list;
    try {
      list = await withFiles(matching());
    } catch (err) {
      console.warn(err);
      errorEl.textContent = "Couldn't download your teammates' photos. Connect to the internet and try again.";
      errorEl.hidden = false;
      working = false;
      exportBtn.disabled = false;
      exportBtn.textContent = 'Export';
      return;
    }
    try {
      const zip = await buildExportZip(list, settings, (done, total) => {
        exportBtn.textContent = `Making images… ${done} of ${total}`;
      }, { includePhotos: choice.includePhotos, format: choice.format, slides: choice.slides });
      const name = `pitside_export_${toInputDate(new Date())}.zip`;
      zipFile = new File([zip], name, { type: 'application/zip' });
      const voiceCount = list.filter((e) => e.audio).length;
      let imageCount = 0;
      for (const e of list) imageCount += await pageCount(e, settings, choice.format);
      const photoCount = choice.includePhotos ? list.reduce((n, e) => n + photosOf(e).length, 0) : 0;
      $('.result-text').textContent = `${name} · ${imageCount} slide ${imageCount === 1 ? 'image' : 'images'}`
        + `${photoCount ? ` · ${photoCount} ${photoCount === 1 ? 'photo' : 'photos'}` : ''}`
        + `${voiceCount ? ` · ${voiceCount} voice ${voiceCount === 1 ? 'note' : 'notes'}` : ''}`
        + `${choice.slides ? ' · slides.pptx' : ''} · ${formatBytes(zip.size)}`;
      result.hidden = false;
      const shareable = canShareFile(zipFile);
      $('[data-act="share-zip"]').hidden = !shareable;
      if (!shareable) {
        // This phone can't share a ZIP: download it straight away.
        downloadBlob(zipFile, zipFile.name);
        $('[data-act="download-zip"]').textContent = 'Download again';
        toast('ZIP downloaded');
      } else {
        $('[data-act="download-zip"]').textContent = 'Download ZIP';
        $('[data-act="share-zip"]').focus();
      }
    } catch (err) {
      console.error('Export failed', err);
      errorEl.textContent = "Couldn't make the export. Try fewer entries or free up space on your phone.";
      errorEl.hidden = false;
    } finally {
      working = false;
      exportBtn.disabled = false;
      exportBtn.textContent = 'Export';
    }
  });

  $('[data-act="share-zip"]').addEventListener('click', async () => {
    if (!zipFile) return;
    const r = await shareOrDownload(zipFile, 'PitSide export');
    if (r === 'downloaded') toast('ZIP downloaded');
    if (r === 'retry') toast('Tap Share ZIP again.');
  });
  $('[data-act="download-zip"]').addEventListener('click', () => {
    if (zipFile) downloadBlob(zipFile, zipFile.name);
  });

  update();

  return {
    unmount() {
      clearTimeout(previewTimer);
      previewRun += 1;      // stop any previews still being made
      urls.revokeAll();
    },
  };
}
