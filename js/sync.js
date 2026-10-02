// Keeps the phone and the team in step. Saving NEVER waits for the internet:
// entries are saved on the phone first and marked "pending", then this file
// uploads them whenever there is a connection.
//
// One sync run:
//   1. check we're still in the team
//   2. delete entries from the team that were deleted on the phone
//   3. upload shared entries that are new or changed (files first, then the row)
//   4. remove entries whose "Share with team" was switched off
//   5. download the team's entry list (+ small thumbnails) for the Team view
//
// Each entry on the phone has:
//   shared: true / false / undefined (saved before joining a team = not shared)
//   sync:   'pending' (needs uploading/removing) or 'synced'
//   remote: where its files are in the team storage, or null

import {
  getAllEntries, getEntry, putEntry, readKey, writeKey,
  getAllTeamEntries, putTeamEntry, deleteTeamEntry,
} from './db.js';
import { isCloudConfigured, table, files, friendlyError } from './cloud.js';
import { getTeam, refreshTeam } from './team.js';
import { audioExtension } from './exporter.js';

const FILE_KEYS = ['photo', 'drawing', 'thumb', 'audio'];

let status = { state: 'idle', pending: 0, error: null, lastSynced: null };
let running = null;
let runAgain = false;
let timer = null;

export function getSyncStatus() {
  return status;
}

function setStatus(changes) {
  status = { ...status, ...changes };
  window.dispatchEvent(new CustomEvent('pitside-sync', { detail: status }));
}

// Does this entry need uploading to (or removing from) the team?
function needsUpload(e, team) {
  return e.shared === true && (e.sync !== 'synced' || !e.remote || e.remote.teamId !== team.teamId);
}
function needsUnshare(e) {
  return e.shared !== true && Boolean(e.remote);
}

export async function countPending() {
  const team = getTeam();
  if (!team) return 0;
  const entries = await getAllEntries();
  const deletes = (await readKey('pendingDeletes')) || [];
  return entries.filter((e) => needsUpload(e, team) || needsUnshare(e)).length + deletes.length;
}

// Sync in a moment (lets several quick changes share one run).
export function syncSoon(delay = 800) {
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}

// Run a sync now. If one is already running, run once more afterwards.
export function syncNow() {
  if (running) {
    runAgain = true;
    return running;
  }
  running = runSync().finally(() => {
    running = null;
    if (runAgain) {
      runAgain = false;
      syncNow();
    }
  });
  return running;
}

async function runSync() {
  if (!isCloudConfigured() || !getTeam()) return;
  setStatus({ pending: await countPending() });
  if (!navigator.onLine) {
    setStatus({ state: 'offline' });
    return;
  }
  setStatus({ state: 'syncing', error: null });
  try {
    const team = await refreshTeam();
    if (!team) {
      setStatus({ state: 'idle', pending: 0 });
      return;
    }
    await pushDeletes();
    for (const e of await getAllEntries()) {
      if (needsUpload(e, team)) await uploadEntry(e, team);
      else if (needsUnshare(e)) await unshareEntry(e);
    }
    await pullTeamEntries(team);
    setStatus({ state: 'idle', lastSynced: new Date().toISOString(), pending: await countPending() });
  } catch (err) {
    console.warn('Sync failed', err);
    setStatus({ state: 'error', error: friendlyError(err), pending: await countPending() });
  }
}

// ---- Upload ----

const plainMime = (mime) => (mime || '').split(';')[0].trim();

async function uploadEntry(e, team) {
  // File names include the edit time, so an edited entry gets new files
  // (and an interrupted upload can safely be retried).
  const stamp = Date.parse(e.updatedAt);
  const folder = `${team.teamId}/${team.userId}/${e.id}`;
  const sources = {
    photo: [e.photo, 'jpg', 'image/jpeg'],
    drawing: [e.photo ? e.drawing : null, 'png', 'image/png'],
    thumb: [e.thumb, 'jpg', 'image/jpeg'],
    audio: [e.audio, audioExtension(e.audioMime), plainMime(e.audioMime) || 'audio/webm'],
  };
  const paths = {};
  for (const key of FILE_KEYS) {
    const [blob, ext, mime] = sources[key];
    if (!blob) { paths[key] = null; continue; }
    paths[key] = `${folder}/${stamp}-${key}.${ext}`;
    const alreadyThere = e.remote && e.remote.teamId === team.teamId && e.remote[key] === paths[key];
    if (!alreadyThere) await files.upload(paths[key], blob, mime);
  }

  await table.upsert('entries', {
    id: e.id,
    team_id: team.teamId,
    user_id: team.userId,
    type: e.type,
    stage: e.stage || null,
    caption: e.caption || '',
    match_number: e.matchNumber || null,
    author: e.author,
    photo_path: paths.photo,
    drawing_path: paths.drawing,
    thumb_path: paths.thumb,
    audio_path: paths.audio,
    audio_mime: e.audio ? plainMime(e.audioMime) : null,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
  });

  // Remove the files of the previous version.
  if (e.remote && e.remote.teamId === team.teamId) {
    const used = new Set(Object.values(paths));
    const old = FILE_KEYS.map((k) => e.remote[k]).filter((p) => p && !used.has(p));
    await files.remove(old).catch((err) => console.warn('Old files not removed', err));
  }

  // The entry may have been edited while uploading: then it stays "pending".
  const current = await getEntry(e.id);
  if (!current) return;   // deleted meanwhile: handled by pendingDeletes
  await putEntry({
    ...current,
    remote: { teamId: team.teamId, ...paths },
    sync: current.updatedAt === e.updatedAt ? 'synced' : 'pending',
  });
}

// (If the connection drops half way, the entry keeps its remote info and the
// next sync tries again; deleting a row or file twice is harmless.)
async function unshareEntry(e) {
  await table.remove('entries', `id=eq.${e.id}`);
  await files.remove(FILE_KEYS.map((k) => e.remote[k]));
  await deleteTeamEntry(e.id);
  const current = await getEntry(e.id);
  if (current) await putEntry({ ...current, remote: null, sync: 'synced' });
}

// ---- Deletes ----

// Called when an entry is deleted on the phone: remember to remove it from the team too.
export async function queueRemoteDelete(entry) {
  if (!entry.remote) return;
  const list = (await readKey('pendingDeletes')) || [];
  list.push({ id: entry.id, paths: FILE_KEYS.map((k) => entry.remote[k]).filter(Boolean) });
  await writeKey('pendingDeletes', list);
  await deleteTeamEntry(entry.id);
  syncSoon();
}

async function pushDeletes() {
  let list = (await readKey('pendingDeletes')) || [];
  while (list.length) {
    const item = list[0];
    await table.remove('entries', `id=eq.${item.id}`);
    await files.remove(item.paths);      // if this fails, the item stays queued for next time
    list = list.slice(1);
    await writeKey('pendingDeletes', list);
  }
}

// ---- Download the team's entries ----

function fromRow(r) {
  return {
    id: r.id,
    teamId: r.team_id,
    userId: r.user_id,
    type: r.type,
    stage: r.stage,
    caption: r.caption || '',
    matchNumber: r.match_number,
    author: r.author,
    audioMime: r.audio_mime,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    paths: { photo: r.photo_path, drawing: r.drawing_path, thumb: r.thumb_path, audio: r.audio_path },
    // Blobs are filled in when downloaded: thumb now, the rest when viewed/exported.
    thumb: null, photo: null, drawing: null, audio: null,
  };
}

async function pullTeamEntries(team) {
  const rows = await table.select('entries', `team_id=eq.${team.teamId}&order=created_at.desc&select=*`);
  const cached = new Map((await getAllTeamEntries()).map((e) => [e.id, e]));
  const mine = new Map((await getAllEntries()).map((e) => [e.id, e]));
  const seen = new Set();

  for (const row of rows) {
    seen.add(row.id);
    const rec = fromRow(row);
    const old = cached.get(row.id);
    if (old && old.updatedAt === rec.updatedAt) {
      for (const k of FILE_KEYS) rec[k] = old[k];      // unchanged: keep downloaded files
    }
    if (row.user_id === team.userId && mine.has(row.id)) {
      // My own entry: its files are already on this phone, don't store them twice.
      rec.localCopy = true;
      for (const k of FILE_KEYS) rec[k] = null;
    } else if (!rec.thumb && rec.paths.thumb) {
      rec.thumb = await files.download(rec.paths.thumb).catch(() => null);
    }
    await putTeamEntry(rec);
  }
  for (const id of cached.keys()) {
    if (!seen.has(id)) await deleteTeamEntry(id);     // deleted from the team
  }
}

// Download the full photo / drawing / voice note of a team entry (and keep
// them on the phone for next time). keys: e.g. ['photo', 'drawing'].
export async function loadTeamFiles(rec, keys) {
  let changed = false;
  for (const key of keys) {
    if (!rec[key] && rec.paths[key]) {
      rec[key] = await files.download(rec.paths[key]);
      changed = true;
    }
  }
  if (changed) await putTeamEntry(rec);
  return rec;
}
