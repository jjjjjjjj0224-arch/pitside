// PitSide start-up: load settings, connect screens to addresses, start the
// service worker (offline support), show the offline note, and keep the
// team in sync when there is internet.

import { loadSettings, getSettings } from './settings.js';
import { addRoute, startRouter } from './router.js';
import { loadTeam, getTeam } from './team.js';
import { syncSoon } from './sync.js';
import { toast } from './ui.js';
import { renderWelcome } from './screens/welcome.js';
import { renderHome } from './screens/home.js';
import { renderCapture } from './screens/capture.js';
import { renderSaved } from './screens/saved.js';
import { renderDetail } from './screens/detail.js';
import { renderExport } from './screens/export.js';
import { renderSettings } from './screens/settings.js';
import { renderTeam } from './screens/team.js';
import { renderTeamEntry } from './screens/teamEntry.js';

// Screen addresses. (.+) parts are passed to the screen, e.g. the entry id.
addRoute(/^#\/welcome$/, renderWelcome);
addRoute(/^#\/home$/, renderHome);
addRoute(/^#\/new$/, (el) => renderCapture(el, null));
addRoute(/^#\/edit\/(.+)$/, renderCapture);
addRoute(/^#\/saved\/(.+)$/, renderSaved);
addRoute(/^#\/entry\/(.+)$/, renderDetail);
addRoute(/^#\/export$/, renderExport);
addRoute(/^#\/settings$/, renderSettings);
addRoute(/^#\/team$/, (el) => renderTeam(el, null));
addRoute(/^#\/join\/([A-Za-z0-9]+)$/, renderTeam);       // invite link
addRoute(/^#\/team-entry\/(.+)$/, renderTeamEntry);

// First launch: no name yet -> show the "What's your name?" screen.
// (An invite link remembers its code, so joining continues after the name.)
function redirect(hash) {
  const hasName = Boolean(getSettings().author);
  if (!hasName && hash !== '#/welcome') {
    const invite = hash.match(/^#\/join\/([A-Za-z0-9]+)$/);
    if (invite) sessionStorage.setItem('pitside-join', invite[1]);
    return '#/welcome';
  }
  if (hasName && hash === '#/welcome') return '#/home';
  return null;
}

// "Offline, saving to this phone" note.
function updateOfflineNote() {
  document.getElementById('offline-note').hidden = navigator.onLine;
}

async function start() {
  updateOfflineNote();
  window.addEventListener('online', () => { updateOfflineNote(); syncSoon(); });
  window.addEventListener('offline', updateOfflineNote);

  await loadSettings();
  await loadTeam();
  await startRouter(document.getElementById('app'), redirect);

  // Team sync: now, and whenever the app comes back to the front.
  if (getTeam()) syncSoon(1500);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && getTeam()) syncSoon();
  });
  window.addEventListener('pitside-removed', () => toast('You are no longer in the team.'));

  // Register the service worker that caches the app for offline use.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker failed', err));
  }
}

start();
