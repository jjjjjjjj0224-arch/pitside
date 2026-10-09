// A teammate's shared entry: photos (each with drawing and a Download button),
// voice note, caption and details. Full files download the first time it's
// opened, then stay on the phone. The author and the team owner can remove it.

import { getTeamEntry, getEntry, deleteTeamEntry } from '../db.js';
import { getSettings } from '../settings.js';
import { go, goBack } from '../router.js';
import { getTeamById } from '../team.js';
import { table, files, friendlyError, getAccount } from '../cloud.js';
import { loadTeamFiles, upgradeTeamRecord, teamEntryPaths, witnessEntry } from '../sync.js';
import { extrasHtml, mountExtras, commentsHtml, mountComments } from '../entryextras.js';
import { witnessText } from '../entrydata.js';
import { galleryHtml, mountGallery } from '../gallery.js';
import { baseName, renderEntryImages, shareOrDownload } from '../exporter.js';
import { STAGE_LABELS, esc, formatDateTime, typeBadge, confirmDialog, toast, UrlBag } from '../ui.js';

export async function renderTeamEntry(el, id) {
  // My own entry: show the normal (editable) detail screen instead.
  if (await getEntry(id)) {
    go(`#/entry/${encodeURIComponent(id)}`, { replace: true });
    return {};
  }
  const found = await getTeamEntry(id);
  const team = found ? getTeamById(found.teamId) : null;
  const account = await getAccount();
  if (!found || !team) {
    el.innerHTML = `
      <header class="topbar"><a class="btn btn-ghost" href="#/home">Home</a><h1>Team entry</h1><span class="topbar-spacer"></span></header>
      <main class="page"><p>This entry is no longer shared with your team.</p></main>`;
    return {};
  }

  let rec = upgradeTeamRecord(found);
  const urls = new UrlBag();
  const settings = getSettings();
  const isMine = Boolean(account) && rec.userId === account.userId;
  const canRemove = isMine || team.role === 'owner';
  const photoCount = rec.paths.photos.length;
  const base = baseName(rec);
  let player = null;

  el.innerHTML = `
    <header class="topbar">
      <button type="button" class="btn btn-ghost" data-act="back">Back</button>
      <h1>Team entry</h1>
      <span class="topbar-spacer"></span>
    </header>
    <main class="page detail">
      ${galleryHtml(photoCount, rec.paths.photos.map((p) => p.note))}

      <div class="detail-tags">
        ${typeBadge(rec.type, settings.export[rec.type].accent)}
        ${rec.stage ? `<span class="stage-tag">Stage: ${esc(STAGE_LABELS[rec.stage])}</span>` : ''}
        ${rec.subsystem ? `<span class="stage-tag">${esc(rec.subsystem)}</span>` : ''}
        ${rec.matchNumber ? `<span class="stage-tag">Match ${esc(rec.matchNumber)}</span>` : ''}
      </div>

      ${rec.paths.audio ? `
        <div class="voice-saved detail-voice">
          <span class="voice-length">Voice note</span>
          <button type="button" class="btn btn-secondary" data-act="play">Play</button>
        </div>` : ''}

      ${rec.caption ? `<p class="detail-caption">${esc(rec.caption)}</p>` : '<p class="muted">No caption</p>'}

      ${extrasHtml(rec, { witnessNote: 'Not witnessed yet.' })}
      ${isMine ? '' : '<button type="button" class="btn btn-secondary btn-block" data-act="witness" hidden></button>'}

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
      ${commentsHtml()}
    </main>`;

  const $ = (s) => el.querySelector(s);
  const showError = (msg) => { const b = $('.form-error'); b.textContent = msg; b.hidden = !msg; };

  // Photos: the small thumbnail shows at once, then the full photos download.
  const photosLoaded = loadTeamFiles(rec, { photos: true }).then((r) => { rec = r; return r.photos; });
  mountGallery(el, { count: photoCount, loadPhotos: () => photosLoaded, base, urls, thumb: rec.thumb });

  mountExtras(el, rec, urls);
  mountComments(el, { entryId: rec.id, me: account, isOwner: team.role === 'owner' });

  // Witness: sign a teammate's entry (or take your signature back).
  const witnessBtn = $('[data-act="witness"]');
  function showWitness() {
    if (!witnessBtn) return;
    const w = rec.witness;
    const mine = w && account && w.userId === account.userId;
    witnessBtn.hidden = Boolean(w) && !mine;
    witnessBtn.textContent = mine ? 'Take back my witness signature' : 'Witness this entry';
    const line = $('.witness-line');
    const text = witnessText(rec);
    line.innerHTML = text ? `<strong>${esc(text)}</strong>` : 'Not witnessed yet.';
  }
  if (witnessBtn) {
    witnessBtn.addEventListener('click', async () => {
      const signing = !rec.witness;
      if (signing) {
        const ok = await confirmDialog({
          title: 'Witness this entry?',
          message: `You confirm you saw ${rec.author}'s work as written here. Your name and today's date go on the entry. If they edit it later, they'll need a new witness.`,
          confirmText: 'Witness',
        });
        if (!ok) return;
      }
      witnessBtn.disabled = true;
      showError('');
      try {
        rec = await witnessEntry(rec, signing);
        toast(signing ? 'Witnessed' : 'Signature taken back');
        showWitness();
      } catch (err) {
        showError(friendlyError(err));
      } finally {
        witnessBtn.disabled = false;
      }
    });
    showWitness();
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
        rec = await loadTeamFiles(rec, { audio: true });
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

  // Share the slide images (one per photo), same as for my own entries.
  $('[data-act="share"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    try {
      btn.disabled = true;
      await photosLoaded;
      const forImages = { ...rec, audio: rec.paths.audio ? new Blob([]) : null };   // only the file name is needed
      const images = await renderEntryImages(forImages, settings, base);
      const result = await shareOrDownload(images, 'PitSide entry');
      if (result === 'downloaded') toast(images.length > 1 ? `${images.length} images downloaded` : 'Image downloaded');
      if (result === 'retry') toast('Images ready. Tap Share again.');
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
        message: `${isMine ? 'Your' : `${rec.author}'s`} entry will be deleted from ${team.teamName} for everyone.`,
        confirmText: 'Remove',
        danger: true,
      });
      if (!ok) return;
      try {
        await files.remove(teamEntryPaths(rec));   // files first, so nothing is left behind
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
