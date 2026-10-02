// PitSide start-up: load settings, connect screens to addresses, start the
// service worker (offline support) and show the offline note.

import { loadSettings, getSettings } from './settings.js';
import { addRoute, startRouter } from './router.js';
import { renderWelcome } from './screens/welcome.js';
import { renderHome } from './screens/home.js';
import { renderCapture } from './screens/capture.js';
import { renderSaved } from './screens/saved.js';
import { renderDetail } from './screens/detail.js';
import { renderExport } from './screens/export.js';
import { renderSettings } from './screens/settings.js';

// Screen addresses. (.+) parts are passed to the screen, e.g. the entry id.
addRoute(/^#\/welcome$/, renderWelcome);
addRoute(/^#\/home$/, renderHome);
addRoute(/^#\/new$/, (el) => renderCapture(el, null));
addRoute(/^#\/edit\/(.+)$/, renderCapture);
addRoute(/^#\/saved\/(.+)$/, renderSaved);
addRoute(/^#\/entry\/(.+)$/, renderDetail);
addRoute(/^#\/export$/, renderExport);
addRoute(/^#\/settings$/, renderSettings);

// First launch: no name yet -> show the "What's your name?" screen.
function redirect(hash) {
  const hasName = Boolean(getSettings().author);
  if (!hasName && hash !== '#/welcome') return '#/welcome';
  if (hasName && hash === '#/welcome') return '#/home';
  return null;
}

// "Offline, saving to this phone" note.
function updateOfflineNote() {
  document.getElementById('offline-note').hidden = navigator.onLine;
}

async function start() {
  updateOfflineNote();
  window.addEventListener('online', updateOfflineNote);
  window.addEventListener('offline', updateOfflineNote);

  await loadSettings();
  await startRouter(document.getElementById('app'), redirect);

  // Register the service worker that caches the app for offline use.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker failed', err));
  }
}

start();
