// Home: New entry button, filter chips and the list of saved entries.

import { getAllEntries } from '../db.js';
import { getSettings } from '../settings.js';
import { TYPES, TYPE_LABELS, STAGE_LABELS, esc, formatDateTime, typeBadge, UrlBag } from '../ui.js';

// Remember the chosen filter while the app is open.
let filter = 'all';

export async function renderHome(el) {
  const urls = new UrlBag();
  const settings = getSettings();
  const entries = await getAllEntries();

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

  function draw() {
    el.querySelectorAll('[data-filter]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
    });
    const shown = filter === 'all' ? entries : entries.filter((e) => e.type === filter);

    urls.revokeAll();
    list.innerHTML = shown.map((e) => entryCard(e, settings, urls)).join('');

    if (entries.length === 0) {
      empty.textContent = 'No entries yet. Tap New entry after your next change.';
    } else {
      empty.textContent = `No ${TYPE_LABELS[filter]} entries yet.`;
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

  draw();
  return { unmount: () => urls.revokeAll() };
}

// One row in the list: thumbnail, type, first line of caption, date, mic marker.
function entryCard(entry, settings, urls) {
  const firstLine = (entry.caption || '').split('\n').find((l) => l.trim()) || '';
  const thumbBlob = entry.thumb || entry.photo;
  const thumb = thumbBlob
    ? `<img src="${urls.make(thumbBlob)}" alt="" loading="lazy" decoding="async">`
    : '<span class="thumb-none">No photo</span>';
  const accent = settings.export[entry.type].accent;
  return `
    <li>
      <a class="entry-card" href="#/entry/${encodeURIComponent(entry.id)}">
        <div class="thumb">${thumb}</div>
        <div class="entry-info">
          <div class="entry-tags">
            ${typeBadge(entry.type, accent)}
            ${entry.stage ? `<span class="stage-tag">${esc(STAGE_LABELS[entry.stage])}</span>` : ''}
            ${entry.matchNumber ? `<span class="stage-tag">Match ${esc(entry.matchNumber)}</span>` : ''}
          </div>
          <p class="caption-preview ${firstLine ? '' : 'muted'}">${firstLine ? esc(firstLine) : 'No caption'}</p>
          <p class="entry-meta">
            <span>${esc(formatDateTime(entry.createdAt))}</span>
            ${entry.audio ? '<span class="mic-marker"><svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>Voice</span>' : ''}
          </p>
        </div>
      </a>
    </li>`;
}
