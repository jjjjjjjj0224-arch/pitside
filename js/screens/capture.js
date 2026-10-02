// Capture screen (new entry, or edit an existing one).
// Top to bottom: photo, entry type, voice note, caption, match number,
// design stage, and a Save button fixed to the bottom.

import { getEntry, putEntry, requestPersistentStorage } from '../db.js';
import { getSettings, saveSettings } from '../settings.js';
import { go, goBack, getPreviousHash, canGoBack } from '../router.js';
import { resizePhoto, makeThumbnail } from '../image.js';
import { openDrawMode } from '../draw.js';
import { createVoiceNote } from '../recorder.js';
import { getTeam } from '../team.js';
import { syncSoon } from '../sync.js';
import { TYPES, TYPE_LABELS, STAGES, STAGE_LABELS, esc, uuid, confirmDialog, toast, UrlBag } from '../ui.js';

const SAVE_FAILED = "Couldn't save. Free up space on your phone and try again.";

export async function renderCapture(el, id) {
  const settings = getSettings();
  const existing = id ? await getEntry(id) : null;
  if (id && !existing) {
    el.innerHTML = `<main class="page"><h1>Entry not found</h1><p>It may have been deleted.</p>
      <a class="btn btn-primary btn-block" href="#/home">Go to Home</a></main>`;
    return {};
  }

  const team = getTeam();

  // Everything the user has entered so far. Kept in memory until Save, so a
  // failed save never loses anything.
  const draft = existing
    ? {
      type: existing.type,
      stage: existing.stage || null,
      photo: existing.photo || null,
      drawing: existing.drawing || null,
      caption: existing.caption || '',
      audio: existing.audio || null,
      audioMime: existing.audioMime || null,
      matchNumber: existing.matchNumber || '',
      shared: existing.shared === true,
    }
    : {
      type: settings.defaultType,
      stage: null,
      photo: null,
      drawing: null,
      caption: '',
      audio: null,
      audioMime: null,
      matchNumber: '',
      shared: true,          // "Share with team" starts on (only used when in a team)
    };

  let dirty = false;          // true once anything is changed
  let saving = false;
  let photoBusy = null;       // Promise while a picked photo is being resized
  let drawSession = null;     // open draw mode, if any
  let lastSource = 'camera';  // which picker Retake should open
  const urls = new UrlBag();

  el.innerHTML = `
    <header class="topbar">
      <button type="button" class="btn btn-ghost" data-act="back">Back</button>
      <h1>${existing ? 'Edit entry' : 'New entry'}</h1>
      <span class="topbar-spacer"></span>
    </header>
    <main class="page capture">
      <section class="photo-frame" aria-label="Photo">
        <div class="photo-empty">
          <button type="button" class="btn btn-light btn-lg" data-act="camera">Take photo</button>
          <button type="button" class="btn btn-outline-light" data-act="gallery">Choose from gallery</button>
        </div>
        <div class="photo-filled" hidden>
          <img class="layer layer-photo" alt="Entry photo">
          <img class="layer layer-drawing" alt="" hidden>
          <div class="photo-actions">
            <button type="button" class="btn btn-overlay" data-act="draw">Draw</button>
            <button type="button" class="btn btn-overlay" data-act="retake">Retake</button>
          </div>
        </div>
        <p class="photo-busy" hidden>Loading photo…</p>
        <input type="file" accept="image/*" capture="environment" data-input="camera" hidden>
        <input type="file" accept="image/*" data-input="gallery" hidden>
      </section>

      <fieldset class="field">
        <legend class="label">Entry type</legend>
        <div class="segmented" role="group">
          ${TYPES.map((t) => `<button type="button" class="seg-btn" data-type="${t}">${TYPE_LABELS[t]}</button>`).join('')}
        </div>
      </fieldset>

      <section class="field" aria-labelledby="voice-label">
        <h2 class="label" id="voice-label">Voice note</h2>
        <div data-voice></div>
      </section>

      <div class="field">
        <label class="label" for="caption">Caption</label>
        <textarea id="caption" class="input textarea" rows="3" placeholder="What changed and why?"
                  autocapitalize="sentences">${esc(draft.caption)}</textarea>
      </div>

      <div class="field" data-match hidden>
        <label class="label" for="match">Match number</label>
        <input id="match" class="input" type="text" placeholder="e.g. Q12" maxlength="20"
               autocapitalize="characters" autocomplete="off" value="${esc(draft.matchNumber)}">
      </div>

      <div class="field stage-field">
        <button type="button" class="stage-toggle" data-act="stage-open" aria-expanded="false">
          <span>Add design stage</span><span class="muted">Optional</span>
        </button>
        <div class="stage-panel" hidden>
          <div class="stage-head">
            <span class="label" id="stage-label">Design stage</span>
            <button type="button" class="btn btn-ghost btn-small" data-act="stage-none">No stage</button>
          </div>
          <div class="chips" role="group" aria-labelledby="stage-label">
            ${STAGES.map((s) => `<button type="button" class="chip" data-stage="${s}">${STAGE_LABELS[s]}</button>`).join('')}
          </div>
        </div>
      </div>

      ${team ? `
      <label class="switch-row">
        <span>
          <span class="label">Share with team</span>
          <span class="hint switch-hint">${esc(team.teamName)} can see this entry</span>
        </span>
        <input type="checkbox" class="switch" data-share ${draft.shared ? 'checked' : ''}>
      </label>` : ''}
    </main>
    <div class="savebar">
      <div class="savebar-inner">
        <p class="save-error" role="alert" hidden></p>
        <button type="button" class="btn btn-primary btn-block btn-lg" data-act="save">Save</button>
      </div>
    </div>`;

  const $ = (sel) => el.querySelector(sel);
  const emptyBox = $('.photo-empty');
  const filledBox = $('.photo-filled');
  const photoImg = $('.layer-photo');
  const drawingImg = $('.layer-drawing');
  const busyNote = $('.photo-busy');
  const captionEl = $('#caption');
  const matchField = $('[data-match]');
  const matchEl = $('#match');
  const stageToggle = $('.stage-toggle');
  const stagePanel = $('.stage-panel');
  const saveError = $('.save-error');
  const saveBtn = $('[data-act="save"]');

  function markDirty() {
    dirty = true;
    saveError.hidden = true;
  }

  // ---- Photo ----

  function showPhoto() {
    urls.revokeAll();
    const hasPhoto = Boolean(draft.photo);
    emptyBox.hidden = hasPhoto;
    filledBox.hidden = !hasPhoto;
    if (hasPhoto) photoImg.src = urls.make(draft.photo);
    drawingImg.hidden = !draft.drawing;
    if (draft.drawing) drawingImg.src = urls.make(draft.drawing);
  }

  function pick(source) {
    lastSource = source;
    $(`[data-input="${source}"]`).click();
  }

  async function onPhotoPicked(input) {
    const file = input.files && input.files[0];
    input.value = '';               // so picking the same photo again still works
    if (!file) return;              // picker cancelled: nothing changes
    busyNote.hidden = false;
    photoBusy = (async () => {
      try {
        draft.photo = await resizePhoto(file);
        draft.drawing = null;       // an old drawing wouldn't match a new photo
        markDirty();
        showPhoto();
      } catch (err) {
        console.error(err);
        toast("Couldn't open that photo. Try a different one.");
      } finally {
        busyNote.hidden = true;
        photoBusy = null;
      }
    })();
    await photoBusy;
  }

  $('[data-input="camera"]').addEventListener('change', (e) => onPhotoPicked(e.target));
  $('[data-input="gallery"]').addEventListener('change', (e) => onPhotoPicked(e.target));
  $('[data-act="camera"]').addEventListener('click', () => pick('camera'));
  $('[data-act="gallery"]').addEventListener('click', () => pick('gallery'));

  $('[data-act="retake"]').addEventListener('click', async () => {
    if (draft.drawing) {
      const ok = await confirmDialog({
        title: 'Replace this photo?',
        message: 'Your drawing will be removed if you pick a new photo.',
        confirmText: 'Replace',
      });
      if (!ok) return;
    }
    pick(lastSource);
  });

  $('[data-act="draw"]').addEventListener('click', async () => {
    if (!draft.photo) return;
    drawSession = openDrawMode(draft.photo, draft.drawing);
    const result = await drawSession.done;
    drawSession = null;
    if (result !== draft.drawing) {
      draft.drawing = result;
      markDirty();
      showPhoto();
    }
    $('[data-act="draw"]').focus();
  });

  // ---- Entry type ----

  function showType() {
    el.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === draft.type)));
    matchField.hidden = draft.type !== 'competition';   // match number only for competition
  }
  $('.segmented').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-type]');
    if (!btn || btn.dataset.type === draft.type) return;
    draft.type = btn.dataset.type;
    markDirty();
    showType();
  });

  // ---- Voice note ----

  const voice = createVoiceNote($('[data-voice]'), draft, ({ audio, audioMime }) => {
    draft.audio = audio;
    draft.audioMime = audioMime;
    markDirty();
  });

  // ---- Caption and match number ----

  captionEl.addEventListener('input', () => { draft.caption = captionEl.value; markDirty(); });

  // ---- Share with team ----
  const shareSwitch = $('[data-share]');
  if (shareSwitch) {
    const hint = $('.switch-hint');
    const showShare = () => {
      hint.textContent = shareSwitch.checked ? `${team.teamName} can see this entry` : 'Only on this phone';
    };
    shareSwitch.addEventListener('change', () => { draft.shared = shareSwitch.checked; markDirty(); showShare(); });
    showShare();
  }
  matchEl.addEventListener('input', () => { draft.matchNumber = matchEl.value; markDirty(); });

  // When the phone keyboard opens, shrink the photo so the caption stays visible.
  const touchScreen = window.matchMedia('(pointer: coarse)').matches;
  let blurTimer;
  el.addEventListener('focusin', (e) => {
    if (!touchScreen || !e.target.matches('textarea, input[type="text"]')) return;
    clearTimeout(blurTimer);
    el.classList.add('kb-open');
    setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
  });
  el.addEventListener('focusout', () => {
    blurTimer = setTimeout(() => {
      if (!el.contains(document.activeElement) || !document.activeElement.matches('textarea, input[type="text"]')) {
        el.classList.remove('kb-open');
      }
    }, 100);
  });

  // ---- Design stage (optional, collapsed) ----

  function showStage(open) {
    stageToggle.hidden = open;
    stageToggle.setAttribute('aria-expanded', String(open));
    stagePanel.hidden = !open;
    el.querySelectorAll('[data-stage]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.stage === draft.stage)));
  }
  stageToggle.addEventListener('click', () => {
    // Remember the last used stage: opening the row picks it again.
    if (!draft.stage && settings.lastStage) {
      draft.stage = settings.lastStage;
      markDirty();
    }
    showStage(true);
    const selected = el.querySelector('[data-stage][aria-pressed="true"]') || el.querySelector('[data-stage]');
    selected.focus();
  });
  $('[data-act="stage-none"]').addEventListener('click', () => {
    if (draft.stage) markDirty();
    draft.stage = null;
    showStage(false);
    stageToggle.focus();
  });
  stagePanel.querySelector('.chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-stage]');
    if (!chip) return;
    draft.stage = chip.dataset.stage;
    markDirty();
    showStage(true);
  });

  // ---- Save ----

  function showSaveError(message) {
    saveError.textContent = message;
    saveError.hidden = false;
  }

  async function save() {
    if (saving) return;
    if (photoBusy) await photoBusy;
    if (voice.isRecording()) await voice.stop();   // keep a note that's still recording
    draft.caption = captionEl.value;
    draft.matchNumber = matchEl.value;

    if (!draft.photo && !draft.caption.trim()) {
      showSaveError('Add a photo or a caption to save.');
      return;
    }

    saving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    saveError.hidden = true;
    try {
      const now = new Date().toISOString();
      const entry = {
        id: existing ? existing.id : uuid(),
        type: draft.type,
        stage: draft.stage || null,
        photo: draft.photo,
        drawing: draft.photo ? draft.drawing : null,
        caption: draft.caption.trim(),
        audio: draft.audio,
        audioMime: draft.audio ? draft.audioMime : null,
        matchNumber: draft.type === 'competition' && draft.matchNumber.trim() ? draft.matchNumber.trim() : null,
        author: existing ? existing.author : settings.author,   // added automatically
        createdAt: existing ? existing.createdAt : now,          // added automatically
        updatedAt: now,
        thumb: await makeThumbnail(draft.photo, draft.drawing),  // small picture for the Home list
      };
      // Team sharing: saved on the phone first, uploaded later by sync.js.
      // (Read the latest upload info, in case a sync finished while editing.)
      const latest = existing ? await getEntry(existing.id) : null;
      entry.remote = latest ? latest.remote || null : null;
      if (team) entry.shared = draft.shared;
      else if (existing) entry.shared = existing.shared;
      entry.sync = entry.shared === true || entry.remote ? 'pending' : null;

      await putEntry(entry);
      dirty = false;
      requestPersistentStorage();   // ask the browser to keep our data (first save)
      if (entry.sync === 'pending') syncSoon();
      if (entry.stage && entry.stage !== settings.lastStage) {
        saveSettings({ lastStage: entry.stage }).catch(() => {});
      }

      if (existing) {
        toast('Changes saved');
        if (getPreviousHash() === `#/entry/${existing.id}` && canGoBack()) goBack();
        else go(`#/entry/${encodeURIComponent(existing.id)}`, { replace: true });
      } else {
        go(`#/saved/${encodeURIComponent(entry.id)}`, { replace: true });
      }
    } catch (err) {
      console.error('Save failed', err);
      showSaveError(SAVE_FAILED);   // everything the user entered stays on screen
    } finally {
      saving = false;
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  }
  saveBtn.addEventListener('click', save);

  $('[data-act="back"]').addEventListener('click', () => goBack('#/home'));

  // Warn before closing the tab/app with unsaved work (laptop browsers).
  function onBeforeUnload(e) {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  }
  window.addEventListener('beforeunload', onBeforeUnload);

  // ---- First draw ----

  showPhoto();
  showType();
  showStage(Boolean(draft.stage));

  return {
    // Called by the router before leaving this screen.
    async canLeave() {
      if (drawSession) {           // Back while drawing = Done, stay on this screen
        drawSession.finish();
        return false;
      }
      if (voice.isRecording()) await voice.stop();
      if (!dirty) return true;      // nothing to lose (also true right after Save)
      if (saving) return false;
      return confirmDialog({
        title: existing ? 'Discard your changes?' : 'Discard this entry?',
        message: existing ? 'Your changes to this entry will be lost.' : 'The photo, voice note and caption will be lost.',
        confirmText: 'Discard',
        cancelText: 'Keep editing',
        danger: true,
      });
    },
    unmount() {
      voice.destroy();
      if (drawSession) drawSession.finish();
      urls.revokeAll();
      window.removeEventListener('beforeunload', onBeforeUnload);
    },
  };
}
