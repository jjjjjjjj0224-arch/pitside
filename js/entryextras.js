// Parts of the entry detail screens shared by my entries and teammates' entries:
// subsystem/match/test results/witness, and the comments list.

import { renderTestImage } from './render.js';
import { matchSummary, testSummary, testStats, witnessText } from './entrydata.js';
import { listComments, addComment, deleteComment } from './sync.js';
import { friendlyError } from './cloud.js';
import { esc, formatDateTime, confirmDialog, toast } from './ui.js';

// Match result, test results (chart filled in by mountExtras) and witness line.
export function extrasHtml(entry, { witnessNote = '' } = {}) {
  const match = matchSummary(entry.match);
  const test = testStats(entry.testData) ? testSummary(entry.testData) : '';
  const witness = witnessText(entry);
  return `
    ${match ? `<p class="detail-line"><strong>Match:</strong> ${esc(match)}</p>` : ''}
    ${test ? `
      <section class="test-result" aria-label="Test results">
        <p class="detail-line"><strong>Test:</strong> ${esc(test)}</p>
        <img class="test-chart" alt="Chart and table of the test results" hidden>
      </section>` : ''}
    <p class="detail-line witness-line">${witness ? `<strong>${esc(witness)}</strong>` : esc(witnessNote)}</p>`;
}

export function mountExtras(el, entry, urls) {
  const img = el.querySelector('.test-chart');
  if (!img || !testStats(entry.testData)) return;
  renderTestImage(entry.testData, 1200, 760)
    .then((png) => { img.src = urls.make(png); img.hidden = false; })
    .catch((err) => console.warn('Test chart failed', err));
}

// Comments under a shared entry. me: { userId }; isOwner: team owner (can delete any).
export function commentsHtml() {
  return `
    <section class="card comments" aria-labelledby="comments-title">
      <h2 class="section-title" id="comments-title">Comments</h2>
      <ul class="comment-list"></ul>
      <p class="muted comment-status">Loading…</p>
      <form class="comment-form">
        <label class="sr-only" for="comment-text">Write a comment</label>
        <textarea id="comment-text" class="input textarea" rows="2" maxlength="1000"
                  placeholder="Ask a question or add a note for the team"></textarea>
        <button type="submit" class="btn btn-primary btn-small">Post</button>
      </form>
      <p class="form-error comment-error" role="alert" hidden></p>
    </section>`;
}

export function mountComments(el, { entryId, me, isOwner }) {
  const box = el.querySelector('.comments');
  if (!box) return;
  const list = box.querySelector('.comment-list');
  const status = box.querySelector('.comment-status');
  const form = box.querySelector('.comment-form');
  const text = box.querySelector('textarea');
  const error = box.querySelector('.comment-error');
  const showError = (m) => { error.textContent = m; error.hidden = !m; };
  let comments = [];

  function draw() {
    list.innerHTML = comments.map((c) => `
      <li class="comment">
        <p class="comment-head"><strong>${esc(c.author)}</strong> <span class="muted">${esc(formatDateTime(c.created_at))}</span></p>
        <p class="comment-body">${esc(c.body)}</p>
        ${me && (c.user_id === me.userId || isOwner) ? `<button type="button" class="btn btn-ghost btn-small" data-delete-comment="${esc(c.id)}">Delete</button>` : ''}
      </li>`).join('');
    status.hidden = comments.length > 0;
    status.textContent = 'No comments yet.';
  }

  async function load() {
    if (!navigator.onLine) {
      status.textContent = 'Comments need the internet.';
      return;
    }
    try {
      comments = await listComments(entryId) || [];
      draw();
    } catch (err) {
      status.textContent = friendlyError(err);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = text.value.trim();
    if (!body) return;
    const btn = form.querySelector('button');
    btn.disabled = true;
    showError('');
    try {
      const c = await addComment(entryId, body);
      comments.push(c);
      text.value = '';
      draw();
    } catch (err) {
      showError(friendlyError(err));
    } finally {
      btn.disabled = false;
    }
  });

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-delete-comment]');
    if (!btn) return;
    const ok = await confirmDialog({ title: 'Delete this comment?', confirmText: 'Delete', danger: true });
    if (!ok) return;
    try {
      await deleteComment(btn.dataset.deleteComment);
      comments = comments.filter((c) => c.id !== btn.dataset.deleteComment);
      draw();
      toast('Comment deleted');
    } catch (err) {
      showError(friendlyError(err));
    }
  });

  load();
}
