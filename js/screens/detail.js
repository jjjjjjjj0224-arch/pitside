// Entry detail: photos (each with drawing and a Download button), voice note,
// full caption and info. Buttons: Edit, Share (slide images), Delete.

import { getEntry, deleteEntry } from '../db.js';
import { getSettings } from '../settings.js';
import { goBack } from '../router.js';
import { photosOf } from '../image.js';
import { galleryHtml, mountGallery } from '../gallery.js';
import { baseName, renderEntryImages, shareOrDownload } from '../exporter.js';
import { getTeams } from '../team.js';
import { queueRemoteDelete } from '../sync.js';
import { STAGE_LABELS, esc, formatDateTime, typeBadge, confirmDialog, toast, UrlBag } from '../ui.js';

// "Shared with VEX 1234A" / "Waiting to upload to VEX 1234A" / "Only on this phone"
function shareStatus(entry, teams) {
  const team = teams.find((t) => t.teamId === entry.shareTeam);
  if (!team && typeof entry.shareTeam === 'string') return 'Shared with a team of another Google account (sign in with it to see)';
  if (!team) return 'Only on this phone (not shared)';
  if (entry.sync === 'synced' && entry.remote && entry.remote.teamId === team.teamId) return `Shared with ${team.teamName}`;
  return `Waiting to upload to ${team.teamName} (uploads when online)`;
}

export async function renderDetail(el, id) {
  const entry = await getEntry(id);
  if (!entry) {
    el.innerHTML = `
      <header class="topbar"><a class="btn btn-ghost" href="#/home">Home</a><h1>Entry</h1><span class="topbar-spacer"></span></header>
      <main class="page"><p>This entry was deleted.</p></main>`;
    return {};
  }

  const urls = new UrlBag();
  const settings = getSettings();
  const accent = settings.export[entry.type].accent;
  const teams = getTeams();
  const edited = entry.updatedAt && entry.updatedAt.slice(0, 16) !== entry.createdAt.slice(0, 16);
  const photos = photosOf(entry);
  const base = baseName(entry);

  el.innerHTML = `
    <header class="topbar">
      <button type="button" class="btn btn-ghost" data-act="back">Back</button>
      <h1>Entry</h1>
      <span class="topbar-spacer"></span>
    </header>
    <main class="page detail">
      ${galleryHtml(photos.length)}

      <div class="detail-tags">
        ${typeBadge(entry.type, accent)}
        ${entry.stage ? `<span class="stage-tag">Stage: ${esc(STAGE_LABELS[entry.stage])}</span>` : ''}
        ${entry.matchNumber ? `<span class="stage-tag">Match ${esc(entry.matchNumber)}</span>` : ''}
      </div>

      ${entry.audio ? `
        <div class="voice-saved detail-voice">
          <span class="voice-length">Voice note</span>
          <button type="button" class="btn btn-secondary" data-act="play">Play</button>
        </div>` : ''}

      ${entry.caption ? `<p class="detail-caption">${esc(entry.caption)}</p>` : '<p class="muted">No caption</p>'}

      <dl class="detail-meta">
        <div><dt>Author</dt><dd>${esc(entry.author)}</dd></div>
        <div><dt>Date</dt><dd>${esc(formatDateTime(entry.createdAt))}</dd></div>
        ${edited ? `<div><dt>Edited</dt><dd>${esc(formatDateTime(entry.updatedAt))}</dd></div>` : ''}
        ${teams.length ? `<div><dt>Team</dt><dd>${esc(shareStatus(entry, teams))}</dd></div>` : ''}
      </dl>

      <div class="button-row three">
        <a class="btn btn-secondary" href="#/edit/${encodeURIComponent(entry.id)}">Edit</a>
        <button type="button" class="btn btn-primary" data-act="share">Share</button>
        <button type="button" class="btn btn-danger" data-act="delete">Delete</button>
      </div>
    </main>`;

  // Photos with Download buttons.
  mountGallery(el, { count: photos.length, loadPhotos: async () => photos, base, urls });

  // Make the slide images now (one per photo), so they're ready the moment
  // Share is tapped (the share sheet must open right after a tap).
  const imagesPromise = renderEntryImages(entry, settings, base);
  imagesPromise.catch((err) => console.error('Could not make share images', err));

  el.querySelector('[data-act="back"]').addEventListener('click', () => goBack('#/home'));

  el.querySelector('[data-act="share"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    let images;
    try {
      images = await imagesPromise;
    } catch {
      toast('Could not make the image.');
      return;
    }
    btn.disabled = true;
    const result = await shareOrDownload(images, 'PitSide entry');
    btn.disabled = false;
    if (result === 'downloaded') toast(images.length > 1 ? `${images.length} images downloaded` : 'Image downloaded');
    if (result === 'retry') toast('Image ready. Tap Share again.');
  });

  el.querySelector('[data-act="delete"]').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Delete this entry?',
      message: entry.remote
        ? 'It will be removed from this phone and from your team. This can\'t be undone.'
        : 'The photos, drawings, voice note and caption will be removed from this phone. This can\'t be undone.',
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await deleteEntry(entry.id);
    await queueRemoteDelete(entry);   // also remove the team copy (now, or when back online)
    toast('Entry deleted');
    goBack('#/home');
  });

  // Voice note playback.
  let player = null;
  const playBtn = el.querySelector('[data-act="play"]');
  function stopPlayback() {
    if (player) player.pause();
    player = null;
    if (playBtn) playBtn.textContent = 'Play';
  }
  if (playBtn) {
    const audioUrl = urls.make(entry.audio);
    const lengthLabel = el.querySelector('.voice-length');
    // Show the length if the browser knows it.
    const probe = new Audio();
    probe.preload = 'metadata';
    probe.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(probe.duration)) {
        const s = Math.round(probe.duration);
        lengthLabel.textContent = `Voice note ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      }
    });
    probe.src = audioUrl;

    playBtn.addEventListener('click', () => {
      if (player) { stopPlayback(); return; }
      player = new Audio(audioUrl);
      player.addEventListener('ended', stopPlayback);
      player.play().catch((err) => {
        console.warn(err);
        stopPlayback();
        toast('Could not play this voice note.');
      });
      playBtn.textContent = 'Stop';
    });
  }

  return {
    unmount() {
      stopPlayback();
      urls.revokeAll();
    },
  };
}
