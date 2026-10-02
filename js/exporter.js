// Export helpers: file names, the CSV file, building the ZIP, and
// sharing (Web Share API) or downloading a file.

import { renderEntryImage } from './render.js';
import { makeZip } from './zip.js';
import { TYPE_LABELS, STAGE_LABELS } from './ui.js';

const pad = (n) => String(n).padStart(2, '0');

// "2026-10-01_1542_build" (local time)
export function baseName(entry) {
  const d = new Date(entry.createdAt);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}_${entry.type}`;
}

// File extension for a voice note, from its MIME type.
export function audioExtension(mime) {
  const m = (mime || '').toLowerCase();
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mpeg')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  return 'webm';
}

export function audioFileName(entry, base = baseName(entry)) {
  return entry.audio ? `${base}.${audioExtension(entry.audioMime || entry.audio.type)}` : null;
}

// Give every entry a unique base name. Two entries of the same type in the
// same minute get "_2", "_3"...
function uniqueBaseNames(entries) {
  const used = new Map();
  const names = new Map();
  for (const e of entries) {
    const base = baseName(e);
    const count = (used.get(base) || 0) + 1;
    used.set(base, count);
    names.set(e.id, count === 1 ? base : `${base}_${count}`);
  }
  return names;
}

// One CSV cell: wrap in quotes, double any quotes inside.
function csvCell(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildCsv(entries, names) {
  const header = ['date', 'author', 'type', 'stage', 'match_number', 'caption', 'image_file', 'audio_file'];
  const rows = entries.map((e) => {
    const base = names.get(e.id);
    return [
      csvDate(e.createdAt),
      e.author,
      TYPE_LABELS[e.type] || e.type,
      e.stage ? STAGE_LABELS[e.stage] : '',
      e.matchNumber || '',
      e.caption || '',
      `${base}.png`,
      audioFileName(e, base) || '',
    ].map(csvCell).join(',');
  });
  // The "﻿" at the start helps Excel / Google Sheets read emoji and accents.
  return `﻿${[header.join(','), ...rows].join('\r\n')}\r\n`;
}

// Build the export ZIP: one PNG per entry, each voice note, and entries.csv.
// onProgress(done, total) is called as each image is made.
export async function buildExportZip(entries, settings, onProgress = () => {}) {
  const sorted = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));  // oldest first
  const names = uniqueBaseNames(sorted);
  const files = [];
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    const base = names.get(e.id);
    const audioName = audioFileName(e, base);
    const png = await renderEntryImage(e, settings.export[e.type], audioName);
    files.push({ name: `${base}.png`, data: png, date: new Date(e.createdAt) });
    if (e.audio) files.push({ name: audioName, data: e.audio, date: new Date(e.createdAt) });
    onProgress(i + 1, sorted.length);
  }
  files.push({ name: 'entries.csv', data: buildCsv(sorted, names), date: new Date() });
  return makeZip(files);
}

// Can this phone share this file through the share sheet?
export function canShareFile(file) {
  try {
    return Boolean(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
  } catch {
    return false;
  }
}

// Save a file to the device's Downloads.
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);   // give slow phones time
}

// Open the share sheet (Slides, Drive, chat apps…) or download if sharing
// files isn't supported. Returns 'shared', 'cancelled', 'downloaded' or 'retry'.
export async function shareOrDownload(file, title) {
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
      // Sharing needs a fresh tap; if the image took too long to make,
      // the browser says NotAllowedError. The file is ready now, so tap again.
      if (err.name === 'NotAllowedError') return 'retry';
      console.warn('Share failed, downloading instead', err);
    }
  }
  downloadBlob(file, file.name);
  return 'downloaded';
}
