// PitSide start-up: load settings, connect screens to addresses, start the
// service worker (offline support), show the offline note, and keep the
// team in sync when there is internet.

import { loadSettings, getSettings } from './settings.js';
import { addRoute, startRouter } from './router.js';
import { loadTeams, getTeams, refreshTeams } from './team.js';
import { isCloudConfigured, finishGoogleSignIn, getAccount } from './cloud.js';
import { syncSoon } from './sync.js';
import { toast } from './ui.js';
import { applyTheme, watchAutoTheme } from './themes.js';
import { renderWelcome } from './screens/welcome.js';
import { renderHome } from './screens/home.js';
import { renderCapture } from './screens/capture.js';
import { renderSaved } from './screens/saved.js';
import { renderDetail } from './screens/detail.js';
import { renderExport } from './screens/export.js';
import { renderSettings } from './screens/settings.js';
import { renderTeams, renderTeamDetail } from './screens/team.js';
import { renderTemplateEditor } from './screens/template.js';
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
addRoute(/^#\/team$/, (el) => renderTeams(el, null));
addRoute(/^#\/team\/(.+)$/, renderTeamDetail);
addRoute(/^#\/join\/([A-Za-z0-9]+)$/, renderTeams);      // invite link
addRoute(/^#\/team-entry\/(.+)$/, renderTeamEntry);
addRoute(/^#\/template\/(.+)$/, renderTemplateEditor);   // notebook template editor

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
  window.addEventListener('online', () => { updateOfflineNote(); if (getTeams().length) syncSoon(); });
  window.addEventListener('offline', updateOfflineNote);

  await loadSettings();
  // Color theme (index.html already applied the saved one; this keeps it in sync).
  applyTheme(getSettings().theme, getSettings().customTheme);
  watchAutoTheme(getSettings);
  await loadTeams();

  // Coming back from the Google sign-in page? Finish signing in, then
  // fetch my teams (so a new phone gets them back) and show where I was.
  const signIn = isCloudConfigured() ? await finishGoogleSignIn() : null;
  if (signIn && !signIn.error) await refreshTeams().catch((err) => console.warn(err));

  await startRouter(document.getElementById('app'), redirect);

  if (signIn) {
    const account = await getAccount();
    toast(signIn.error ? `Sign-in didn't work: ${signIn.error}` : `Signed in as ${account.name || account.email}`);
  }

  // Team sync: now, and whenever the app comes back to the front.
  const signedIn = async () => { const a = await getAccount(); return a && !a.anonymous; };
  if (await signedIn()) syncSoon(1500);
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && await signedIn() && getTeams().length) syncSoon();
  });
  window.addEventListener('pitside-removed', (e) => toast(`You are no longer in ${e.detail.teamName}.`));

  // Register the service worker that caches the app for offline use.
  if ('serviceWorker' in navigator) {
    // Was an older version already in charge? Then a change of service worker means an update.
    const hadOldVersion = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadOldVersion) showUpdateBar();
    });
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => {
        // Look for a new version whenever the app is opened or comes back to the front
        // (phones often just resume the app instead of starting it again).
        const check = () => { if (navigator.onLine) reg.update().catch(() => {}); };
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
        setInterval(check, 60 * 60 * 1000);
      })
      .catch((err) => console.warn('Service worker failed', err));
  }
}

// "New version ready" bar. Reloading is the user's choice, so nothing being typed is lost.
function showUpdateBar() {
  if (document.getElementById('update-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'update-bar';
  bar.className = 'update-bar';
  bar.setAttribute('role', 'status');
  bar.innerHTML = `
    <span>New version of PitSide ready.</span>
    <button type="button" class="btn btn-primary btn-small" data-act="reload">Reload</button>
    <button type="button" class="btn btn-ghost btn-small" data-act="later">Later</button>`;
  bar.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'reload') location.reload();
    else bar.remove();
  });
  document.body.appendChild(bar);
}

start();
