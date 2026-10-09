// Season summary (#/season): every competition entry with a score, added up.
// Record (W-L-T), win rate, average scores, how often auton worked, per event and
// for the season, a chart of scores over time, and the match list. The summary
// can be saved as a slide for the notebook.

import { getAllEntries, getAllTeamEntries } from '../db.js';
import { getTeams } from '../team.js';
import { goBack } from '../router.js';
import { canvasToBlob } from '../image.js';
import { shareOrDownload } from '../exporter.js';
import { matchResult, AUTON_LABELS } from '../entrydata.js';
import { esc, formatShortDate, toast, UrlBag } from '../ui.js';

let source = 'mine';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

// Competition entries with a match, oldest first.
function matchesOf(entries) {
  return entries
    .filter((e) => e.type === 'competition' && (e.match || e.matchNumber))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

export function seasonStats(matches) {
  const scored = matches.filter((e) => matchResult(e.match));
  const count = (r) => scored.filter((e) => matchResult(e.match) === r).length;
  const avg = (key) => (scored.length ? Math.round((scored.reduce((s, e) => s + Number(e.match[key]), 0) / scored.length) * 10) / 10 : null);
  const autons = matches.filter((e) => e.match && AUTON_LABELS[e.match.auton]);
  const autonScore = autons.reduce((s, e) => s + ({ worked: 1, partly: 0.5, failed: 0 }[e.match.auton]), 0);
  const w = count('W');
  const l = count('L');
  const t = count('T');
  return {
    matches: matches.length,
    scored: scored.length,
    w, l, t,
    winRate: scored.length ? Math.round((w / scored.length) * 100) : null,
    avgOur: avg('our'),
    avgTheir: avg('their'),
    autonRate: autons.length ? Math.round((autonScore / autons.length) * 100) : null,
    best: scored.reduce((b, e) => (!b || Number(e.match.our) > Number(b.match.our) ? e : b), null),
  };
}

function byEvent(matches) {
  const map = new Map();
  for (const e of matches) {
    const name = (e.match && e.match.event) || 'No event name';
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(e);
  }
  return [...map.entries()].map(([name, list]) => ({ name, list, stats: seasonStats(list) }));
}

export async function renderSeason(el) {
  const teams = getTeams();
  if (source !== 'mine' && !teams.some((t) => t.teamId === source)) source = 'mine';
  const mine = await getAllEntries();
  const teamEntries = teams.length ? await getAllTeamEntries() : [];
  const urls = new UrlBag();

  el.innerHTML = `
    <header class="topbar">
      <button type="button" class="btn btn-ghost" data-act="back">Back</button>
      <h1>Season</h1>
      <span class="topbar-spacer"></span>
    </header>
    <main class="page season">
      ${teams.length ? `
      <div class="chips" role="group" aria-label="Whose entries">
        <button type="button" class="chip" data-source="mine">Mine</button>
        ${teams.map((t) => `<button type="button" class="chip" data-source="${esc(t.teamId)}">${esc(t.teamName)}</button>`).join('')}
      </div>` : ''}
      <div class="season-body"></div>
    </main>`;

  const $ = (s) => el.querySelector(s);
  const current = () => matchesOf(source === 'mine' ? mine : teamEntries.filter((e) => e.teamId === source));
  let slide = null;

  async function draw() {
    el.querySelectorAll('[data-source]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.source === source)));
    const matches = current();
    if (!matches.length) {
      $('.season-body').innerHTML = `<p class="empty-state">No matches yet. Make a Competition entry and fill in the match details
        (scores, partner, auton) after each match.</p>`;
      return;
    }
    const s = seasonStats(matches);
    const events = byEvent(matches);
    $('.season-body').innerHTML = `
      <div class="stat-tiles">
        <div class="stat"><span class="stat-value">${s.w}-${s.l}-${s.t}</span><span class="stat-label">Record (W-L-T)</span></div>
        <div class="stat"><span class="stat-value">${s.winRate ?? '–'}${s.winRate !== null ? '%' : ''}</span><span class="stat-label">Win rate</span></div>
        <div class="stat"><span class="stat-value">${s.avgOur ?? '–'}</span><span class="stat-label">Avg score (them ${s.avgTheir ?? '–'})</span></div>
        <div class="stat"><span class="stat-value">${s.autonRate ?? '–'}${s.autonRate !== null ? '%' : ''}</span><span class="stat-label">Auton worked</span></div>
      </div>
      <img class="season-slide" alt="Season summary slide: scores over time and results per event" hidden>
      <button type="button" class="btn btn-secondary btn-block" data-act="slide">Save summary as a slide image</button>
      ${events.map((ev) => `
        <section class="card">
          <h2 class="section-title">${esc(ev.name)}</h2>
          <p class="hint">${ev.stats.w}-${ev.stats.l}-${ev.stats.t}${ev.stats.winRate !== null ? ` · ${ev.stats.winRate}% won` : ''}${ev.stats.avgOur !== null ? ` · avg ${ev.stats.avgOur}` : ''}</p>
          <ul class="match-list">
            ${ev.list.map((e) => {
              const r = matchResult(e.match);
              return `<li><a class="match-row" href="${e.teamId ? `#/team-entry/${encodeURIComponent(e.id)}` : `#/entry/${encodeURIComponent(e.id)}`}">
                <span class="result ${r ? `result-${r}` : ''}">${r || '–'}</span>
                <span class="match-main">${esc(e.matchNumber ? `Match ${e.matchNumber}` : 'Match')}${r ? ` · ${Number(e.match.our)}–${Number(e.match.their)}` : ''}
                  ${e.match && e.match.partners ? `<span class="muted"> · with ${esc(e.match.partners)}</span>` : ''}</span>
                <span class="muted">${esc(formatShortDate(new Date(e.createdAt)))}${e.match && AUTON_LABELS[e.match.auton] ? ` · ${esc(AUTON_LABELS[e.match.auton])}` : ''}</span>
              </a></li>`;
            }).join('')}
          </ul>
        </section>`).join('')}`;
    slide = await seasonSlide(matches, s, events);
    const img = $('.season-slide');
    if (img) { img.src = urls.make(slide); img.hidden = false; }
  }

  el.addEventListener('click', async (e) => {
    const src = e.target.closest('[data-source]');
    if (src) { source = src.dataset.source; draw(); return; }
    const btn = e.target.closest('[data-act="slide"]');
    if (btn && slide) {
      const file = new File([slide], 'season_summary.png', { type: 'image/png' });
      const r = await shareOrDownload(file, 'Season summary', { preferDownload: true });
      if (r === 'retry') toast('Ready. Tap again to save.');
    }
  });
  $('[data-act="back"]').addEventListener('click', () => goBack('#/home'));
  await draw();
  return { unmount: () => urls.revokeAll() };
}

// 1920x1080 slide: big numbers, a chart of our score vs theirs, and each event's record.
export async function seasonSlide(matches, s, events) {
  const W = 1920;
  const H = 1080;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#B91C1C';
  ctx.font = `700 44px ${FONT}`;
  ctx.fillText('SEASON SUMMARY', 64, 56);
  ctx.fillRect(64, 112, 90, 8);
  ctx.fillStyle = '#4B5563';
  ctx.font = `400 28px ${FONT}`;
  const first = new Date(matches[0].createdAt);
  const last = new Date(matches[matches.length - 1].createdAt);
  ctx.fillText(`${matches.length} matches · ${formatShortDate(first)} – ${formatShortDate(last)}`, 64, 136);

  // Big numbers.
  const tiles = [
    [`${s.w}-${s.l}-${s.t}`, 'Record (W-L-T)'],
    [s.winRate !== null ? `${s.winRate}%` : '–', 'Win rate'],
    [s.avgOur ?? '–', `Avg score (them ${s.avgTheir ?? '–'})`],
    [s.autonRate !== null ? `${s.autonRate}%` : '–', 'Auton worked'],
  ];
  tiles.forEach(([value, label], i) => {
    const x = 64 + i * 450;
    ctx.fillStyle = '#F3F4F6';
    ctx.fillRect(x, 200, 420, 150);
    ctx.fillStyle = '#111827';
    ctx.font = `700 64px ${FONT}`;
    ctx.fillText(String(value), x + 24, 220);
    ctx.fillStyle = '#4B5563';
    ctx.font = `400 26px ${FONT}`;
    ctx.fillText(label, x + 24, 300);
  });

  // Chart: our score (blue) and theirs (grey) per match.
  const scored = matches.filter((e) => matchResult(e.match));
  const plot = { x: 140, y: 440, w: 1080, h: 500 };
  ctx.fillStyle = '#111827';
  ctx.font = `700 28px ${FONT}`;
  ctx.fillText('Scores, match by match', 64, 390 - 6);
  if (scored.length) {
    const max = Math.max(...scored.flatMap((e) => [Number(e.match.our), Number(e.match.their)]), 1) * 1.1;
    const yOf = (v) => plot.y + plot.h - (v / max) * plot.h;
    ctx.strokeStyle = '#E5E7EB';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#6B7280';
    ctx.font = `400 22px ${FONT}`;
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const v = Math.round((max * i) / 4);
      const y = yOf(v);
      ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke();
      ctx.fillText(String(v), plot.x - 12, y - 12);
    }
    ctx.textAlign = 'left';
    const step = scored.length > 1 ? plot.w / (scored.length - 1) : 0;
    const xOf = (i) => (scored.length > 1 ? plot.x + step * i : plot.x + plot.w / 2);
    const series = (key, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 5;
      ctx.beginPath();
      scored.forEach((e, i) => { const x = xOf(i); const y = yOf(Number(e.match[key])); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
      ctx.fillStyle = color;
      scored.forEach((e, i) => { ctx.beginPath(); ctx.arc(xOf(i), yOf(Number(e.match[key])), 8, 0, Math.PI * 2); ctx.fill(); });
    };
    series('their', '#9CA3AF');
    series('our', '#1D4ED8');
    ctx.font = `700 24px ${FONT}`;
    ctx.fillStyle = '#1D4ED8';
    ctx.fillText('● Us', plot.x, plot.y + plot.h + 34);
    ctx.fillStyle = '#6B7280';
    ctx.fillText('● Them', plot.x + 110, plot.y + plot.h + 34);
  }

  // Events.
  ctx.fillStyle = '#111827';
  ctx.font = `700 28px ${FONT}`;
  ctx.fillText('By event', 1300, 384);
  events.slice(0, 8).forEach((ev, i) => {
    const y = 430 + i * 72;
    ctx.fillStyle = '#111827';
    ctx.font = `600 26px ${FONT}`;
    ctx.fillText(ev.name.length > 28 ? `${ev.name.slice(0, 27)}…` : ev.name, 1300, y);
    ctx.fillStyle = '#4B5563';
    ctx.font = `400 24px ${FONT}`;
    ctx.fillText(`${ev.stats.w}-${ev.stats.l}-${ev.stats.t}${ev.stats.winRate !== null ? ` · ${ev.stats.winRate}% won` : ''}${ev.stats.avgOur !== null ? ` · avg ${ev.stats.avgOur}` : ''}`, 1300, y + 32);
  });
  return canvasToBlob(c, 'image/png');
}
