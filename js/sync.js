// Keeps the phone and your teams in step. Saving NEVER waits for the internet:
// entries are saved on the phone first and marked "pending", then this file
// uploads them whenever there is a connection (and you're signed in).
//
// One sync run:
//   1. ask the server which teams I'm in
//   2. delete entries from teams that were deleted on the phone
//   3. per entry: remove it from a team it's no longer shared with, then upload
//      it to the team it's shared with if new or changed (files first, then the row).
//      Pictures are uploaded as WebP, at most 3 MB each (see webp.js).
//   4. download each team's entry list (+ small thumbnails) for the Team view
//
// Each entry on the phone has:
//   shareTeam: a team id = shared with that team; null = only on this phone;
//              undefined = saved before joining any team (not shared)
//   sync:      'pending' (needs uploading/removing) or 'synced'
//   remote:    { teamId, thumb, audio, photos: [{ photo, drawing }] } = where its
//              files are online, or null

import {
  getAllEntries, getEntry, putEntry, readKey, writeKey,
  getAllTeamEntries, putTeamEntry, deleteTeamEntry,
} from './db.js';
import { isCloudConfigured, getAccount, table, files, friendlyError } from './cloud.js';
import { getTeams, refreshTeams } from './team.js';
import { audioExtension } from './exporter.js';
import { photosOf } from './image.js';
import { toWebp } from './webp.js';

// Every online file path of an entry (photos, drawings, thumbnail, voice note).
// (Entries uploaded before multiple photos have single photo/drawing paths.)
function remotePaths(remote) {
  if (!remote) return [];
  return [
    remote.photo, remote.drawing, remote.thumb, remote.audio,
    ...(remote.photos || []).flatMap((p) => [p.photo, p.drawing]),
  ].filter(Boolean);
}

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

// Is it shared with one of my teams, and not uploaded there yet (or changed)?
function needsUpload(e, myTeams) {
  return typeof e.shareTeam === 'string' && myTeams.has(e.shareTeam)
    && (e.sync !== 'synced' || !e.remote || e.remote.teamId !== e.shareTeam);
}
// Is it online in one of my teams that it's no longer shared with?
function needsRemoving(e, myTeams) {
  return Boolean(e.remote) && myTeams.has(e.remote.teamId) && e.remote.teamId !== e.shareTeam;
}

export async function countPending() {
  const myTeams = new Set(getTeams().map((t) => t.teamId));
  if (!myTeams.size) return 0;
  const entries = await getAllEntries();
  const deletes = ((await readKey('pendingDeletes')) || []).filter((d) => !d.teamId || myTeams.has(d.teamId));
  return entries.filter((e) => needsUpload(e, myTeams) || needsRemoving(e, myTeams)).length + deletes.length;
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
  if (!isCloudConfigured()) return;
  const account = await getAccount();
  if (!account || account.anonymous) return;     // sign in with Google first
  setStatus({ pending: await countPending() });
  if (!navigator.onLine) {
    setStatus({ state: 'offline' });
    return;
  }
  setStatus({ state: 'syncing', error: null });
  try {
    const teams = await refreshTeams();
    const myTeams = new Map(teams.map((t) => [t.teamId, t]));
    await pushDeletes(myTeams);
    for (const e of await getAllEntries()) {
      if (needsRemoving(e, myTeams)) await removeFromTeam(e);
      const current = await getEntry(e.id);
      if (current && needsUpload(current, myTeams)) await uploadEntry(current, myTeams.get(current.shareTeam), account.userId);
    }
    await pullTeamEntries(teams, account.userId);
    setStatus({ state: 'idle', lastSynced: new Date().toISOString(), pending: await countPending() });
  } catch (err) {
    console.warn('Sync failed', err);
    setStatus({ state: 'error', error: friendlyError(err), pending: await countPending() });
  }
}

// ---- Upload ----

const plainMime = (mime) => (mime || '').split(';')[0].trim();

async function uploadEntry(e, team, userId) {
  // File names include the edit time, so an edited entry gets new files
  // (and an interrupted upload can safely be retried).
  const stamp = Date.parse(e.updatedAt);
  const folder = `${team.teamId}/${userId}/${e.id}`;
  const before = new Set(e.remote && e.remote.teamId === team.teamId ? remotePaths(e.remote) : []);

  // Upload one file (pictures are made WebP first, max 3 MB).
  async function put(blob, name, kind) {
    if (!blob) return null;
    const isPicture = kind === 'picture';
    const path = `${folder}/${stamp}-${name}${isPicture ? '.webp' : ''}`;
    if (!before.has(path)) {
      const data = isPicture ? await toWebp(blob, name.startsWith('drawing') ? 0.9 : 0.82) : blob;
      await files.upload(path, data, isPicture ? 'image/webp' : kind);
    }
    return path;
  }

  const photos = [];
  const list = photosOf(e);
  for (let i = 0; i < list.length; i++) {
    photos.push({
      photo: await put(list[i].photo, `photo-${i + 1}`, 'picture'),
      drawing: await put(list[i].drawing, `drawing-${i + 1}`, 'picture'),
    });
  }
  const paths = {
    thumb: await put(e.thumb, 'thumb', 'picture'),
    audio: await put(e.audio, `audio.${audioExtension(e.audioMime)}`, plainMime(e.audioMime) || 'audio/webm'),
    photos,
  };

  await table.upsert('entries', {
    id: e.id,
    team_id: team.teamId,
    user_id: userId,
    type: e.type,
    stage: e.stage || null,
    caption: e.caption || '',
    match_number: e.matchNumber || null,
    author: e.author,
    photos,                                              // [{ photo, drawing }] paths
    photo_path: photos[0] ? photos[0].photo : null,      // first photo (older versions read this)
    drawing_path: photos[0] ? photos[0].drawing : null,
    thumb_path: paths.thumb,
    audio_path: paths.audio,
    audio_mime: e.audio ? plainMime(e.audioMime) : null,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
  });

  // Remove the files of the previous version.
  const used = new Set(remotePaths(paths));
  const old = [...before].filter((p) => !used.has(p));
  await files.remove(old).catch((err) => console.warn('Old files not removed', err));

  // The entry may have been edited while uploading: then it stays "pending".
  const current = await getEntry(e.id);
  if (!current) return;   // deleted meanwhile: handled by pendingDeletes
  await putEntry({
    ...current,
    remote: { teamId: team.teamId, ...paths },
    sync: current.updatedAt === e.updatedAt && current.shareTeam === team.teamId ? 'synced' : 'pending',
  });
}

// Take an entry out of the team it was uploaded to (sharing switched off, or
// switched to another team). If the connection drops half way, the entry keeps
// its remote info and the next sync tries again; deleting twice is harmless.
async function removeFromTeam(e) {
  await table.remove('entries', `id=eq.${e.id}`);
  await files.remove(remotePaths(e.remote));
  await deleteTeamEntry(e.id);
  const current = await getEntry(e.id);
  if (current) await putEntry({ ...current, remote: null, sync: typeof current.shareTeam === 'string' ? 'pending' : 'synced' });
}

// ---- Deletes ----

// Called when an entry is deleted on the phone: remember to remove it from its team too.
export async function queueRemoteDelete(entry) {
  if (!entry.remote) return;
  const list = (await readKey('pendingDeletes')) || [];
  list.push({ id: entry.id, teamId: entry.remote.teamId, paths: remotePaths(entry.remote) });
  await writeKey('pendingDeletes', list);
  await deleteTeamEntry(entry.id);
  syncSoon();
}

// Only deletes for teams of the account signed in now; others wait (e.g. after
// switching Google accounts, until the old account signs in again).
async function pushDeletes(myTeams) {
  const list = (await readKey('pendingDeletes')) || [];
  for (const item of list.filter((d) => !d.teamId || myTeams.has(d.teamId))) {
    await table.remove('entries', `id=eq.${item.id}`);
    await files.remove(item.paths);      // if this fails, the item stays queued for next time
    const left = ((await readKey('pendingDeletes')) || []).filter((d) => d.id !== item.id);
    await writeKey('pendingDeletes', left);
  }
}

// ---- Download each team's entries ----

// A team entry as stored on the phone. paths = where its files are online;
// photos/thumb/audio = the downloaded files (thumb at once, the rest when opened/exported).
function fromRow(r) {
  const photoPaths = Array.isArray(r.photos) && r.photos.length
    ? r.photos
    : (r.photo_path ? [{ photo: r.photo_path, drawing: r.drawing_path }] : []);   // older rows
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
    paths: { thumb: r.thumb_path, audio: r.audio_path, photos: photoPaths },
    photos: photoPaths.map(() => ({ photo: null, drawing: null })),
    thumb: null,
    audio: null,
  };
}

async function pullTeamEntries(teams, userId) {
  const cached = new Map((await getAllTeamEntries()).map((e) => [e.id, e]));
  const mine = new Map((await getAllEntries()).map((e) => [e.id, e]));
  const seen = new Set();

  for (const team of teams) {
    const rows = await table.select('entries', `team_id=eq.${team.teamId}&order=created_at.desc&select=*`);
    for (const row of rows) {
      seen.add(row.id);
      const rec = fromRow(row);
      const old = cached.get(row.id);
      if (old && old.updatedAt === rec.updatedAt && Array.isArray(old.photos)) {
        rec.photos = old.photos;   // unchanged: keep downloaded files
        rec.thumb = old.thumb;
        rec.audio = old.audio;
      }
      if (row.user_id === userId && mine.has(row.id)) {
        // My own entry: its files are already on this phone, don't store them twice.
        rec.localCopy = true;
        rec.photos = rec.photos.map(() => ({ photo: null, drawing: null }));
        rec.thumb = null;
        rec.audio = null;
      } else if (!rec.thumb && rec.paths.thumb) {
        rec.thumb = await files.download(rec.paths.thumb).catch(() => null);
      }
      await putTeamEntry(rec);
    }
  }
  for (const id of cached.keys()) {
    if (!seen.has(id)) await deleteTeamEntry(id);     // deleted from the team, or team left
  }
}

// Download the full photos (with drawings) and/or voice note of a team entry,
// and keep them on the phone for next time. what: { photos: true, audio: true }
export async function loadTeamFiles(rec, what) {
  upgradeTeamRecord(rec);
  let changed = false;
  if (what.photos) {
    for (let i = 0; i < rec.paths.photos.length; i++) {
      const p = rec.paths.photos[i];
      const got = rec.photos[i] || (rec.photos[i] = { photo: null, drawing: null });
      if (!got.photo && p.photo) { got.photo = await files.download(p.photo); changed = true; }
      if (!got.drawing && p.drawing) { got.drawing = await files.download(p.drawing); changed = true; }
    }
  }
  if (what.audio && !rec.audio && rec.paths.audio) {
    rec.audio = await files.download(rec.paths.audio);
    changed = true;
  }
  if (changed) await putTeamEntry(rec);
  return rec;
}

// Team copies saved by v1.1 (one photo) -> the photo-list format. Safe to call twice.
export function upgradeTeamRecord(rec) {
  if (!rec.paths.photos) {
    rec.paths.photos = rec.paths.photo ? [{ photo: rec.paths.photo, drawing: rec.paths.drawing || null }] : [];
  }
  if (!Array.isArray(rec.photos)) {
    rec.photos = rec.paths.photos.map((_, i) => (i === 0 && rec.photo ? { photo: rec.photo, drawing: rec.drawing || null } : { photo: null, drawing: null }));
  }
  return rec;
}

// Every online file of a team entry (used when it's removed from the team).
export function teamEntryPaths(rec) {
  upgradeTeamRecord(rec);
  return [rec.paths.thumb, rec.paths.audio, ...rec.paths.photos.flatMap((p) => [p.photo, p.drawing])].filter(Boolean);
}
