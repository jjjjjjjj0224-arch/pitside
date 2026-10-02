// A tiny router. Each screen has an address after the "#":
//   #/home  #/new  #/edit/ID  #/entry/ID  #/saved/ID  #/export  #/settings  #/welcome
//
// A screen is a function render(container, params) that draws the screen and
// may return { unmount(), canLeave() }.
//   unmount()  - clean up (stop the mic, free photo memory)
//   canLeave() - return false to stay (e.g. "Discard this entry?" -> Cancel)
//
// We use the browser history, so the phone's Back button/gesture works.
// Each history step stores its position (idx) so we know if we can go back.

const routes = [];
let rootEl = null;
let redirectFn = null;
let current = null;        // { hash, screen }
let previousHash = null;
let idx = 0;
let renderCount = 0;

export function addRoute(pattern, render) {
  routes.push({ pattern, render });
}

export function startRouter(root, redirect) {
  rootEl = root;
  redirectFn = redirect;
  idx = (history.state && history.state.idx) || 0;
  const hash = location.hash || '#/home';
  history.replaceState({ idx }, '', hash);
  window.addEventListener('popstate', onPopState);
  document.addEventListener('click', onLinkClick);
  return show(hash, false);
}

// Go to a screen. replace: true swaps the current history step instead of
// adding one (used after Save so Back doesn't return to a finished form).
export async function go(hash, { replace = false } = {}) {
  if (!(await mayLeave())) return false;
  if (replace) {
    history.replaceState({ idx }, '', hash);
  } else {
    idx += 1;
    history.pushState({ idx }, '', hash);
  }
  await show(hash, true);
  return true;
}

// Like the phone's Back button, but if there is nothing to go back to inside
// the app (e.g. opened from a link), go to the fallback screen instead.
export function goBack(fallback = '#/home') {
  if (idx > 0) history.back();
  else go(fallback, { replace: true });
}

export function getPreviousHash() {
  return previousHash;
}

export function canGoBack() {
  return idx > 0;
}

// A full-screen overlay (like the photo viewer) can register itself here,
// so the phone's Back button closes it instead of leaving the screen.
let overlayClose = null;
export function setOverlay(close) {
  overlayClose = close;
}

async function mayLeave() {
  if (overlayClose) {
    const close = overlayClose;
    overlayClose = null;
    close();
    return false;
  }
  if (current && current.screen && current.screen.canLeave) {
    return current.screen.canLeave();
  }
  return true;
}

// Back/forward button (or a typed address).
async function onPopState(event) {
  const targetIdx = event.state && typeof event.state.idx === 'number' ? event.state.idx : idx + 1;
  const targetHash = location.hash || '#/home';
  if (!event.state) history.replaceState({ idx: targetIdx }, '', targetHash);

  if (!(await mayLeave())) {
    // The user chose to stay: put the current screen back in the history.
    idx = targetIdx + 1;
    history.pushState({ idx }, '', current.hash);
    return;
  }
  idx = targetIdx;
  await show(targetHash, true);
}

// Make normal <a href="#/..."> links use the router.
function onLinkClick(event) {
  const a = event.target.closest('a[href^="#/"]');
  if (!a || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  go(a.getAttribute('href'));
}

async function show(hash, moveFocus) {
  const redirect = redirectFn && redirectFn(hash);
  if (redirect && redirect !== hash) {
    hash = redirect;
    history.replaceState({ idx }, '', hash);
  }

  // Close the old screen.
  if (current && current.screen && current.screen.unmount) current.screen.unmount();
  previousHash = current ? current.hash : null;
  current = { hash, screen: null };
  const myRender = ++renderCount;

  // Each screen gets a fresh container, so a slow screen can't draw over a newer one.
  const container = document.createElement('div');
  container.className = 'screen';
  rootEl.replaceChildren(container);
  window.scrollTo(0, 0);

  let params = [];
  let route = routes.find((r) => {
    const m = hash.match(r.pattern);
    if (m) params = m.slice(1).map(decodeURIComponent);
    return m;
  });
  if (!route) route = routes.find((r) => r.pattern.test('#/home'));

  let screen = {};
  try {
    screen = (await route.render(container, ...params)) || {};
  } catch (err) {
    console.error(err);
    container.innerHTML = `<main class="page"><h1 tabindex="-1">Something went wrong</h1>
      <p>${String(err && err.message ? err.message : err).replace(/</g, '&lt;')}</p>
      <a class="btn btn-primary btn-block" href="#/home">Go to Home</a></main>`;
  }

  if (myRender !== renderCount) {
    // Another screen opened while this one was loading.
    if (screen.unmount) screen.unmount();
    return;
  }
  current.screen = screen;

  // Move keyboard / screen-reader focus to the new screen's heading.
  if (moveFocus) {
    const h1 = container.querySelector('h1');
    if (h1) {
      h1.setAttribute('tabindex', '-1');
      h1.focus({ preventScroll: true });
    }
  }
}
