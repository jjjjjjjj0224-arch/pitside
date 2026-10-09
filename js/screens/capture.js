// Capture screen (new entry, or edit an existing one).
// Top to bottom: photos (up to 10, each with a note), entry type, subsystem, voice note,
// caption (with dictation), match details (competition), test results,
// design stage, and a Save button fixed to the bottom.

import { getEntry, putEntry, getAllEntries, requestPersistentStorage } from '../db.js';
import { getSettings, saveSettings } from '../settings.js';
import { go, goBack, getPreviousHash, canGoBack } from '../router.js';
import { resizePhoto, makeThumbnail, photosOf, MAX_PHOTOS } from '../image.js';
import { openDrawMode } from '../draw.js';
import { openViewer } from '../viewer.js';
import { createVoiceNote } from '../recorder.js';
import { getTeams } from '../team.js';
import { syncSoon } from '../sync.js';
import { TYPES, TYPE_LABELS, STAGES, STAGE_LABELS, SUBSYSTEMS, esc, uuid, confirmDialog, toast, UrlBag } from '../ui.js';
import { AUTON_LABELS, newTest, cleanTest, cleanMatch, testSummary } from '../entrydata.js';

const SAVE_FAILED = "Couldn't save. Free up space on your phone and try again.";

export async function renderCapture(el, id) {
  const settings = getSettings();
  const existing = id ? await getEntry(id) : null;
  if (id && !existing) {
    el.innerHTML = `<main class="page"><h1>Entry not found</h1><p>It may have been deleted.</p>
      <a class="btn btn-primary btn-block" href="#/home">Go to Home</a></main>`;
    return {};
  }

  // Teams this entry can be shared with. New entries start with the team used last.
  const teams = getTeams();
  const lastTeam = teams.some((t) => t.teamId === settings.lastShareTeam) ? settings.lastShareTeam : (teams[0] && teams[0].teamId);
  let shareTouched = false;

  // Everything the user has entered so far. Kept in memory until Save, so a
  // failed save never loses anything.
  const draft = existing
    ? {
      type: existing.type,
      stage: existing.stage || null,
      photos: photosOf(existing).map((p) => ({ photo: p.photo, drawing: p.drawing || null, note: p.note || '' })),
      caption: existing.caption || '',
      audio: existing.audio || null,
      audioMime: existing.audioMime || null,
      matchNumber: existing.matchNumber || '',
      subsystem: existing.subsystem || '',
      testData: existing.testData ? JSON.parse(JSON.stringify(existing.testData)) : null,
      match: { event: '', partners: '', our: '', their: '', auton: '', ...(existing.match || {}) },
      shareTeam: typeof existing.shareTeam === 'string' ? existing.shareTeam : null,
    }
    : {
      type: settings.defaultType,
      stage: null,
      photos: [],            // [{ photo: Blob, drawing: Blob | null, note: '' }]
      caption: '',
      audio: null,
      audioMime: null,
      matchNumber: '',
      subsystem: '',
      testData: null,        // see entrydata.js
      match: { event: settings.lastEvent || '', partners: '', our: '', their: '', auton: '' },
      shareTeam: lastTeam || null,   // team id, or null = only on this phone
    };

  // Subsystem buttons: the ones you've used before first, then common ones.
  const used = (await getAllEntries()).map((e) => e.subsystem).filter(Boolean);
  const subsystemChoices = [...new Set([...used, ...SUBSYSTEMS])].slice(0, 10);

  let dirty = false;          // true once anything is changed
  let saving = false;
  let photoBusy = null;       // Promise while a picked photo is being resized
  let drawSession = null;     // open draw mode, if any
  let lastSource = 'camera';  // which picker Retake should open
  let pickMode = 'add';       // 'add' a photo, or 'replace' the selected one (Retake)
  let current = 0;            // which photo is shown in the big frame
  const urls = new UrlBag();

  el.innerHTML = `
    <header class="topbar">
      <button type="button" class="btn btn-ghost" data-act="back">Back</button>
      <h1>${existing ? 'Edit entry' : 'New entry'}</h1>
      <span class="topbar-spacer"></span>
    </header>
    <main class="page capture">
      <section class="photo-section" aria-label="Photos">
        <div class="photo-frame">
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
              <button type="button" class="btn btn-overlay" data-act="remove-photo">Remove</button>
            </div>
          </div>
          <p class="photo-busy" hidden>Loading photo…</p>
          <input type="file" accept="image/*" capture="environment" data-input="camera" hidden>
          <input type="file" accept="image/*" multiple data-input="gallery" hidden>
        </div>
        <div class="photo-nav-row" hidden>
          <button type="button" class="btn btn-secondary" data-act="prev">‹ Prev</button>
          <button type="button" class="btn btn-secondary" data-act="fullscreen">Full screen</button>
          <button type="button" class="btn btn-secondary" data-act="next">Next ›</button>
        </div>
        <p class="photo-count" aria-live="polite" hidden></p>
        <div class="photo-note" hidden>
          <label class="label-small" for="photo-note">Note for this photo <span class="muted">(optional)</span></label>
          <input id="photo-note" class="input" type="text" maxlength="300" autocapitalize="sentences"
                 placeholder="What does this photo show?">
        </div>
        <div class="photo-strip" hidden>
          <div class="strip-list" role="group" aria-label="Photos in this entry"></div>
          <div class="strip-add">
            <button type="button" class="btn btn-secondary" data-act="add-camera">+ Add photo</button>
            <button type="button" class="btn btn-secondary" data-act="add-gallery">+ Add from gallery</button>
          </div>
          <p class="hint strip-full" hidden>That's the most photos for one entry (${MAX_PHOTOS}).</p>
        </div>
      </section>

      <fieldset class="field">
        <legend class="label">Entry type</legend>
        <div class="segmented" role="group">
          ${TYPES.map((t) => `<button type="button" class="seg-btn" data-type="${t}">${TYPE_LABELS[t]}</button>`).join('')}
        </div>
      </fieldset>

      <div class="field">
        <label class="label" for="subsystem">Subsystem <span class="muted">(optional)</span></label>
        <input id="subsystem" class="input" type="text" maxlength="40" autocomplete="off" autocapitalize="words"
               placeholder="Which part of the robot? e.g. Intake" value="${esc(draft.subsystem)}">
        <div class="chips subsystem-chips" role="group" aria-label="Pick a subsystem">
          ${subsystemChoices.map((s) => `<button type="button" class="chip" data-subsystem="${esc(s)}">${esc(s)}</button>`).join('')}
        </div>
      </div>

      <section class="field" aria-labelledby="voice-label">
        <h2 class="label" id="voice-label">Voice note</h2>
        <div data-voice></div>
      </section>

      <div class="field">
        <div class="label-row">
          <label class="label" for="caption">Caption</label>
          <button type="button" class="btn btn-secondary btn-small" data-act="dictate" hidden>Dictate</button>
        </div>
        <textarea id="caption" class="input textarea" rows="3" placeholder="What changed and why?"
                  autocapitalize="sentences">${esc(draft.caption)}</textarea>
        <p class="hint dictate-hint" hidden>Speak and the words appear here. Your phone's speech service does the listening
          (on Android that's Google, on iPhone Apple).</p>
      </div>

      <fieldset class="field match-fields" data-match hidden>
        <legend class="label">Match</legend>
        <div class="two-col">
          <label class="mini-field"><span class="label-small">Match number</span>
            <input id="match" class="input" type="text" placeholder="e.g. Q12" maxlength="20"
                   autocapitalize="characters" autocomplete="off" value="${esc(draft.matchNumber)}"></label>
          <label class="mini-field"><span class="label-small">Event</span>
            <input class="input" type="text" data-match-field="event" maxlength="80" placeholder="e.g. Regionals"
                   autocapitalize="words" value="${esc(draft.match.event)}"></label>
        </div>
        <label class="mini-field"><span class="label-small">Alliance partner(s)</span>
          <input class="input" type="text" data-match-field="partners" maxlength="80" placeholder="e.g. 1234A"
                 autocapitalize="characters" autocomplete="off" value="${esc(draft.match.partners)}"></label>
        <div class="two-col">
          <label class="mini-field"><span class="label-small">Our score</span>
            <input class="input" type="number" inputmode="numeric" min="0" max="999" data-match-field="our" value="${esc(draft.match.our)}"></label>
          <label class="mini-field"><span class="label-small">Their score</span>
            <input class="input" type="number" inputmode="numeric" min="0" max="999" data-match-field="their" value="${esc(draft.match.their)}"></label>
        </div>
        <div class="chips" role="group" aria-label="Autonomous">
          ${Object.entries(AUTON_LABELS).map(([k, label]) => `<button type="button" class="chip" data-auton="${k}">${esc(label)}</button>`).join('')}
        </div>
      </fieldset>

      <div class="field test-field">
        <button type="button" class="stage-toggle" data-act="test-open" aria-expanded="false">
          <span>Add test results</span><span class="muted">Optional</span>
        </button>
        <div class="test-panel" hidden></div>
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

      ${teams.length ? `
      <fieldset class="field share-field">
        <legend class="label">Share with</legend>
        <div class="option-list share-options">
          <label class="option"><input type="radio" name="share" value="" ${draft.shareTeam ? '' : 'checked'}> <span>Only on this phone</span></label>
          ${teams.map((t) => `
          <label class="option"><input type="radio" name="share" value="${esc(t.teamId)}" ${draft.shareTeam === t.teamId ? 'checked' : ''}> <span>${esc(t.teamName)}</span></label>`).join('')}
        </div>
      </fieldset>` : ''}
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
  const countLabel = $('.photo-count');
  const strip = $('.photo-strip');
  const stripList = $('.strip-list');
  const captionEl = $('#caption');
  const noteEl = $('#photo-note');
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

  // ---- Photos (up to MAX_PHOTOS, each with its own drawing) ----

  // Big frame shows the selected photo; the strip below shows all of them.
  function showPhotos() {
    urls.revokeAll();
    const list = draft.photos;
    current = Math.min(current, Math.max(0, list.length - 1));
    const has = list.length > 0;
    emptyBox.hidden = has;
    filledBox.hidden = !has;
    strip.hidden = !has;
    $('.photo-nav-row').hidden = !has;
    if (!has) { countLabel.hidden = true; $('.photo-note').hidden = true; return; }

    const p = list[current];
    photoImg.src = urls.make(p.photo);
    photoImg.alt = `Photo ${current + 1} of ${list.length}`;
    drawingImg.hidden = !p.drawing;
    if (p.drawing) drawingImg.src = urls.make(p.drawing);
    countLabel.hidden = list.length < 2;
    countLabel.textContent = `Photo ${current + 1} of ${list.length}`;
    // This photo's own note (printed next to it on export, instead of repeating the caption).
    $('.photo-note').hidden = false;
    noteEl.value = p.note || '';
    // Prev / Next under the photo (only when there's more than one photo).
    const prevBtn = $('[data-act="prev"]');
    const nextBtn = $('[data-act="next"]');
    prevBtn.style.visibility = nextBtn.style.visibility = list.length < 2 ? 'hidden' : '';
    prevBtn.disabled = current === 0;
    nextBtn.disabled = current === list.length - 1;

    stripList.innerHTML = list.map((item, i) => `
      <button type="button" class="strip-thumb" data-index="${i}" aria-pressed="${i === current}"
              aria-label="Photo ${i + 1}${item.drawing ? ', has a drawing' : ''}">
        <img src="${urls.make(item.photo)}" alt="">
        ${item.drawing ? `<img class="strip-drawing" src="${urls.make(item.drawing)}" alt="">` : ''}
        <span class="strip-num">${i + 1}</span>
      </button>`).join('');
    const full = list.length >= MAX_PHOTOS;
    $('.strip-add').hidden = full;
    $('.strip-full').hidden = !full;
  }

  // source: 'camera' or 'gallery'. mode: 'add' a new photo or 'replace' the selected one.
  function pick(source, mode) {
    lastSource = source;
    pickMode = mode;
    $(`[data-input="${source}"]`).click();
  }

  async function onPhotoPicked(input) {
    const files = [...(input.files || [])];
    input.value = '';               // so picking the same photo again still works
    if (!files.length) return;      // picker cancelled: nothing changes
    const mode = pickMode;
    const room = mode === 'replace' ? 1 : MAX_PHOTOS - draft.photos.length;
    const chosen = files.slice(0, Math.max(0, room));
    if (mode === 'add' && files.length > chosen.length) {
      toast(`An entry can have up to ${MAX_PHOTOS} photos. Added ${chosen.length}.`);
    }
    if (!chosen.length) return;

    busyNote.hidden = false;
    photoBusy = (async () => {
      try {
        for (let i = 0; i < chosen.length; i++) {
          busyNote.textContent = chosen.length > 1 ? `Loading photo ${i + 1} of ${chosen.length}…` : 'Loading photo…';
          const photo = await resizePhoto(chosen[i]);
          if (mode === 'replace' && draft.photos[current]) {
            draft.photos[current] = { photo, drawing: null, note: draft.photos[current].note || '' };   // an old drawing wouldn't match
          } else {
            draft.photos.push({ photo, drawing: null, note: '' });
            current = draft.photos.length - 1;
          }
          markDirty();
          showPhotos();
        }
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
  $('[data-act="camera"]').addEventListener('click', () => pick('camera', 'add'));
  $('[data-act="gallery"]').addEventListener('click', () => pick('gallery', 'add'));
  $('[data-act="add-camera"]').addEventListener('click', () => pick('camera', 'add'));
  $('[data-act="add-gallery"]').addEventListener('click', () => pick('gallery', 'add'));

  stripList.addEventListener('click', (e) => {
    const thumb = e.target.closest('[data-index]');
    if (!thumb) return;
    current = Number(thumb.dataset.index);
    showPhotos();
  });

  // Switch photos: arrows, or swipe left/right on the photo.
  function showPhotoAt(index) {
    if (index < 0 || index >= draft.photos.length || index === current) return;
    current = index;
    showPhotos();
  }
  $('[data-act="prev"]').addEventListener('click', () => showPhotoAt(current - 1));
  $('[data-act="next"]').addEventListener('click', () => showPhotoAt(current + 1));
  let swipeStart = null;
  filledBox.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    swipeStart = { x: e.clientX, y: e.clientY };
  });
  filledBox.addEventListener('pointerup', (e) => {
    if (!swipeStart) return;
    const dx = e.clientX - swipeStart.x;
    const dy = e.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) showPhotoAt(current + (dx < 0 ? 1 : -1));
    else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) openFullScreen();   // a tap opens full screen
  });
  filledBox.addEventListener('pointercancel', () => { swipeStart = null; });

  // Full screen with zoom. "Draw" there opens draw mode on that photo.
  function openFullScreen() {
    if (!draft.photos.length) return;
    openViewer(draft.photos, current, {
      onClose: (i) => showPhotoAt(i),
      onDraw: (i) => { showPhotoAt(i); startDrawing(); },
    });
  }
  $('[data-act="fullscreen"]').addEventListener('click', openFullScreen);

  $('[data-act="retake"]').addEventListener('click', async () => {
    if (draft.photos[current] && draft.photos[current].drawing) {
      const ok = await confirmDialog({
        title: 'Replace this photo?',
        message: 'Its drawing will be removed if you pick a new photo.',
        confirmText: 'Replace',
      });
      if (!ok) return;
    }
    pick(lastSource, 'replace');
  });

  $('[data-act="remove-photo"]').addEventListener('click', async () => {
    const p = draft.photos[current];
    if (!p) return;
    const ok = await confirmDialog({
      title: draft.photos.length > 1 ? `Remove photo ${current + 1}?` : 'Remove this photo?',
      message: p.drawing ? 'Its drawing will be removed too.' : '',
      confirmText: 'Remove',
      danger: true,
    });
    if (!ok) return;
    draft.photos.splice(current, 1);
    markDirty();
    showPhotos();
  });

  async function startDrawing() {
    const p = draft.photos[current];
    if (!p || drawSession) return;
    drawSession = openDrawMode(p.photo, p.drawing);
    const result = await drawSession.done;
    drawSession = null;
    if (result !== p.drawing) {
      p.drawing = result;
      markDirty();
      showPhotos();
    }
    $('[data-act="draw"]').focus();
  }
  $('[data-act="draw"]').addEventListener('click', startDrawing);

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
  noteEl.addEventListener('input', () => {
    const p = draft.photos[current];
    if (!p) return;
    p.note = noteEl.value;
    markDirty();
  });

  // ---- Share with (one team, or only on this phone) ----
  el.querySelectorAll('input[name="share"]').forEach((radio) => radio.addEventListener('change', () => {
    draft.shareTeam = radio.value || null;
    shareTouched = true;
    markDirty();
  }));
  matchEl.addEventListener('input', () => { draft.matchNumber = matchEl.value; markDirty(); });

  // ---- Subsystem ----

  const subsystemEl = $('#subsystem');
  function showSubsystem() {
    el.querySelectorAll('[data-subsystem]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.subsystem.toLowerCase() === draft.subsystem.trim().toLowerCase())));
  }
  subsystemEl.addEventListener('input', () => { draft.subsystem = subsystemEl.value; markDirty(); showSubsystem(); });
  $('.subsystem-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-subsystem]');
    if (!chip) return;
    // Tap the chosen one again to clear it.
    draft.subsystem = draft.subsystem.trim().toLowerCase() === chip.dataset.subsystem.toLowerCase() ? '' : chip.dataset.subsystem;
    subsystemEl.value = draft.subsystem;
    markDirty();
    showSubsystem();
  });

  // ---- Dictation (speech to text into the caption) ----

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const dictateBtn = $('[data-act="dictate"]');
  let listening = null;
  function stopDictation() {
    if (listening) listening.stop();
  }
  if (Recognition) {
    dictateBtn.hidden = false;
    dictateBtn.addEventListener('click', () => {
      if (listening) { stopDictation(); return; }
      if (voice.isRecording()) { toast('Stop the voice note first.'); return; }
      const start = captionEl.value;
      const gap = start && !/\s$/.test(start) ? ' ' : '';
      const r = new Recognition();
      r.lang = navigator.language || 'en-US';
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (ev) => {
        const said = Array.from(ev.results).map((res) => res[0].transcript).join('').trim();
        captionEl.value = said ? start + gap + said : start;
        draft.caption = captionEl.value;
        markDirty();
      };
      r.onerror = (ev) => {
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') toast('Allow the microphone to dictate.');
        else if (ev.error === 'network') toast('Dictation needs the internet on this phone.');
        else if (ev.error !== 'aborted' && ev.error !== 'no-speech') toast('Dictation stopped.');
      };
      r.onend = () => {
        listening = null;
        dictateBtn.textContent = 'Dictate';
        dictateBtn.classList.remove('listening');
      };
      try {
        r.start();
        listening = r;
        dictateBtn.textContent = 'Stop';
        dictateBtn.classList.add('listening');
        $('.dictate-hint').hidden = false;
      } catch (err) {
        console.warn(err);
        toast('Dictation isn\'t available right now.');
      }
    });
  }

  // ---- Match details (competition entries) ----

  el.querySelectorAll('[data-match-field]').forEach((input) => input.addEventListener('input', () => {
    draft.match[input.dataset.matchField] = input.value;
    markDirty();
  }));
  function showAuton() {
    el.querySelectorAll('[data-auton]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.auton === draft.match.auton)));
  }
  matchField.querySelector('.chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-auton]');
    if (!chip) return;
    draft.match.auton = draft.match.auton === chip.dataset.auton ? '' : chip.dataset.auton;
    markDirty();
    showAuton();
  });

  // ---- Test results (a small table of trials) ----

  const testToggle = $('[data-act="test-open"]');
  const testPanel = $('.test-panel');
  function drawTest() {
    const t = draft.testData;
    testToggle.hidden = Boolean(t);
    testToggle.setAttribute('aria-expanded', String(Boolean(t)));
    testPanel.hidden = !t;
    if (!t) { testPanel.innerHTML = ''; return; }
    const numbers = t.kind !== 'passfail';
    testPanel.innerHTML = `
      <div class="stage-head">
        <span class="label">Test results</span>
        <button type="button" class="btn btn-ghost btn-small" data-act="test-remove">Remove</button>
      </div>
      <div class="segmented two" role="group" aria-label="Kind of result">
        <button type="button" class="seg-btn" data-test-kind="number" aria-pressed="${numbers}">Numbers</button>
        <button type="button" class="seg-btn" data-test-kind="passfail" aria-pressed="${!numbers}">Pass / fail</button>
      </div>
      <div class="two-col">
        <label class="mini-field"><span class="label-small">What you measured</span>
          <input class="input" type="text" data-test="metric" maxlength="60" placeholder="${numbers ? 'e.g. Time to score' : 'e.g. Grabs the ring'}" value="${esc(t.metric)}"></label>
        ${numbers ? `<label class="mini-field"><span class="label-small">Unit</span>
          <input class="input" type="text" data-test="unit" maxlength="20" placeholder="e.g. s, in, %" value="${esc(t.unit)}"></label>` : '<span></span>'}
      </div>
      ${numbers ? `
      <div class="two-col">
        <label class="mini-field"><span class="label-small">Goal <span class="muted">(optional)</span></span>
          <input class="input" type="number" inputmode="decimal" data-test="goal" value="${esc(t.goal)}"></label>
        <label class="mini-field"><span class="label-small">Better is</span>
          <select class="input" data-test="better">
            <option value="lower" ${t.better !== 'higher' ? 'selected' : ''}>Lower</option>
            <option value="higher" ${t.better === 'higher' ? 'selected' : ''}>Higher</option>
          </select></label>
      </div>` : ''}
      <ol class="trial-list">
        ${t.trials.map((tr, i) => `
          <li class="trial-row">
            <span class="trial-num">Trial ${i + 1}</span>
            ${numbers
              ? `<input class="input" type="number" inputmode="decimal" data-trial="${i}" aria-label="Trial ${i + 1} result" value="${esc(tr.value)}">`
              : `<span class="trial-pf">
                   <button type="button" class="chip" data-trial-pass="${i}" data-pass="1" aria-pressed="${tr.pass === true}">Pass</button>
                   <button type="button" class="chip" data-trial-pass="${i}" data-pass="0" aria-pressed="${tr.pass === false}">Fail</button>
                 </span>`}
            <button type="button" class="btn btn-ghost btn-small" data-trial-remove="${i}" aria-label="Remove trial ${i + 1}">✕</button>
          </li>`).join('')}
      </ol>
      <button type="button" class="btn btn-secondary btn-small" data-act="trial-add">+ Add trial</button>
      <p class="test-stats hint" aria-live="polite"></p>`;
    showTestStats();
  }
  function showTestStats() {
    const stats = testPanel.querySelector('.test-stats');
    if (stats) stats.textContent = testSummary(cleanTest(draft.testData)) || 'Fill in a few trials to see the average and success rate.';
  }
  testToggle.addEventListener('click', () => {
    draft.testData = newTest();
    markDirty();
    drawTest();
    testPanel.querySelector('[data-test="metric"]').focus();
  });
  // Typing: update without redrawing (keeps the keyboard open).
  testPanel.addEventListener('input', (e) => {
    const t = draft.testData;
    if (!t) return;
    if (e.target.dataset.test) t[e.target.dataset.test] = e.target.value;
    if (e.target.dataset.trial !== undefined) t.trials[Number(e.target.dataset.trial)].value = e.target.value;
    markDirty();
    showTestStats();
  });
  testPanel.addEventListener('change', (e) => {
    if (e.target.dataset.test === 'better') { draft.testData.better = e.target.value; showTestStats(); }
  });
  testPanel.addEventListener('click', async (e) => {
    const t = draft.testData;
    const btn = e.target.closest('button');
    if (!t || !btn) return;
    if (btn.dataset.testKind) t.kind = btn.dataset.testKind;
    else if (btn.dataset.trialPass !== undefined) {
      const tr = t.trials[Number(btn.dataset.trialPass)];
      const pass = btn.dataset.pass === '1';
      tr.pass = tr.pass === pass ? null : pass;
    } else if (btn.dataset.trialRemove !== undefined) t.trials.splice(Number(btn.dataset.trialRemove), 1);
    else if (btn.dataset.act === 'trial-add') {
      if (t.trials.length >= 50) return;
      t.trials.push({ value: '', pass: null });
    } else if (btn.dataset.act === 'test-remove') {
      const ok = await confirmDialog({ title: 'Remove the test results?', confirmText: 'Remove', danger: true });
      if (!ok) return;
      draft.testData = null;
    } else return;
    markDirty();
    drawTest();
    if (btn.dataset.act === 'trial-add') {
      const inputs = testPanel.querySelectorAll('[data-trial]');
      if (inputs.length) inputs[inputs.length - 1].focus();
    }
  });

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

    if (!draft.photos.length && !draft.caption.trim()) {
      showSaveError('Add a photo or a caption to save.');
      return;
    }

    saving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    saveError.hidden = true;
    try {
      const now = new Date().toISOString();
      const first = draft.photos[0] || { photo: null, drawing: null };
      const entry = {
        id: existing ? existing.id : uuid(),
        type: draft.type,
        stage: draft.stage || null,
        photos: draft.photos.map((p) => ({ photo: p.photo, drawing: p.drawing || null, note: (p.note || '').trim() })),
        caption: draft.caption.trim(),
        audio: draft.audio,
        audioMime: draft.audio ? draft.audioMime : null,
        matchNumber: draft.type === 'competition' && draft.matchNumber.trim() ? draft.matchNumber.trim() : null,
        subsystem: draft.subsystem.trim().slice(0, 40),
        testData: cleanTest(draft.testData),
        match: draft.type === 'competition' ? cleanMatch(draft.match) : null,
        // An edited entry needs witnessing again (a teammate signed the old version).
        witness: null,
        author: existing ? existing.author : settings.author,   // added automatically
        createdAt: existing ? existing.createdAt : now,          // added automatically
        updatedAt: now,
        thumb: await makeThumbnail(first.photo, first.drawing),  // first photo, for the Home list
      };
      // Team sharing: saved on the phone first, uploaded later by sync.js.
      // (Read the latest upload info, in case a sync finished while editing.)
      const latest = existing ? await getEntry(existing.id) : null;
      entry.remote = latest ? latest.remote || null : null;
      // shareTeam: team id, null (only on this phone), or undefined (saved before any team).
      entry.shareTeam = teams.length && (shareTouched || !existing) ? draft.shareTeam : (existing ? existing.shareTeam : undefined);
      entry.sync = typeof entry.shareTeam === 'string' || entry.remote ? 'pending' : null;
      if (shareTouched && entry.shareTeam) saveSettings({ lastShareTeam: entry.shareTeam }).catch(() => {});

      await putEntry(entry);
      dirty = false;
      requestPersistentStorage();   // ask the browser to keep our data (first save)
      if (entry.sync === 'pending') syncSoon();
      if (entry.stage && entry.stage !== settings.lastStage) {
        saveSettings({ lastStage: entry.stage }).catch(() => {});
      }
      // The next match entry starts at the same event.
      if (entry.match && entry.match.event && entry.match.event !== settings.lastEvent) {
        saveSettings({ lastEvent: entry.match.event }).catch(() => {});
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

  showPhotos();
  showType();
  showStage(Boolean(draft.stage));
  showSubsystem();
  showAuton();
  drawTest();

  return {
    // Called by the router before leaving this screen.
    async canLeave() {
      if (drawSession) {           // Back while drawing = Done, stay on this screen
        drawSession.finish();
        return false;
      }
      stopDictation();
      if (voice.isRecording()) await voice.stop();
      if (!dirty) return true;      // nothing to lose (also true right after Save)
      if (saving) return false;
      return confirmDialog({
        title: existing ? 'Discard your changes?' : 'Discard this entry?',
        message: existing ? 'Your changes to this entry will be lost.' : 'The photos, voice note and caption will be lost.',
        confirmText: 'Discard',
        cancelText: 'Keep editing',
        danger: true,
      });
    },
    unmount() {
      stopDictation();
      voice.destroy();
      if (drawSession) drawSession.finish();
      urls.revokeAll();
      window.removeEventListener('beforeunload', onBeforeUnload);
    },
  };
}
