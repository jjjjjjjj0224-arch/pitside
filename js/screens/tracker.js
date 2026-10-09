// Design-process tracker (#/tracker): each subsystem against the design stages
// (Define ... Analysis), with how many entries cover each. Gaps stand out, and each
// row says what to do next. Tap a cell to see those entries. Can be saved as a slide.

import { getAllEntries, getAllTeamEntries } from '../db.js';
import { getTeams } from '../team.js';
import { go, goBack } from '../router.js';
import { setHomeFilters } from './home.js';
import { canvasToBlob } from '../image.js';
import { shareOrDownload } from '../exporter.js';
import { STAGES, STAGE_LABELS, esc, toast } from '../ui.js';

const NONE = '(no subsystem)';
let source = 'mine';    // 'mine' or a team id

// rows: [{ name, counts: { stage: n }, total, next, gaps: [stage] }]
export function trackerRows(entries) {
  const bySub = new Map();
  // Competition entries are match reports, not design steps.
  for (const e of entries.filter((x) => x.type !== 'competition')) {
    const name = (e.subsystem || '').trim() || NONE;
    const key = name.toLowerCase();
    if (!bySub.has(key)) bySub.set(key, { name, counts: {}, total: 0, noStage: 0 });
    const row = bySub.get(key);
    row.total += 1;
    if (e.stage) row.counts[e.stage] = (row.counts[e.stage] || 0) + 1;
    else row.noStage += 1;
  }
  return [...bySub.values()]
    .map((row) => {
      const done = STAGES.map((s) => Boolean(row.counts[s]));
      const last = done.lastIndexOf(true);
      return {
        ...row,
        gaps: last < 0 ? [] : STAGES.slice(0, last).filter((s) => !row.counts[s]),
        next: last < 0 ? STAGES[0] : STAGES[last + 1] || null,
      };
    })
    .filter((row) => row.total > row.noStage)      // only entries with a stage count
    .sort((a, b) => (a.name === NONE) - (b.name === NONE) || b.total - a.total || a.name.localeCompare(b.name));
}

export async function renderTracker(el) {
  const teams = getTeams();
  if (source !== 'mine' && !teams.some((t) => t.teamId === source)) source = 'mine';
  const mine = await getAllEntries();
  const teamEntries = teams.length ? await getAllTeamEntries() : [];

  el.innerHTML = `
    <header class="topbar">
      <button type="button" class="btn btn-ghost" data-act="back">Back</button>
      <h1>Tracker</h1>
      <span class="topbar-spacer"></span>
    </header>
    <main class="page tracker">
      <p class="hint">Each subsystem against the design process. Judges look for full cycles:
        empty boxes before the last step you did are <strong>gaps</strong>.</p>
      ${teams.length ? `
      <div class="chips" role="group" aria-label="Whose entries">
        <button type="button" class="chip" data-source="mine">Mine</button>
        ${teams.map((t) => `<button type="button" class="chip" data-source="${esc(t.teamId)}">${esc(t.teamName)}</button>`).join('')}
      </div>` : ''}
      <div class="tracker-body"></div>
      <button type="button" class="btn btn-secondary btn-block" data-act="slide">Save as a slide image</button>
    </main>`;

  const $ = (s) => el.querySelector(s);
  const entriesNow = () => (source === 'mine' ? mine : teamEntries.filter((e) => e.teamId === source));

  function draw() {
    el.querySelectorAll('[data-source]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.source === source)));
    const list = entriesNow();
    const rows = trackerRows(list);
    if (!rows.length) {
      $('.tracker-body').innerHTML = '<p class="empty-state">No entries yet. Give entries a subsystem and a design stage, and they show up here.</p>';
      $('[data-act="slide"]').hidden = true;
      return;
    }
    $('[data-act="slide"]').hidden = false;
    const noStage = list.filter((e) => !e.stage && e.type !== 'competition').length;
    $('.tracker-body').innerHTML = `
      <div class="table-scroll">
        <table class="tracker-table">
          <thead><tr><th scope="col">Subsystem</th>${STAGES.map((s) => `<th scope="col">${esc(STAGE_LABELS[s])}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <th scope="row">${esc(r.name)}</th>
                ${STAGES.map((s) => {
                  const n = r.counts[s] || 0;
                  const state = n ? 'done' : r.gaps.includes(s) ? 'gap' : r.next === s ? 'next' : 'empty';
                  return `<td><button type="button" class="cell ${state}" data-sub="${esc(r.name)}" data-stage="${s}"
                    aria-label="${esc(r.name)}, ${esc(STAGE_LABELS[s])}: ${n} ${n === 1 ? 'entry' : 'entries'}${state === 'gap' ? ', gap' : state === 'next' ? ', next step' : ''}">${n || (state === 'gap' ? '!' : state === 'next' ? '→' : '')}</button></td>`;
                }).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="tracker-legend"><span class="cell done">2</span> entries <span class="cell gap">!</span> gap <span class="cell next">→</span> next step</p>
      <ul class="tracker-next">
        ${rows.filter((r) => r.name !== NONE).map((r) => `
          <li><strong>${esc(r.name)}:</strong>
            ${r.next ? `next step <em>${esc(STAGE_LABELS[r.next])}</em>` : 'all steps done'}${r.gaps.length ? `; missing ${r.gaps.map((s) => esc(STAGE_LABELS[s])).join(', ')}` : ''}</li>`).join('')}
      </ul>
      ${noStage ? `<p class="hint">${noStage} ${noStage === 1 ? 'entry has' : 'entries have'} no design stage, so ${noStage === 1 ? 'it isn\'t' : 'they aren\'t'} counted above. Edit ${noStage === 1 ? 'it' : 'them'} to add one.</p>` : ''}`;
  }

  el.addEventListener('click', (e) => {
    const src = e.target.closest('[data-source]');
    if (src) { source = src.dataset.source; draw(); return; }
    const cell = e.target.closest('.cell[data-stage]');
    if (cell) {
      // Home, filtered to this subsystem and stage.
      setHomeFilters({
        subsystem: cell.dataset.sub === NONE ? '' : cell.dataset.sub,
        stage: cell.dataset.stage,
        view: source === 'mine' ? 'mine' : 'team',
        team: source === 'mine' ? null : source,
      });
      go('#/home');
    }
  });

  $('[data-act="slide"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const png = await trackerSlide(trackerRows(entriesNow()));
      const file = new File([png], 'design_process_tracker.png', { type: 'image/png' });
      const r = await shareOrDownload(file, 'Design process tracker', { preferDownload: true });
      if (r === 'retry') toast('Ready. Tap again to save.');
    } finally {
      btn.disabled = false;
    }
  });
  $('[data-act="back"]').addEventListener('click', () => goBack('#/home'));
  draw();
  return {};
}

// The tracker as a 1920x1080 slide for the notebook.
async function trackerSlide(rows) {
  const W = 1920;
  const H = 1080;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#111827';
  ctx.font = `700 52px ${FONT}`;
  ctx.fillText('Design process tracker', 64, 80);
  ctx.fillStyle = '#4B5563';
  ctx.font = `400 28px ${FONT}`;
  ctx.fillText(`${new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} · entries per subsystem and design stage`, 64, 132);

  const shown = rows.slice(0, 12);
  const top = 190;
  const nameW = 330;
  const colW = (W - 128 - nameW) / STAGES.length;
  const rowH = Math.min(64, (H - top - 80) / (shown.length + 1));
  ctx.font = `700 26px ${FONT}`;
  ctx.fillStyle = '#111827';
  STAGES.forEach((s, i) => {
    ctx.textAlign = 'center';
    ctx.fillText(STAGE_LABELS[s], 64 + nameW + colW * i + colW / 2, top + rowH / 2);
  });
  shown.forEach((r, ri) => {
    const y = top + rowH * (ri + 1);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#111827';
    ctx.font = `600 28px ${FONT}`;
    ctx.fillText(r.name, 64, y + rowH / 2);
    STAGES.forEach((s, i) => {
      const n = r.counts[s] || 0;
      const x = 64 + nameW + colW * i + 6;
      const state = n ? 'done' : r.gaps.includes(s) ? 'gap' : r.next === s ? 'next' : 'empty';
      ctx.fillStyle = { done: '#15803D', gap: '#FEE2E2', next: '#DBEAFE', empty: '#F3F4F6' }[state];
      ctx.fillRect(x, y + 6, colW - 12, rowH - 12);
      ctx.fillStyle = { done: '#FFFFFF', gap: '#B91C1C', next: '#1D4ED8', empty: '#9CA3AF' }[state];
      ctx.textAlign = 'center';
      ctx.font = `700 28px ${FONT}`;
      ctx.fillText(n ? String(n) : state === 'gap' ? 'gap' : state === 'next' ? 'next' : '', x + (colW - 12) / 2, y + rowH / 2);
    });
  });
  return canvasToBlob(c, 'image/png');
}
