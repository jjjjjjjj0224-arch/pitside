// Export screen: pick entry types and a date range, then make a ZIP with
// one PNG per entry, the voice notes, and entries.csv.

import { getAllEntries, getAllTeamEntries } from '../db.js';
import { getSettings } from '../settings.js';
import { getTeam } from '../team.js';
import { loadTeamFiles } from '../sync.js';
import { goBack } from '../router.js';
import { buildExportZip, canShareFile, downloadBlob, shareOrDownload } from '../exporter.js';
import { TYPES, TYPE_LABELS, esc, formatBytes, formatShortDate, toast } from '../ui.js';

// Keep the user's choices while the app is open.
const choice = {
  source: 'mine',    // 'mine' | 'team' (whole team, when in a team)
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
  const team = getTeam();
  const teamEntries = team ? await getAllTeamEntries() : [];
  if (!team) choice.source = 'mine';
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
      ${team ? `
      <fieldset class="field">
        <legend class="label">Entries from</legend>
        <div class="option-list">
          <label class="option"><input type="radio" name="source" value="mine"> <span>Just mine</span></label>
          <label class="option"><input type="radio" name="source" value="team"> <span>Whole team (${esc(team.teamName)})</span></label>
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

      <p class="match-count" aria-live="polite"></p>
      <p class="form-error" role="alert" hidden></p>

      <button type="button" class="btn btn-primary btn-block btn-lg" data-act="export">Export</button>
      <p class="hint">Makes a ZIP with one image per entry (ready for Google Slides), each voice note, and a spreadsheet file (entries.csv).</p>

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
    const source = choice.source === 'team' ? teamEntries : entries;
    return source.filter((e) => {
      if (!choice.types.has(e.type)) return false;
      const t = new Date(e.createdAt);
      return (!from || t >= from) && (!to || t <= to);
    });
  }

  function update() {
    el.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-pressed', String(choice.types.has(b.dataset.type))));
    el.querySelectorAll('input[name="range"]').forEach((r) => { r.checked = r.value === choice.range; });
    el.querySelectorAll('input[name="source"]').forEach((r) => { r.checked = r.value === choice.source; });
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

  // Team export: teammates' photos and voice notes are downloaded first
  // (kept on the phone afterwards). My own entries use the copies on this phone.
  async function withFiles(list) {
    if (choice.source !== 'team') return list;
    const mine = new Map(entries.map((e) => [e.id, e]));
    const ready = [];
    for (let i = 0; i < list.length; i++) {
      exportBtn.textContent = `Downloading… ${i + 1} of ${list.length}`;
      const rec = list[i];
      ready.push(mine.get(rec.id) || await loadTeamFiles(rec, ['photo', 'drawing', 'audio']));
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
      });
      const name = `pitside_export_${toInputDate(new Date())}.zip`;
      zipFile = new File([zip], name, { type: 'application/zip' });
      const voiceCount = list.filter((e) => e.audio).length;
      $('.result-text').textContent = `${name} · ${list.length} ${list.length === 1 ? 'image' : 'images'}`
        + `${voiceCount ? ` · ${voiceCount} voice ${voiceCount === 1 ? 'note' : 'notes'}` : ''} · ${formatBytes(zip.size)}`;
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
}
