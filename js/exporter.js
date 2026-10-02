// Export helpers: file names, the CSV file, building the ZIP, and
// sharing (Web Share API) or downloading a file.

import { renderEntryImage } from './render.js';
import { makeZip } from './zip.js';
import { photosOf, flattenPhoto } from './image.js';
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

// Image file names for an entry: one per photo.
//   1 photo (or none):  2026-10-01_1542_build.png
//   3 photos:           2026-10-01_1542_build_photo1.png, ..._photo2.png, ..._photo3.png
export function imageFileNames(entry, base = baseName(entry)) {
  const n = photosOf(entry).length;
  if (n <= 1) return [`${base}.png`];
  return Array.from({ length: n }, (_, i) => `${base}_photo${i + 1}.png`);
}

// Make all of an entry's export images (one per photo) as PNG files.
export async function renderEntryImages(entry, settings, base = baseName(entry)) {
  const names = imageFileNames(entry, base);
  const audioName = audioFileName(entry, base);
  const images = [];
  for (let i = 0; i < names.length; i++) {
    const png = await renderEntryImage(entry, settings.export[entry.type], audioName, i);
    images.push(new File([png], names[i], { type: 'image/png' }));
  }
  return images;
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

function buildCsv(entries, names, includePhotos) {
  const header = ['date', 'author', 'type', 'stage', 'match_number', 'caption', 'image_file', 'audio_file', 'photo_files'];
  const rows = entries.map((e) => {
    const base = names.get(e.id);
    return [
      csvDate(e.createdAt),
      e.author,
      TYPE_LABELS[e.type] || e.type,
      e.stage ? STAGE_LABELS[e.stage] : '',
      e.matchNumber || '',
      e.caption || '',
      imageFileNames(e, base).join('; '),
      audioFileName(e, base) || '',
      includePhotos ? photosOf(e).map((_, i, all) => `photos/${photoFileName(base, i, all.length)}`).join('; ') : '',
    ].map(csvCell).join(',');
  });
  // The "﻿" at the start helps Excel / Google Sheets read emoji and accents.
  return `﻿${[header.join(','), ...rows].join('\r\n')}\r\n`;
}

// Build the export ZIP: one PNG per photo of each entry, each voice note, entries.csv,
// and (includePhotos) a photos/ folder with the full-size photos for the notebook.
// onProgress(done, total) is called as each entry's images are made.
export async function buildExportZip(entries, settings, onProgress = () => {}, { includePhotos = true } = {}) {
  const sorted = [...entries].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));  // oldest first
  const names = uniqueBaseNames(sorted);
  const files = [];
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    const base = names.get(e.id);
    const audioName = audioFileName(e, base);
    for (const image of await renderEntryImages(e, settings, base)) {
      files.push({ name: image.name, data: image, date: new Date(e.createdAt) });
    }
    if (e.audio) files.push({ name: audioName, data: e.audio, date: new Date(e.createdAt) });
    if (includePhotos) {
      const list = photosOf(e);
      for (let p = 0; p < list.length; p++) {
        files.push({ name: `photos/${photoFileName(base, p, list.length)}`, data: await flattenPhoto(list[p]), date: new Date(e.createdAt) });
      }
    }
    onProgress(i + 1, sorted.length);
  }
  files.push({ name: 'entries.csv', data: buildCsv(sorted, names, includePhotos), date: new Date() });
  return makeZip(files);
}

// Can this phone share this file (or list of files) through the share sheet?
export function canShareFile(fileOrFiles) {
  const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
  try {
    return Boolean(navigator.canShare && navigator.share && navigator.canShare({ files }));
  } catch {
    return false;
  }
}

// Only use the share sheet on phones/tablets. On a laptop, "download" should
// just save the file (the desktop share sheet doesn't offer "Save").
const isTouchDevice = () => window.matchMedia('(pointer: coarse)').matches;

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
// files isn't supported. file can be one File or a list of Files.
// Returns 'shared', 'cancelled', 'downloaded' or 'retry'.
export async function shareOrDownload(fileOrFiles, title, { preferDownload = false } = {}) {
  const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
  const useShare = canShareFile(files) && !(preferDownload && !isTouchDevice());
  if (useShare) {
    try {
      await navigator.share({ files, title });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
      // Sharing needs a fresh tap; if the image took too long to make,
      // the browser says NotAllowedError. The file is ready now, so tap again.
      if (err.name === 'NotAllowedError') return 'retry';
      console.warn('Share failed, downloading instead', err);
    }
  }
  // Several downloads in a row: a short pause between them so the browser allows each one.
  for (let i = 0; i < files.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 400));
    downloadBlob(files[i], files[i].name);
  }
  return 'downloaded';
}

// Download photos for the notebook (full size, with the drawing on top if there is one).
// On a phone this opens the share sheet, where "Save Image" puts them in the camera roll.
export async function downloadPhotos(photoList, base, title = 'PitSide photos') {
  const files = [];
  for (let i = 0; i < photoList.length; i++) {
    files.push(new File([await flattenPhoto(photoList[i])], photoFileName(base, i, photoList.length), { type: 'image/jpeg' }));
  }
  return shareOrDownload(files, title, { preferDownload: true });
}

// "2026-10-01_1542_build_photo2.jpg" (or without the number if there's one photo)
export function photoFileName(base, index, count) {
  return count > 1 ? `${base}_photo${index + 1}.jpg` : `${base}_photo.jpg`;
}
