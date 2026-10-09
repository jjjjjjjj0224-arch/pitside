// Backup and restore: everything on this phone in one file you can keep in Drive
// or Files, and put back on any phone (or after clearing the browser).
//
// The file is a ZIP: backup.json (entries, notebook formats, meetings, settings)
// plus files/ with every photo, drawing, thumbnail, voice note and format page.
// In backup.json a picture or sound is { "$file": "files/12.jpg", "type": "image/jpeg" }.
//
// Restoring adds what's missing and updates entries that are newer in the backup;
// nothing on the phone is deleted. Teammates' entries aren't in it (they're online).

import { getAllEntries, putEntry, readSettings } from './db.js';
import { listFormats, getFormat, saveFormat } from './templates.js';
import { listMeetings, replaceMeetings } from './meetings.js';
import { saveSettings } from './settings.js';
import { makeZip, readZip } from './zip.js';

const VERSION = 1;

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3' };

// Make the backup file. onProgress(text) for the button.
export async function makeBackup(onProgress = () => {}) {
  const files = [];
  // Blobs become { $file, type } and go into files/.
  const pack = (value) => {
    if (value instanceof Blob) {
      const type = (value.type || 'application/octet-stream').split(';')[0];
      const name = `files/${files.length + 1}.${EXT[type] || 'bin'}`;
      files.push({ name, data: value });
      return { $file: name, type: value.type || '' };
    }
    if (Array.isArray(value)) return value.map(pack);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, pack(v)]));
    return value;
  };

  onProgress('Collecting entries…');
  const entries = await getAllEntries();
  const formats = [];
  for (const f of await listFormats()) {
    const full = await getFormat(f.id);
    if (full) formats.push(full);
  }
  const data = {
    app: 'PitSide',
    version: VERSION,
    createdAt: new Date().toISOString(),
    entries: pack(entries),
    formats: pack(formats),
    meetings: await listMeetings(),
    settings: await readSettings(),
  };
  onProgress('Packing…');
  const zip = await makeZip([
    { name: 'backup.json', data: JSON.stringify(data), date: new Date() },
    ...files.map((f) => ({ ...f, date: new Date() })),
  ]);
  const day = new Date().toISOString().slice(0, 10);
  await saveSettings({ lastBackup: new Date().toISOString() });
  return {
    file: new File([zip], `pitside-backup-${day}.zip`, { type: 'application/zip' }),
    counts: { entries: entries.length, formats: formats.length, meetings: data.meetings.length },
  };
}

// Read a backup file (doesn't change anything yet). Throws 'not_a_backup'.
export async function readBackup(file) {
  let zip;
  try { zip = await readZip(file); } catch { throw new Error('not_a_backup'); }
  const json = zip.get('backup.json');
  if (!json) throw new Error('not_a_backup');
  let data;
  try { data = JSON.parse(await json.text()); } catch { throw new Error('not_a_backup'); }
  if (data.app !== 'PitSide' || !Array.isArray(data.entries)) throw new Error('not_a_backup');
  const unpack = (value) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.$file === 'string') {
      const blob = zip.get(value.$file);
      return blob ? new Blob([blob], { type: value.type || '' }) : null;
    }
    if (Array.isArray(value)) return value.map(unpack);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unpack(v)]));
    return value;
  };
  return {
    createdAt: data.createdAt,
    entries: unpack(data.entries),
    formats: unpack(data.formats || []),
    meetings: data.meetings || [],
    settings: data.settings || null,
  };
}

// Put a backup's contents on this phone. withSettings: also your name, export
// options and theme. Returns what changed.
export async function restoreBackup(backup, { withSettings = false } = {}) {
  const result = { added: 0, updated: 0, unchanged: 0, formats: 0, meetings: 0 };
  const current = new Map((await getAllEntries()).map((e) => [e.id, e]));
  for (const e of backup.entries) {
    if (!e || !e.id) continue;
    const have = current.get(e.id);
    if (!have) { await putEntry(e); result.added += 1; continue; }
    if (new Date(e.updatedAt || e.createdAt) > new Date(have.updatedAt || have.createdAt)) {
      await putEntry(e);
      result.updated += 1;
    } else {
      result.unchanged += 1;
    }
  }
  const haveFormats = new Set((await listFormats()).map((f) => f.id));
  for (const f of backup.formats) {
    if (f && f.page && !haveFormats.has(f.id)) { await saveFormat(f); result.formats += 1; }
  }
  const meetings = new Map((await listMeetings()).map((m) => [m.id, m]));
  for (const m of backup.meetings) {
    const have = meetings.get(m.id);
    if (!have || (m.updatedAt || '') > (have.updatedAt || '')) { meetings.set(m.id, m); result.meetings += 1; }
  }
  await replaceMeetings([...meetings.values()]);
  if (withSettings && backup.settings) {
    const { lastBackup, ...rest } = backup.settings;
    await saveSettings(rest);
  }
  return result;
}
