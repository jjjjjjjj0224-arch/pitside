// Small helpers and constants shared by every screen.

export const TYPES = ['build', 'competition', 'programming'];
export const TYPE_LABELS = { build: 'Build', competition: 'Competition', programming: 'Programming' };

export const STAGES = ['define', 'brainstorm', 'select', 'cad', 'build', 'test', 'analysis'];
export const STAGE_LABELS = {
  define: 'Define', brainstorm: 'Brainstorm', select: 'Select', cad: 'CAD',
  build: 'Build', test: 'Test', analysis: 'Analysis',
};

// The 4 accent colors a user can pick for each entry type's export label.
// All are dark enough to read on white.
export const ACCENTS = [
  { name: 'Orange', value: '#C2410C' },
  { name: 'Red', value: '#B91C1C' },
  { name: 'Blue', value: '#1D4ED8' },
  { name: 'Green', value: '#15803D' },
];

// Escape text before putting it into innerHTML, so a caption like "<b>" shows
// as text instead of becoming HTML.
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// "Wed, Oct 1, 2026 · 3:42 PM"
export function formatDateTime(iso) {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

// "Wed, Oct 1"
export function formatShortDate(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// 1536000 -> "1.5 MB"
export function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// 7.4 -> "0:07"
export function formatSeconds(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// A random id for each entry. randomUUID needs HTTPS, which the app needs anyway,
// but the fallback keeps older phones working.
export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Show a short message at the bottom of the screen for a few seconds.
let toastTimer;
export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

// A big, thumb-friendly "Are you sure?" box. Resolves true or false.
export function confirmDialog({ title, message = '', confirmText = 'OK', cancelText = 'Cancel', danger = false }) {
  if (typeof HTMLDialogElement === 'undefined') {
    return Promise.resolve(window.confirm(message ? `${title}\n\n${message}` : title));
  }
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    dialog.innerHTML = `
      <h2 class="dialog-title">${esc(title)}</h2>
      ${message ? `<p class="dialog-message">${esc(message)}</p>` : ''}
      <div class="dialog-buttons">
        <button type="button" class="btn btn-secondary" data-answer="no">${esc(cancelText)}</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-answer="yes">${esc(confirmText)}</button>
      </div>`;
    let finished = false;
    function finish(answer) {
      if (finished) return;
      finished = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(answer);
    }
    dialog.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-answer]');
      if (btn) finish(btn.dataset.answer === 'yes');
    });
    // Closing with Escape / Android back counts as "Cancel".
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });
    dialog.addEventListener('close', () => finish(false));
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.querySelector('[data-answer="no"]').focus();
  });
}

// Keeps track of object URLs (blob: links used to show photos and audio) so a
// screen can free them all when it closes.
export class UrlBag {
  constructor() { this.urls = []; }
  make(blob) {
    const url = URL.createObjectURL(blob);
    this.urls.push(url);
    return url;
  }
  revoke(url) {
    if (!this.urls.includes(url)) return;
    URL.revokeObjectURL(url);
    this.urls = this.urls.filter((u) => u !== url);
  }
  revokeAll() {
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.urls = [];
  }
}

// Type badge HTML, colored with the type's accent color from Settings.
export function typeBadge(type, accent) {
  return `<span class="type-badge" style="--accent:${esc(accent)}">${esc(TYPE_LABELS[type] || type)}</span>`;
}
