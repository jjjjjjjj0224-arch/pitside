// Home: New entry button, team status, Mine/Team switch, filter chips and the list.

import { getAllEntries, getAllTeamEntries } from '../db.js';
import { getSettings } from '../settings.js';
import { isCloudConfigured } from '../cloud.js';
import { getTeam } from '../team.js';
import { getSyncStatus, syncSoon } from '../sync.js';
import { TYPES, TYPE_LABELS, STAGE_LABELS, esc, formatDateTime, typeBadge, UrlBag } from '../ui.js';

// Remember the chosen filter and view while the app is open.
let filter = 'all';
let view = 'mine';     // 'mine' or 'team'

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
      <a class="team-card" href="#/team" hidden></a>
      <div class="view-switch" role="group" aria-label="Whose entries" hidden>
        <button type="button" class="seg-btn" data-view="mine">Mine</button>
        <button type="button" class="seg-btn" data-view="team">Team</button>
      </div>
      <div class="chips" role="group" aria-label="Show entries">
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

  // Team status line, e.g. "Team: VEX 1234A · 2 waiting to upload".
  function drawTeamCard() {
    const team = getTeam();
    teamCard.hidden = !isCloudConfigured();
    viewSwitch.hidden = !team;
    if (!team) {
      view = 'mine';
      teamCard.innerHTML = '<span><strong>Team:</strong> not joined</span><span class="team-card-action">Join or create</span>';
      return;
    }
    const s = getSyncStatus();
    let status = 'Shared entries are up to date';
    if (s.state === 'syncing') status = 'Syncing…';
    else if (s.pending && (s.state === 'offline' || !navigator.onLine)) status = `${s.pending} waiting for internet`;
    else if (s.pending) status = `${s.pending} waiting to upload`;
    else if (s.state === 'error') status = 'Sync problem. Tap to see';
    teamCard.innerHTML = `<span><strong>Team:</strong> ${esc(team.teamName)}</span><span class="team-card-action">${esc(status)}</span>`;
  }

  async function load() {
    entries = await getAllEntries();
    teamEntries = getTeam() ? await getAllTeamEntries() : [];
  }

  function draw() {
    drawTeamCard();
    el.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === filter)));
    el.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));

    const source = view === 'team' ? teamEntries : entries;
    const shown = filter === 'all' ? source : source.filter((e) => e.type === filter);
    const localThumbs = new Map(entries.map((e) => [e.id, e.thumb]));

    urls.revokeAll();
    list.innerHTML = shown.map((e) => (view === 'team'
      ? entryCard(e, settings, urls, { team: true, thumb: e.thumb || localThumbs.get(e.id) })
      : entryCard(e, settings, urls, { team: false, thumb: e.thumb, inTeam: Boolean(getTeam()) }))).join('');

    if (view === 'team') {
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

  el.querySelector('.chips').addEventListener('click', (e) => {
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

  // Redraw when a sync finishes (new team entries, upload status).
  const onSync = async () => { await load(); draw(); };
  window.addEventListener('pitside-sync', onSync);
  window.addEventListener('pitside-team', onSync);

  await load();
  draw();
  if (getTeam()) syncSoon(300);

  return {
    unmount() {
      window.removeEventListener('pitside-sync', onSync);
      window.removeEventListener('pitside-team', onSync);
      urls.revokeAll();
    },
  };
}

// One row in the list: thumbnail, type, first line of caption, date, mic marker.
function entryCard(entry, settings, urls, { team, thumb, inTeam }) {
  const firstLine = (entry.caption || '').split('\n').find((l) => l.trim()) || '';
  const thumbBlob = thumb || (!team && entry.photo);
  const hasPhoto = team ? Boolean(entry.paths && entry.paths.photo) : Boolean(entry.photo);
  const thumbHtml = thumbBlob
    ? `<img src="${urls.make(thumbBlob)}" alt="" loading="lazy" decoding="async">`
    : `<span class="thumb-none">${hasPhoto ? 'Photo' : 'No photo'}</span>`;
  const accent = settings.export[entry.type].accent;
  const hasAudio = team ? Boolean(entry.paths && entry.paths.audio) : Boolean(entry.audio);
  const href = team ? `#/team-entry/${encodeURIComponent(entry.id)}` : `#/entry/${encodeURIComponent(entry.id)}`;

  let shareTag = '';
  if (!team && inTeam) {
    if (entry.shared === true && entry.sync === 'synced' && entry.remote) shareTag = '<span class="share-tag">Shared</span>';
    else if (entry.shared === true) shareTag = '<span class="share-tag pending">Waiting to upload</span>';
  }

  return `
    <li>
      <a class="entry-card" href="${href}">
        <div class="thumb">${thumbHtml}</div>
        <div class="entry-info">
          <div class="entry-tags">
            ${typeBadge(entry.type, accent)}
            ${entry.stage ? `<span class="stage-tag">${esc(STAGE_LABELS[entry.stage])}</span>` : ''}
            ${entry.matchNumber ? `<span class="stage-tag">Match ${esc(entry.matchNumber)}</span>` : ''}
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
