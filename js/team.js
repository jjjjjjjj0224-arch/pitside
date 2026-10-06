// Your teams, and the team actions (create, join, leave, members, new code).
// You can be in several teams. Signing in with Google on a new phone brings
// your teams back, because they belong to your Google account.
//
// The list is also kept on the phone, so the app knows your teams offline:
//   [{ teamId, teamName, joinCode, role: 'owner' | 'member', displayName }]

import { readKey, writeKey, deleteKey, getAllEntries, putEntry, getAllTeamEntries, deleteTeamEntry, clearTeamEntries } from './db.js';
import { getAccount, rpc, table, files, CloudError, isCloudConfigured, signOut as cloudSignOut } from './cloud.js';

let teams = [];

export async function loadTeams() {
  if (!isCloudConfigured()) { teams = []; return teams; }
  teams = (await readKey('teams')) || [];
  // PitSide v1.1/1.2 kept a single team under "team": move it into the list.
  const old = await readKey('team');
  if (old && old.teamId) {
    if (!teams.some((t) => t.teamId === old.teamId)) {
      teams.push({ teamId: old.teamId, teamName: old.teamName, joinCode: old.joinCode, role: old.role, displayName: old.displayName });
    }
    // Entries shared under v1.1/1.2 ("shared: true") were shared with that team.
    for (const e of await getAllEntries()) {
      if (e.shareTeam !== undefined || e.shared === undefined) continue;
      const shareTeam = e.shared === true ? (e.remote && e.remote.teamId) || old.teamId : null;
      const { shared, ...rest } = e;
      await putEntry({ ...rest, shareTeam });
    }
    await writeKey('teams', teams);
    await deleteKey('team');
  }
  return teams;
}

// All my teams (synchronous; loaded at start-up).
export function getTeams() {
  return teams;
}

export function getTeamById(teamId) {
  return teams.find((t) => t.teamId === teamId) || null;
}

async function setTeams(next) {
  teams = next;
  await writeKey('teams', teams);
  window.dispatchEvent(new CustomEvent('pitside-team', { detail: teams }));
}

function fromTeamRow(t, role, displayName) {
  return { teamId: t.id, teamName: t.name, joinCode: t.join_code, role, displayName };
}

async function requireAccount() {
  const account = await getAccount();
  if (!account || account.anonymous) throw new CloudError('need_google_sign_in', 401, 'need_google_sign_in');
  return account;
}

export async function createTeam(teamName, displayName) {
  await requireAccount();
  const t = await rpc('create_team', { team_name: teamName, member_name: displayName });
  const team = fromTeamRow(t, 'owner', displayName);
  await setTeams([...teams, team]);
  return team;
}

export async function joinTeam(code, displayName) {
  await requireAccount();
  const t = await rpc('join_team', { code, member_name: displayName });
  if (!t || !t.id) throw new CloudError('bad_code', 404, 'bad_code');
  const existing = getTeamById(t.id);
  const team = fromTeamRow(t, existing ? existing.role : 'member', displayName);
  await setTeams([...teams.filter((x) => x.teamId !== t.id), team]);
  return team;
}

// Ask the server which teams I'm in (names, codes or roles may have changed,
// I may have been removed, or I may have joined on another phone).
// Returns the up-to-date list.
export async function refreshTeams() {
  const account = await getAccount();
  if (!account) return teams;
  const rows = await table.select('team_members', `user_id=eq.${account.userId}&select=role,display_name,teams(id,name,join_code)`);
  const next = (rows || []).filter((r) => r.teams).map((r) => fromTeamRow(r.teams, r.role, r.display_name));
  const removed = teams.filter((t) => !next.some((n) => n.teamId === t.teamId));
  for (const t of removed) {
    await forgetTeam(t.teamId);
    window.dispatchEvent(new CustomEvent('pitside-removed', { detail: t }));
  }
  if (JSON.stringify(next) !== JSON.stringify(teams)) await setTeams(next);
  return teams;
}

export async function listMembers(teamId) {
  return table.select('team_members', `team_id=eq.${teamId}&select=user_id,display_name,role,joined_at&order=joined_at`);
}

export async function removeMember(teamId, userId) {
  await table.remove('team_members', `team_id=eq.${teamId}&user_id=eq.${userId}`);
}

export async function resetJoinCode(teamId) {
  const code = await rpc('reset_join_code', { team: teamId });
  await setTeams(teams.map((t) => (t.teamId === teamId ? { ...t, joinCode: code } : t)));
  return code;
}

// Change the name teammates see for me (in all my teams).
export async function renameMe(name) {
  if (!teams.length) return;
  await rpc('set_display_name', { member_name: name });
  await setTeams(teams.map((t) => ({ ...t, displayName: name })));
}

// Leave one team. My shared entries stay with that team (unless I'm the last
// member: then the team and all its shared entries and files are deleted).
export async function leaveTeam(teamId, { lastMember = false } = {}) {
  if (lastMember) {
    // Delete the team's files first (the database rows go with the team).
    const rows = await table.select('entries', `team_id=eq.${teamId}&select=photo_path,drawing_path,thumb_path,audio_path,photos`);
    const paths = rows.flatMap((r) => [
      r.photo_path, r.drawing_path, r.thumb_path, r.audio_path,
      ...((r.photos || []).flatMap((p) => [p.photo, p.drawing])),
    ]).filter(Boolean);
    for (let i = 0; i < paths.length; i += 100) await files.remove(paths.slice(i, i + 100));
  }
  await rpc('leave_team', { team: teamId });
  await forgetTeam(teamId);
}

// Forget one team on this phone: my entries stay, but are no longer linked to it.
async function forgetTeam(teamId) {
  for (const e of await getAllEntries()) {
    const linked = e.shareTeam === teamId || (e.remote && e.remote.teamId === teamId);
    if (linked) await putEntry({ ...e, shareTeam: e.shareTeam === teamId ? null : e.shareTeam, remote: null, sync: null });
  }
  for (const rec of await getAllTeamEntries()) {
    if (rec.teamId === teamId) await deleteTeamEntry(rec.id);
  }
  const deletes = ((await readKey('pendingDeletes')) || []).filter((d) => d.teamId !== teamId);
  await writeKey('pendingDeletes', deletes);
  await setTeams(teams.filter((t) => t.teamId !== teamId));
}

// Sign out of Google on this phone. I stay a member of my teams (signing in
// again brings them back); my entries stay on the phone.
export async function signOut() {
  await cloudSignOut();
  await clearTeamEntries();
  await setTeams([]);
}

// The link people tap to join (it opens PitSide with the code filled in).
export function inviteLink(code) {
  return `${location.origin}${location.pathname}#/join/${code}`;
}
