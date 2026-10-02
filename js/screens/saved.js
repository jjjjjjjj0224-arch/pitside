// "Saved" confirmation after a new entry: thumbnail, type, author, date/time.
// New entry -> straight back to an empty capture screen. Done -> Home.

import { getEntry } from '../db.js';
import { getSettings } from '../settings.js';
import { go, goBack } from '../router.js';
import { esc, formatDateTime, typeBadge, UrlBag } from '../ui.js';

export async function renderSaved(el, id) {
  const entry = await getEntry(id);
  if (!entry) {
    el.innerHTML = '<main class="page"><h1>Saved</h1><a class="btn btn-primary btn-block" href="#/home">Done</a></main>';
    return {};
  }
  const urls = new UrlBag();
  const accent = getSettings().export[entry.type].accent;
  const thumb = entry.thumb
    ? `<img class="saved-thumb" src="${urls.make(entry.thumb)}" alt="Saved photo">`
    : '<div class="saved-thumb thumb-none">No photo</div>';

  el.innerHTML = `
    <main class="page saved">
      <div class="saved-check" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="44" height="44"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
      </div>
      <h1>Saved</h1>
      <div class="saved-card">
        ${thumb}
        <div class="saved-info">
          ${typeBadge(entry.type, accent)}
          <p><strong>${esc(entry.author)}</strong></p>
          <p class="muted">${esc(formatDateTime(entry.createdAt))}</p>
        </div>
      </div>
      <div class="button-row">
        <button type="button" class="btn btn-primary btn-lg" data-act="new">New entry</button>
        <button type="button" class="btn btn-secondary btn-lg" data-act="done">Done</button>
      </div>
    </main>`;

  el.querySelector('[data-act="new"]').addEventListener('click', () => go('#/new', { replace: true }));
  // The capture screen was replaced by this one, so "back" is Home.
  el.querySelector('[data-act="done"]').addEventListener('click', () => goBack('#/home'));

  return { unmount: () => urls.revokeAll() };
}
