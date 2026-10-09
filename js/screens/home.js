// Home: New entry button, tools (tracker, season, meetings), team status, Mine/Team
// switch, search and filters, and the list.

import { getAllEntries, getAllTeamEntries } from '../db.js';
import { getSettings } from '../settings.js';
import { isCloudConfigured } from '../cloud.js';
import { getTeams } from '../team.js';
import { getSyncStatus, syncSoon } from '../sync.js';
import { photosOf } from '../image.js';
import { TYPES, TYPE_LABELS, STAGE_LABELS, esc, formatDateTime, typeBadge, UrlBag } from '../ui.js';

// Remember the chosen filter and view while the app is open.
let filter = 'all';
let view = 'mine';     // 'mine' or 'team'
let shownTeam = null;  // which team's entries the Team view shows
const query = { text: '', subsystem: '', stage: '', author: '', from: '', to: '' };

// Other screens can open Home with filters set (e.g. the tracker: "Intake, Test").
export function setHomeFilters(changes) {
  const { view: v, team, ...rest } = changes;
  Object.assign(query, { text: '', subsystem: '', stage: '', author: '', from: '', to: '' }, rest);
  if (v) view = v;
  if (team) shownTeam = team;
  filter = 'all';
}

export async function renderHome(el) {
  const urls = new UrlBag();
  const settings = getSettings();
  let entries = [];
  let teamEntries = [];

  el.innerHTML = `
    <header class="topbar">
      <h1 class="brand">PitSide</h1>
      <div class="topbar-actions">
        <a class="btn btn-ghost" href="#/export">Export</a>
        <a class="btn btn-ghost" href="#/settings">Settings</a>
      </div>
    </header>
    <main class="page">
      <a class="btn btn-primary btn-xl btn-block" href="#/new">New entry</a>
      <nav class="tool-row" aria-label="Tools">
        <a class="btn btn-secondary" href="#/tracker">Tracker</a>
        <a class="btn btn-secondary" href="#/season">Season</a>
        <a class="btn btn-secondary" href="#/meetings">Meetings</a>
      </nav>
      <a class="team-card" href="#/team" hidden></a>
      <a class="backup-nudge" href="#/settings" hidden></a>
      <div class="view-switch" role="group" aria-label="Whose entries" hidden>
        <button type="button" class="seg-btn" data-view="mine">Mine</button>
        <button type="button" class="seg-btn" data-view="team">Team</button>
      </div>
      <div class="chips team-picker" role="group" aria-label="Which team" hidden></div>
      <div class="search-row">
        <label class="sr-only" for="home-search">Search entries</label>
        <input id="home-search" class="input" type="search" placeholder="Search captions, notes, subsystems…" autocomplete="off">
        <button type="button" class="btn btn-secondary" data-act="filters" aria-expanded="false">Filters</button>
      </div>
      <div class="filter-panel" hidden></div>
      <div class="chips type-chips" role="group" aria-label="Show entries">
        ${['all', ...TYPES].map((t) => `
          <button type="button" class="chip" data-filter="${t}">${t === 'all' ? 'All' : TYPE_LABELS[t]}</button>`).join('')}
      </div>
      <p class="list-count" aria-live="polite"></p>
      <ul class="entry-list"></ul>
      <p class="empty-state" hidden></p>
    </main>`;

  const list = el.querySelector('.entry-list');
  const empty = el.querySelector('.empty-state');
  const count = el.querySelector('.list-count');
  const teamCard = el.querySelector('.team-card');
  const viewSwitch = el.querySelector('.view-switch');

  const teamPicker = el.querySelector('.team-picker');

  // Team status line, e.g. "Teams: VEX 1234A + 1 more · 2 waiting to upload".
  function drawTeamCard() {
    const teams = getTeams();
    teamCard.hidden = !isCloudConfigured();
    viewSwitch.hidden = !teams.length;
    if (!teams.length) {
      view = 'mine';
      teamCard.innerHTML = '<span><strong>Team:</strong> not joined</span><span class="team-card-action">Sign in · join or create</span>';
      return;
    }
    const s = getSyncStatus();
    let status = 'Shared entries are up to date';
    if (s.state === 'syncing') status = 'Syncing…';
    else if (s.pending && (s.state === 'offline' || !navigator.onLine)) status = `${s.pending} waiting for internet`;
    else if (s.pending) status = `${s.pending} waiting to upload`;
    else if (s.state === 'error') status = 'Sync problem. Tap to see';
    const names = teams.length === 1 ? teams[0].teamName : `${teams[0].teamName} + ${teams.length - 1} more`;
    teamCard.innerHTML = `<span><strong>${teams.length === 1 ? 'Team' : 'Teams'}:</strong> ${esc(names)}</span><span class="team-card-action">${esc(status)}</span>`;
  }

  // In the Team view with several teams: chips to pick which team to show.
  function drawTeamPicker() {
    const teams = getTeams();
    if (!teams.some((t) => t.teamId === shownTeam)) shownTeam = teams[0] ? teams[0].teamId : null;
    teamPicker.hidden = view !== 'team' || teams.length < 2;
    teamPicker.innerHTML = teams.map((t) => `
      <button type="button" class="chip" data-team="${esc(t.teamId)}" aria-pressed="${t.teamId === shownTeam}">${esc(t.teamName)}</button>`).join('');
  }

  async function load() {
    entries = await getAllEntries();
    teamEntries = getTeams().length ? await getAllTeamEntries() : [];
  }

  // "Back up your entries" after 2 weeks without a backup (only once there's something to lose).
  function drawBackupNudge() {
    const nudge = el.querySelector('.backup-nudge');
    const last = settings.lastBackup ? new Date(settings.lastBackup) : null;
    const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
    nudge.hidden = entries.length < 5 || (days !== null && days < 14);
    nudge.textContent = last
      ? `Last backup was ${days} days ago. Tap to back up your entries.`
      : 'Your entries are only on this phone. Tap to make a backup.';
  }

  function draw() {
    drawBackupNudge();
    drawTeamCard();
    drawTeamPicker();
    el.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === filter)));
    el.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));

    const source = view === 'team' ? teamEntries.filter((e) => e.teamId === shownTeam) : entries;
    drawFilterPanel(source);
    const shown = source.filter((e) => (filter === 'all' || e.type === filter) && matchesQuery(e));
    const localThumbs = new Map(entries.map((e) => [e.id, e.thumb]));

    urls.revokeAll();
    list.innerHTML = shown.map((e) => (view === 'team'
      ? entryCard(e, settings, urls, { team: true, thumb: e.thumb || localThumbs.get(e.id) })
      : entryCard(e, settings, urls, { team: false, thumb: e.thumb, teams: getTeams() }))).join('');

    if (source.length && filtersOn()) {
      empty.textContent = 'No entries match. Try other words, or clear the filters.';
    } else if (view === 'team') {
      empty.textContent = source.length === 0
        ? 'No team entries yet. Entries your teammates share show up here.'
        : `No ${TYPE_LABELS[filter]} entries from the team yet.`;
    } else {
      empty.textContent = source.length === 0
        ? 'No entries yet. Tap New entry after your next change.'
        : `No ${TYPE_LABELS[filter]} entries yet.`;
    }
    empty.hidden = shown.length > 0;
    count.textContent = shown.length ? `${shown.length} ${shown.length === 1 ? 'entry' : 'entries'}` : '';
  }

  // ---- Search and filters ----

  const searchEl = el.querySelector('#home-search');
  const filterBtn = el.querySelector('[data-act="filters"]');
  const filterPanel = el.querySelector('.filter-panel');
  searchEl.value = query.text;
  const filtersOn = () => Boolean(query.text.trim() || query.subsystem || query.stage || query.author || query.from || query.to);

  // Everything you can search for in an entry, lower case.
  function searchText(e) {
    const notes = (e.paths && e.paths.photos ? e.paths.photos : photosOf(e)).map((p) => p.note || '');
    const m = e.match || {};
    const t = e.testData || {};
    return [e.caption, e.subsystem, e.author, e.matchNumber, m.event, m.partners, t.metric, ...notes]
      .filter(Boolean).join(' ').toLowerCase();
  }
  function matchesQuery(e) {
    if (query.subsystem && (e.subsystem || '').toLowerCase() !== query.subsystem.toLowerCase()) return false;
    if (query.stage && e.stage !== query.stage) return false;
    if (query.author && e.author !== query.author) return false;
    if (query.from || query.to) {
      const d = new Date(e.createdAt);
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (query.from && day < query.from) return false;
      if (query.to && day > query.to) return false;
    }
    const words = query.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) {
      const hay = searchText(e);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  }

  // Choices come from the entries in view (subsystems and people that exist).
  function drawFilterPanel(source) {
    const subsystems = [...new Set(source.map((e) => e.subsystem).filter(Boolean))].sort();
    const people = [...new Set(source.map((e) => e.author).filter(Boolean))].sort();
    const select = (key, label, options) => `
      <label class="mini-field"><span class="label-small">${label}</span>
        <select class="input" data-q="${key}">
          <option value="">Any</option>
          ${options.map(([v, text]) => `<option value="${esc(v)}" ${query[key] === v ? 'selected' : ''}>${esc(text)}</option>`).join('')}
        </select></label>`;
    filterPanel.innerHTML = `
      <div class="two-col">
        ${select('subsystem', 'Subsystem', subsystems.map((s) => [s, s]))}
        ${select('stage', 'Stage', Object.entries(STAGE_LABELS))}
      </div>
      <div class="two-col">
        <label class="mini-field"><span class="label-small">From</span><input class="input" type="date" data-q="from" value="${esc(query.from)}"></label>
        <label class="mini-field"><span class="label-small">To</span><input class="input" type="date" data-q="to" value="${esc(query.to)}"></label>
      </div>
      ${people.length > 1 ? select('author', 'Person', people.map((p) => [p, p])) : ''}
      <button type="button" class="btn btn-ghost btn-small" data-act="clear-filters">Clear filters</button>`;
    filterBtn.textContent = query.subsystem || query.stage || query.author || query.from || query.to ? 'Filters •' : 'Filters';
  }

  let searchTimer;
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { query.text = searchEl.value; draw(); }, 150);
  });
  filterBtn.addEventListener('click', () => {
    filterPanel.hidden = !filterPanel.hidden;
    filterBtn.setAttribute('aria-expanded', String(!filterPanel.hidden));
  });
  filterPanel.addEventListener('change', (e) => {
    const key = e.target.dataset.q;
    if (!key) return;
    query[key] = e.target.value;
    draw();
  });
  filterPanel.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="clear-filters"]')) return;
    Object.assign(query, { text: '', subsystem: '', stage: '', author: '', from: '', to: '' });
    searchEl.value = '';
    draw();
  });
  // Opened with filters already set (from the tracker): show them.
  if (query.subsystem || query.stage || query.author || query.from || query.to) {
    filterPanel.hidden = false;
    filterBtn.setAttribute('aria-expanded', 'true');
  }

  el.querySelector('.type-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    filter = chip.dataset.filter;
    draw();
  });
  viewSwitch.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (!btn) return;
    view = btn.dataset.view;
    draw();
    if (view === 'team') syncSoon(0);   // get the latest team entries
  });
  teamPicker.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-team]');
    if (!chip) return;
    shownTeam = chip.dataset.team;
    draw();
  });

  // Redraw when a sync finishes (new team entries, upload status).
  const onSync = async () => { await load(); draw(); };
  window.addEventListener('pitside-sync', onSync);
  window.addEventListener('pitside-team', onSync);

  await load();
  draw();
  if (getTeams().length) syncSoon(300);

  return {
    unmount() {
      window.removeEventListener('pitside-sync', onSync);
      window.removeEventListener('pitside-team', onSync);
      urls.revokeAll();
    },
  };
}

// One row in the list: thumbnail, type, first line of caption, date, mic marker.
function entryCard(entry, settings, urls, { team, thumb, teams = [] }) {
  const firstLine = (entry.caption || '').split('\n').find((l) => l.trim()) || '';
  // (Team copies saved by an older version have paths.photo instead of paths.photos until the next sync.)
  const teamPhotoCount = (p) => (p.photos ? p.photos.length : Number(Boolean(p.photo)));
  const photoCount = team ? teamPhotoCount(entry.paths || {}) : photosOf(entry).length;
  const thumbBlob = thumb || (!team && photoCount ? photosOf(entry)[0].photo : null);
  const hasPhoto = photoCount > 0;
  const thumbHtml = thumbBlob
    ? `<img src="${urls.make(thumbBlob)}" alt="" loading="lazy" decoding="async">`
    : `<span class="thumb-none">${hasPhoto ? 'Photo' : 'No photo'}</span>`;
  const accent = settings.export[entry.type].accent;
  const hasAudio = team ? Boolean(entry.paths && entry.paths.audio) : Boolean(entry.audio);
  const href = team ? `#/team-entry/${encodeURIComponent(entry.id)}` : `#/entry/${encodeURIComponent(entry.id)}`;

  // My entries: which team it's shared with, and whether it's uploaded yet.
  let shareTag = '';
  const shareTeam = !team && teams.find((t) => t.teamId === entry.shareTeam);
  if (shareTeam) {
    const label = teams.length > 1 ? esc(shareTeam.teamName) : 'Shared';
    shareTag = entry.sync === 'synced' && entry.remote && entry.remote.teamId === entry.shareTeam
      ? `<span class="share-tag">${label}</span>`
      : '<span class="share-tag pending">Waiting to upload</span>';
  }

  return `
    <li>
      <a class="entry-card" href="${href}">
        <div class="thumb">${thumbHtml}</div>
        <div class="entry-info">
          <div class="entry-tags">
            ${typeBadge(entry.type, accent)}
            ${entry.stage ? `<span class="stage-tag">${esc(STAGE_LABELS[entry.stage])}</span>` : ''}
            ${entry.subsystem ? `<span class="stage-tag">${esc(entry.subsystem)}</span>` : ''}
            ${entry.witness ? '<span class="share-tag">Witnessed</span>' : ''}
            ${entry.matchNumber ? `<span class="stage-tag">Match ${esc(entry.matchNumber)}</span>` : ''}
            ${photoCount > 1 ? `<span class="stage-tag">${photoCount} photos</span>` : ''}
            ${shareTag}
          </div>
          <p class="caption-preview ${firstLine ? '' : 'muted'}">${firstLine ? esc(firstLine) : 'No caption'}</p>
          <p class="entry-meta">
            ${team ? `<span class="entry-author">${esc(entry.author)}</span>` : ''}
            <span>${esc(formatDateTime(entry.createdAt))}</span>
            ${hasAudio ? '<span class="mic-marker"><svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>Voice</span>' : ''}
          </p>
        </div>
      </a>
    </li>`;
}
