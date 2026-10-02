// Which team this phone is in, and the team actions (create, join, leave...).
//
// The team info is also kept on the phone, so the app knows its team when offline:
//   { teamId, teamName, joinCode, role: 'owner' | 'member', userId, displayName }

import { readKey, writeKey, deleteKey, getAllEntries, putEntry, clearTeamEntries } from './db.js';
import { ensureSignedIn, getUserId, rpc, table, files, CloudError, isCloudConfigured } from './cloud.js';

let state = null;

export async function loadTeam() {
  state = isCloudConfigured() ? (await readKey('team')) || null : null;
  return state;
}

// Synchronous: the team loaded at start-up (null = not in a team).
export function getTeam() {
  return state;
}

async function setTeam(next) {
  state = next;
  if (next) await writeKey('team', next);
  else await deleteKey('team');
  window.dispatchEvent(new CustomEvent('pitside-team', { detail: next }));
}

function fromTeamRow(t, role, userId, displayName) {
  return { teamId: t.id, teamName: t.name, joinCode: t.join_code, role, userId, displayName };
}

export async function createTeam(teamName, displayName) {
  const userId = await ensureSignedIn();
  const t = await rpc('create_team', { team_name: teamName, member_name: displayName });
  await setTeam(fromTeamRow(t, 'owner', userId, displayName));
  return state;
}

export async function joinTeam(code, displayName) {
  const userId = await ensureSignedIn();
  const t = await rpc('join_team', { code, member_name: displayName });
  if (!t || !t.id) throw new CloudError('bad_code', 404, 'bad_code');
  await setTeam(fromTeamRow(t, 'member', userId, displayName));
  return state;
}

// Ask the server what team we're in (name, code or owner may have changed,
// or the owner may have removed us). Returns the team, or null if not in one.
export async function refreshTeam() {
  if (!state) return null;
  const userId = await getUserId();
  const rows = userId
    ? await table.select('team_members', `user_id=eq.${userId}&select=role,display_name,teams(id,name,join_code)`)
    : [];
  const row = rows && rows[0];
  if (!row || !row.teams) {
    await forgetTeam();
    window.dispatchEvent(new CustomEvent('pitside-removed'));
    return null;
  }
  const next = fromTeamRow(row.teams, row.role, userId, row.display_name);
  if (JSON.stringify(next) !== JSON.stringify(state)) await setTeam(next);
  return state;
}

export async function listMembers() {
  return table.select('team_members', `team_id=eq.${state.teamId}&select=user_id,display_name,role,joined_at&order=joined_at`);
}

export async function removeMember(userId) {
  await table.remove('team_members', `team_id=eq.${state.teamId}&user_id=eq.${userId}`);
}

export async function resetJoinCode() {
  const code = await rpc('reset_join_code', { team: state.teamId });
  await setTeam({ ...state, joinCode: code });
  return code;
}

export async function renameMe(name) {
  if (!state) return;
  await rpc('set_display_name', { member_name: name });
  await setTeam({ ...state, displayName: name });
}

// Leave the team. Your shared entries stay with the team (unless you are the
// last member: then the team and all its shared entries and files are deleted).
export async function leaveTeam({ lastMember = false } = {}) {
  if (lastMember) {
    // Delete the team's files first (the database rows go with the team).
    const rows = await table.select('entries', `team_id=eq.${state.teamId}&select=photo_path,drawing_path,thumb_path,audio_path`);
    const paths = rows.flatMap((r) => [r.photo_path, r.drawing_path, r.thumb_path, r.audio_path]).filter(Boolean);
    for (let i = 0; i < paths.length; i += 100) await files.remove(paths.slice(i, i + 100));
  }
  await rpc('leave_team');
  await forgetTeam();
}

// Forget the team on this phone: entries stay, but are no longer linked to it,
// so they won't upload to a future team unless you share them again.
async function forgetTeam() {
  for (const e of await getAllEntries()) {
    if (e.remote || e.shared !== undefined || e.sync) {
      await putEntry({ ...e, remote: null, shared: undefined, sync: null });
    }
  }
  await clearTeamEntries();
  await deleteKey('pendingDeletes');
  await setTeam(null);
}

// The link people tap to join (it opens PitSide with the code filled in).
export function inviteLink(code = state && state.joinCode) {
  return `${location.origin}${location.pathname}#/join/${code}`;
}
