// Voice note: "Hold to record" button (or tap to start / tap to stop),
// 30 second limit, then Play and Delete.
//
// Uses MediaRecorder. The microphone permission is only asked for when the
// user first presses the record button, never when the app opens.

import { formatSeconds, confirmDialog } from './ui.js';

export const MAX_SECONDS = 30;
const HOLD_MS = 400;   // pressed longer than this = "hold" mode, shorter = "tap" mode

// iPhone Safari records audio/mp4; Chrome/Android records audio/webm.
export function pickAudioMime() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  return '';
}

function micSupported() {
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}

// container: element to draw into
// initial:   { audio, audioMime } when editing an entry
// onChange:  called with { audio, audioMime } whenever a note is added or deleted
export function createVoiceNote(container, initial, onChange) {
  let audio = initial.audio || null;
  let audioMime = initial.audioMime || null;
  let knownDuration = null;     // seconds, known right after recording

  let state = micSupported() ? 'idle' : 'unsupported';   // idle | starting | recording | blocked | unsupported
  let mode = null;              // 'hold' or 'tap' while recording
  let stream = null;
  let recorder = null;
  let chunks = [];
  let startedAt = 0;
  let timer = null;
  let autoStop = null;
  let pressAt = 0;
  let pressing = false;
  let cancelStart = false;
  let stopWaiters = [];
  let player = null;
  let playerUrl = null;
  let destroyed = false;

  container.innerHTML = `
    <div class="voice">
      <div class="voice-record">
        <button type="button" class="btn btn-record" aria-describedby="voice-hint">
          <span class="rec-dot" aria-hidden="true"></span>
          <span class="rec-label">Hold to record</span>
        </button>
        <p class="hint" id="voice-hint">Or tap once to start and tap again to stop. Up to ${MAX_SECONDS} seconds.</p>
      </div>
      <div class="voice-saved" hidden>
        <span class="voice-length">Voice note</span>
        <button type="button" class="btn btn-secondary" data-act="play">Play</button>
        <button type="button" class="btn btn-secondary btn-danger-text" data-act="delete">Delete</button>
      </div>
      <div class="mic-off" hidden>
        <p><strong>Microphone is off. You can still type a caption.</strong></p>
        <p class="hint mic-off-help"></p>
      </div>
      <p class="sr-only" aria-live="polite" data-live></p>
    </div>`;

  const recordBox = container.querySelector('.voice-record');
  const recordBtn = container.querySelector('.btn-record');
  const recordLabel = container.querySelector('.rec-label');
  const savedBox = container.querySelector('.voice-saved');
  const lengthLabel = container.querySelector('.voice-length');
  const playBtn = container.querySelector('[data-act="play"]');
  const micOff = container.querySelector('.mic-off');
  const micOffHelp = container.querySelector('.mic-off-help');
  const live = container.querySelector('[data-live]');

  // ---- Drawing the current state ----

  function render() {
    const micUnavailable = state === 'blocked' || state === 'unsupported';
    savedBox.hidden = !audio;
    recordBox.hidden = Boolean(audio) || micUnavailable;
    micOff.hidden = Boolean(audio) || !micUnavailable;
    micOffHelp.textContent = state === 'unsupported'
      ? 'This browser can\'t record audio. Try Safari on iPhone or Chrome on Android.'
      : 'To turn it on, allow the microphone for this site in your browser settings (iPhone: Settings > Safari > Microphone), then reopen PitSide.';

    recordBtn.classList.toggle('is-recording', state === 'recording');
    if (state === 'recording') {
      const elapsed = (performance.now() - startedAt) / 1000;
      const time = `${formatSeconds(elapsed)} / ${formatSeconds(MAX_SECONDS)}`;
      recordLabel.textContent = mode === 'hold' || pressing ? `Recording ${time} · release to stop` : `Recording ${time} · tap to stop`;
    } else if (state === 'starting') {
      recordLabel.textContent = 'Starting microphone…';
    } else {
      recordLabel.textContent = 'Hold to record';
    }

    if (audio) {
      lengthLabel.textContent = knownDuration ? `Voice note ${formatSeconds(knownDuration)}` : 'Voice note';
    }
  }

  // ---- Recording ----

  async function startRecording() {
    if (state !== 'idle') return;
    state = 'starting';
    cancelStart = false;
    render();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.warn('Microphone error', err);
      state = 'blocked';
      render();
      return;
    }
    if (cancelStart || destroyed) {
      releaseMic();
      state = 'idle';
      render();
      return;
    }

    const mime = pickAudioMime();
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (err) {
      console.warn('MediaRecorder error', err);
      releaseMic();
      state = 'unsupported';
      render();
      return;
    }
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => finishRecording(mime);
    recorder.start();

    state = 'recording';
    // If the finger was already lifted (e.g. while the permission popup was
    // showing), switch to tap mode: keep recording until tapped again.
    mode = pressing ? 'hold' : 'tap';
    startedAt = performance.now();
    timer = setInterval(render, 250);
    autoStop = setTimeout(stopRecording, MAX_SECONDS * 1000);   // stop automatically at 30 s
    live.textContent = 'Recording started';
    render();
  }

  // Returns a Promise that resolves once the recording is saved in memory.
  function stopRecording() {
    if (state === 'starting') {
      cancelStart = true;
      return Promise.resolve();
    }
    if (state !== 'recording') return Promise.resolve();
    return new Promise((resolve) => {
      stopWaiters.push(resolve);
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    });
  }

  function finishRecording(mime) {
    const seconds = Math.min(MAX_SECONDS, (performance.now() - startedAt) / 1000);
    clearInterval(timer);
    clearTimeout(autoStop);
    const type = (recorder && recorder.mimeType) || mime || 'audio/webm';
    const blob = new Blob(chunks, { type });
    releaseMic();
    recorder = null;
    chunks = [];
    state = 'idle';
    mode = null;

    if (!destroyed && blob.size > 0) {
      audio = blob;
      audioMime = type;
      knownDuration = Math.max(1, Math.round(seconds));
      live.textContent = `Voice note recorded, ${formatSeconds(knownDuration)}`;
      onChange({ audio, audioMime });
    }
    if (!destroyed) render();
    stopWaiters.forEach((resolve) => resolve());
    stopWaiters = [];
  }

  // Turn the mic off (so the phone's "mic in use" light goes away).
  function releaseMic() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  // ---- Hold to record / tap to start-stop ----

  recordBtn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (state === 'recording') {          // second tap in tap mode
      stopRecording();
      return;
    }
    pressing = true;
    pressAt = Date.now();
    try { recordBtn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    startRecording();
  });

  function onRelease() {
    if (!pressing) return;
    pressing = false;
    const held = Date.now() - pressAt;
    if (state === 'recording' && held >= HOLD_MS) {
      stopRecording();                    // hold-to-record: let go = stop
    } else if (state === 'recording') {
      mode = 'tap';                       // quick tap: keep recording
      render();
    }
  }
  recordBtn.addEventListener('pointerup', onRelease);
  recordBtn.addEventListener('pointercancel', onRelease);
  recordBtn.addEventListener('contextmenu', (e) => e.preventDefault());

  // Keyboard (Enter/Space) and screen readers send a click with detail 0.
  recordBtn.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    if (state === 'recording') stopRecording();
    else { pressing = false; startRecording(); }
  });

  // ---- Playback and delete ----

  function stopPlayback() {
    if (player) {
      player.pause();
      player = null;
    }
    if (playerUrl) URL.revokeObjectURL(playerUrl);
    playerUrl = null;
    playBtn.textContent = 'Play';
  }

  playBtn.addEventListener('click', () => {
    if (player) { stopPlayback(); return; }
    playerUrl = URL.createObjectURL(audio);
    player = new Audio(playerUrl);
    player.addEventListener('loadedmetadata', () => {
      if (!knownDuration && Number.isFinite(player.duration)) {
        knownDuration = Math.round(player.duration);
        render();
      }
    });
    player.addEventListener('ended', stopPlayback);
    player.play().catch((err) => {
      console.warn('Playback failed', err);
      stopPlayback();
      live.textContent = 'Could not play this voice note';
    });
    playBtn.textContent = 'Stop';
  });

  container.querySelector('[data-act="delete"]').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Delete this voice note?', confirmText: 'Delete', danger: true });
    if (!ok) return;
    stopPlayback();
    audio = null;
    audioMime = null;
    knownDuration = null;
    onChange({ audio, audioMime });
    render();
    recordBtn.focus();
  });

  // ---- Check the permission without asking (so a blocked mic shows right away) ----

  if (state === 'idle' && navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'microphone' }).then((status) => {
      const apply = () => {
        if (status.state === 'denied' && state === 'idle') state = 'blocked';
        else if (status.state !== 'denied' && state === 'blocked') state = 'idle';
        if (!destroyed) render();
      };
      apply();
      status.onchange = apply;
    }).catch(() => { /* this browser can't check; we find out on first press */ });
  }

  render();

  return {
    isRecording: () => state === 'recording' || state === 'starting',
    stop: stopRecording,
    destroy() {
      destroyed = true;
      clearInterval(timer);
      clearTimeout(autoStop);
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      releaseMic();
      stopPlayback();
    },
  };
}
