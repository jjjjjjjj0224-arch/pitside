// A teammate's shared entry: photo + drawing, voice note, caption and details.
// Full files download the first time it's opened, then stay on the phone.
// The author and the team owner can remove it from the team.

import { getTeamEntry, getEntry, deleteTeamEntry } from '../db.js';
import { getSettings } from '../settings.js';
import { go, goBack } from '../router.js';
import { getTeam } from '../team.js';
import { table, files, friendlyError } from '../cloud.js';
import { loadTeamFiles } from '../sync.js';
import { renderEntryImage } from '../render.js';
import { baseName, audioFileName, shareOrDownload } from '../exporter.js';
import { STAGE_LABELS, esc, formatDateTime, typeBadge, confirmDialog, toast, UrlBag } from '../ui.js';

export async function renderTeamEntry(el, id) {
  // My own entry: show the normal (editable) detail screen instead.
  if (await getEntry(id)) {
    go(`#/entry/${encodeURIComponent(id)}`, { replace: true });
    return {};
  }
  let rec = await getTeamEntry(id);
  const team = getTeam();
  if (!rec || !team) {
    el.innerHTML = `
      <header class="topbar"><a class="btn btn-ghost" href="#/home">Home</a><h1>Team entry</h1><span class="topbar-spacer"></span></header>
      <main class="page"><p>This entry is no longer shared with your team.</p></main>`;
    return {};
  }

  const urls = new UrlBag();
  const settings = getSettings();
  const canRemove = rec.userId === team.userId || team.role === 'owner';
  let player = null;

  el.innerHTML = `
    <header class="topbar">
      <button type="button" class="btn btn-ghost" data-act="back">Back</button>
      <h1>Team entry</h1>
      <span class="topbar-spacer"></span>
    </header>
    <main class="page detail">
      ${rec.paths.photo ? `
        <div class="photo-frame detail-photo">
          <img class="layer" data-layer="photo" alt="Entry photo">
          <img class="layer" data-layer="drawing" alt="Drawing on the photo" hidden>
          <p class="photo-busy" hidden>Downloading photo…</p>
        </div>` : ''}

      <div class="detail-tags">
        ${typeBadge(rec.type, settings.export[rec.type].accent)}
        ${rec.stage ? `<span class="stage-tag">Stage: ${esc(STAGE_LABELS[rec.stage])}</span>` : ''}
        ${rec.matchNumber ? `<span class="stage-tag">Match ${esc(rec.matchNumber)}</span>` : ''}
      </div>

      ${rec.paths.audio ? `
        <div class="voice-saved detail-voice">
          <span class="voice-length">Voice note</span>
          <button type="button" class="btn btn-secondary" data-act="play">Play</button>
        </div>` : ''}

      ${rec.caption ? `<p class="detail-caption">${esc(rec.caption)}</p>` : '<p class="muted">No caption</p>'}

      <dl class="detail-meta">
        <div><dt>Author</dt><dd>${esc(rec.author)}</dd></div>
        <div><dt>Date</dt><dd>${esc(formatDateTime(rec.createdAt))}</dd></div>
        <div><dt>Team</dt><dd>${esc(team.teamName)}</dd></div>
      </dl>

      <p class="form-error" role="alert" hidden></p>
      <div class="button-row">
        <button type="button" class="btn btn-primary" data-act="share">Share</button>
        ${canRemove ? '<button type="button" class="btn btn-danger" data-act="remove">Remove from team</button>' : ''}
      </div>
    </main>`;

  const $ = (s) => el.querySelector(s);
  const showError = (msg) => { const b = $('.form-error'); b.textContent = msg; b.hidden = !msg; };

  // Photo: show the small thumbnail at once, then the full photo + drawing.
  const photoImg = $('[data-layer="photo"]');
  const drawingImg = $('[data-layer="drawing"]');
  if (photoImg) {
    if (rec.thumb) photoImg.src = urls.make(rec.thumb);
    const busy = $('.photo-busy');
    busy.hidden = Boolean(rec.photo);
    loadTeamFiles(rec, ['photo', 'drawing'])
      .then((r) => {
        rec = r;
        photoImg.src = urls.make(rec.photo);
        if (rec.drawing) { drawingImg.src = urls.make(rec.drawing); drawingImg.hidden = false; }
      })
      .catch((err) => {
        console.warn(err);
        showError(navigator.onLine ? friendlyError(err) : 'Connect to the internet to see the full photo.');
      })
      .finally(() => { busy.hidden = true; });
  }

  // Voice note (downloads on first Play).
  const playBtn = $('[data-act="play"]');
  function stopPlayback() {
    if (player) player.pause();
    player = null;
    if (playBtn) playBtn.textContent = 'Play';
  }
  if (playBtn) {
    playBtn.addEventListener('click', async () => {
      if (player) { stopPlayback(); return; }
      try {
        playBtn.textContent = 'Loading…';
        rec = await loadTeamFiles(rec, ['audio']);
        player = new Audio(urls.make(rec.audio));
        player.addEventListener('ended', stopPlayback);
        await player.play();
        playBtn.textContent = 'Stop';
      } catch (err) {
        console.warn(err);
        stopPlayback();
        toast(navigator.onLine ? 'Could not play this voice note.' : 'Connect to the internet to play this voice note.');
      }
    });
  }

  // Share the export image (same as for my own entries).
  $('[data-act="share"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    try {
      btn.disabled = true;
      rec = await loadTeamFiles(rec, ['photo', 'drawing']);
      const base = baseName(rec);
      const png = await renderEntryImage({ ...rec, audio: rec.paths.audio ? new Blob([]) : null },
        settings.export[rec.type], rec.paths.audio ? audioFileName({ audio: true, audioMime: rec.audioMime }, base) : null);
      const result = await shareOrDownload(new File([png], `${base}.png`, { type: 'image/png' }), 'PitSide entry');
      if (result === 'downloaded') toast('Image downloaded');
      if (result === 'retry') toast('Image ready. Tap Share again.');
    } catch (err) {
      console.warn(err);
      toast(navigator.onLine ? 'Could not make the image.' : 'Connect to the internet to download this entry first.');
    } finally {
      btn.disabled = false;
    }
  });

  const removeBtn = $('[data-act="remove"]');
  if (removeBtn) {
    removeBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Remove from team?',
        message: `${rec.userId === team.userId ? 'Your' : `${rec.author}'s`} entry will be deleted from the team for everyone.`,
        confirmText: 'Remove',
        danger: true,
      });
      if (!ok) return;
      try {
        await files.remove(Object.values(rec.paths));   // files first, so nothing is left behind
        await table.remove('entries', `id=eq.${rec.id}`);
        await deleteTeamEntry(rec.id);
        toast('Removed from team');
        goBack('#/home');
      } catch (err) {
        showError(friendlyError(err));
      }
    });
  }

  $('[data-act="back"]').addEventListener('click', () => goBack('#/home'));

  return {
    unmount() {
      stopPlayback();
      urls.revokeAll();
    },
  };
}
