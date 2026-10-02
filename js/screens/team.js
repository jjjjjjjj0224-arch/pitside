// Team screen: create a team, join with a code (or invite link #/join/CODE),
// share the invite, see members, and leave.

import { getSettings } from '../settings.js';
import { goBack } from '../router.js';
import { isCloudConfigured, friendlyError } from '../cloud.js';
import {
  getTeam, createTeam, joinTeam, listMembers, removeMember, resetJoinCode, leaveTeam, inviteLink,
} from '../team.js';
import { syncNow, getSyncStatus } from '../sync.js';
import { getAllEntries, putEntry } from '../db.js';
import { esc, confirmDialog, toast } from '../ui.js';

const CODE_LENGTH = 6;

export async function renderTeam(el, codeFromLink) {
  const prefill = (codeFromLink || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
  let busy = false;

  function header() {
    return `
      <header class="topbar">
        <button type="button" class="btn btn-ghost" data-act="back">Back</button>
        <h1>Team</h1>
        <span class="topbar-spacer"></span>
      </header>`;
  }

  async function draw() {
    const team = getTeam();
    if (!isCloudConfigured()) {
      el.innerHTML = `${header()}
        <main class="page">
          <section class="card">
            <h2 class="section-title">Team sharing isn't set up yet</h2>
            <p>Whoever looks after PitSide needs to connect it to Supabase first (see the README, "Team sharing setup").</p>
            <p class="hint">Everything else in PitSide works without it.</p>
          </section>
        </main>`;
    } else if (!team) {
      el.innerHTML = `${header()}${notInTeamHtml()}`;
      wireNotInTeam();
    } else {
      el.innerHTML = `${header()}${inTeamHtml(team)}`;
      wireInTeam(team);
    }
    el.querySelector('[data-act="back"]').addEventListener('click', () => goBack('#/home'));
  }

  // ---------- Not in a team ----------

  function notInTeamHtml() {
    const name = getSettings().author;
    return `
      <main class="page team">
        <p>Join your team to see each other's entries. Entries you share are uploaded for your team; they stay on your phone too.</p>

        <form class="card" data-form="join" novalidate>
          <h2 class="section-title">Join a team</h2>
          <label class="label" for="join-code">Team code</label>
          <input id="join-code" class="input code-input" type="text" inputmode="text" autocomplete="off"
                 autocapitalize="characters" spellcheck="false" maxlength="${CODE_LENGTH}"
                 placeholder="ABC234" value="${esc(prefill)}">
          <button type="submit" class="btn btn-primary btn-block btn-lg">Join team</button>
        </form>

        <form class="card" data-form="create" novalidate>
          <h2 class="section-title">Or create a team</h2>
          <label class="label" for="team-name">Team name</label>
          <input id="team-name" class="input" type="text" maxlength="60" autocomplete="off"
                 autocapitalize="words" placeholder="e.g. VEX 1234A">
          <button type="submit" class="btn btn-secondary btn-block btn-lg">Create team</button>
        </form>

        <p class="form-error" role="alert" hidden></p>
        <p class="hint">Teammates will see you as <strong>${esc(name)}</strong>. You can change your name in Settings.</p>
        ${location.hash.startsWith('#/join/') && !matchMedia('(display-mode: standalone)').matches
          ? '<p class="hint">Installed PitSide on your Home Screen? Open it there and type the code, so your entries and team are in the same place.</p>' : ''}
      </main>`;
  }

  function showError(message) {
    const box = el.querySelector('.form-error');
    box.textContent = message;
    box.hidden = !message;
  }

  async function runAction(button, label, action) {
    if (busy) return;
    if (!navigator.onLine) { showError('No internet connection. Try again when you\'re online.'); return; }
    busy = true;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = label;
    showError('');
    try {
      await action();
    } catch (err) {
      console.warn(err);
      showError(friendlyError(err));
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = original;
    }
  }

  function wireNotInTeam() {
    const codeInput = el.querySelector('#join-code');
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });

    el.querySelector('[data-form="join"]').addEventListener('submit', (e) => {
      e.preventDefault();
      const code = codeInput.value.trim();
      if (code.length !== CODE_LENGTH) { showError(`The team code has ${CODE_LENGTH} letters and numbers.`); return; }
      runAction(e.target.querySelector('button'), 'Joining…', async () => {
        const team = await joinTeam(code, getSettings().author);
        toast(`You joined ${team.teamName}`);
        history.replaceState(history.state, '', '#/team');
        await draw();
        syncNow();
      });
    });

    el.querySelector('[data-form="create"]').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = el.querySelector('#team-name').value.trim();
      if (!name) { showError('Type a team name.'); return; }
      runAction(e.target.querySelector('button'), 'Creating…', async () => {
        await createTeam(name, getSettings().author);
        toast('Team created. Share the code with your teammates.');
        history.replaceState(history.state, '', '#/team');
        await draw();
      });
    });
  }

  // ---------- In a team ----------

  function inTeamHtml(team) {
    const owner = team.role === 'owner';
    return `
      <main class="page team">
        <section class="card">
          <h2 class="team-name">${esc(team.teamName)}</h2>
          <p class="muted">You are ${owner ? 'the owner' : 'a member'} · you appear as ${esc(team.displayName)}</p>
          <div class="code-box">
            <span class="label-small">Team code</span>
            <span class="team-code" aria-label="Team code ${esc(team.joinCode.split('').join(' '))}">${esc(team.joinCode)}</span>
          </div>
          <div class="button-row">
            ${navigator.share ? '<button type="button" class="btn btn-primary" data-act="share-invite">Share invite</button>' : ''}
            <button type="button" class="btn btn-secondary" data-act="copy-invite">Copy invite link</button>
          </div>
          <p class="hint">Teammates open the link, or open PitSide, tap Team and type the code.</p>
          ${owner ? '<button type="button" class="btn btn-ghost btn-small" data-act="reset-code">Make a new code</button>' : ''}
        </section>

        <section class="card" aria-live="polite">
          <h2 class="section-title">Sharing</h2>
          <p class="sync-text"></p>
          <div class="button-row">
            <button type="button" class="btn btn-secondary" data-act="sync">Sync now</button>
          </div>
          <button type="button" class="btn btn-secondary btn-block" data-act="share-old" hidden></button>
        </section>

        <section class="card">
          <h2 class="section-title">Members</h2>
          <ul class="member-list"><li class="muted">Loading…</li></ul>
        </section>

        <p class="form-error" role="alert" hidden></p>
        <button type="button" class="btn btn-danger btn-block" data-act="leave">Leave team</button>
      </main>`;
  }

  async function showSync() {
    const box = el.querySelector('.sync-text');
    if (!box) return;
    const s = getSyncStatus();
    let text;
    if (s.state === 'syncing') text = 'Syncing…';
    else if (s.state === 'offline' || !navigator.onLine) text = s.pending ? `Offline. ${s.pending} waiting to upload when you're back online.` : 'Offline. New shared entries upload when you\'re back online.';
    else if (s.state === 'error') text = `Couldn't sync: ${s.error}`;
    else if (s.pending) text = `${s.pending} waiting to upload.`;
    else text = s.lastSynced ? 'Everything you shared is uploaded.' : 'Tap Sync now to get the team\'s latest entries.';
    box.textContent = text;

    // Entries saved before joining (never shared or not shared): offer to share them.
    const older = (await getAllEntries()).filter((e) => e.shared === undefined);
    const btn = el.querySelector('[data-act="share-old"]');
    if (!btn) return;
    btn.hidden = older.length === 0;
    btn.textContent = `Share my ${older.length} earlier ${older.length === 1 ? 'entry' : 'entries'} with the team`;
  }

  async function showMembers(team) {
    const list = el.querySelector('.member-list');
    try {
      const members = await listMembers();
      list.innerHTML = members.map((m) => `
        <li class="member">
          <span class="member-name">${esc(m.display_name)}${m.user_id === team.userId ? ' (you)' : ''}</span>
          ${m.role === 'owner' ? '<span class="stage-tag">Owner</span>' : ''}
          ${team.role === 'owner' && m.user_id !== team.userId
            ? `<button type="button" class="btn btn-ghost btn-small btn-danger-text" data-remove="${esc(m.user_id)}" data-name="${esc(m.display_name)}">Remove</button>` : ''}
        </li>`).join('');
      el.dataset.memberCount = String(members.length);
    } catch (err) {
      list.innerHTML = `<li class="muted">${esc(navigator.onLine ? friendlyError(err) : 'Connect to the internet to see members.')}</li>`;
    }
  }

  function wireInTeam(team) {
    const $ = (s) => el.querySelector(s);
    showSync();
    showMembers(team);

    const shareBtn = $('[data-act="share-invite"]');
    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        try {
          await navigator.share({
            title: `Join ${team.teamName} on PitSide`,
            text: `Join "${team.teamName}" on PitSide. Team code: ${team.joinCode}`,
            url: inviteLink(),
          });
        } catch (err) {
          if (err.name !== 'AbortError') toast('Couldn\'t open sharing. Use Copy invite link.');
        }
      });
    }

    $('[data-act="copy-invite"]').addEventListener('click', async () => {
      const text = `Join "${team.teamName}" on PitSide: ${inviteLink()} (team code ${team.joinCode})`;
      try {
        await navigator.clipboard.writeText(text);
        toast('Invite link copied');
      } catch {
        window.prompt('Copy this invite:', text);
      }
    });

    const resetBtn = $('[data-act="reset-code"]');
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Make a new team code?',
          message: 'The old code and invite links stop working. People already in the team stay in it.',
          confirmText: 'New code',
        });
        if (!ok) return;
        runAction(resetBtn, 'Making code…', async () => {
          await resetJoinCode();
          toast('New code ready');
          await draw();
        });
      });
    }

    $('[data-act="sync"]').addEventListener('click', (e) => {
      if (!navigator.onLine) { showError('No internet connection. Try again when you\'re online.'); return; }
      runAction(e.currentTarget, 'Syncing…', async () => {
        await syncNow();
        const s = getSyncStatus();
        if (s.state === 'error') throw new Error(s.error);
        toast('Up to date');
        showMembers(getTeam() || team);
      });
    });

    $('[data-act="share-old"]').addEventListener('click', async () => {
      const older = (await getAllEntries()).filter((e) => e.shared === undefined);
      const ok = await confirmDialog({
        title: `Share ${older.length} earlier ${older.length === 1 ? 'entry' : 'entries'}?`,
        message: 'Your teammates will be able to see them. You can turn sharing off for any entry by editing it.',
        confirmText: 'Share',
      });
      if (!ok) return;
      for (const entry of older) await putEntry({ ...entry, shared: true, sync: 'pending' });
      toast('Uploading when online');
      syncNow();
      showSync();
    });

    el.querySelector('.member-list').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-remove]');
      if (!btn) return;
      const ok = await confirmDialog({
        title: `Remove ${btn.dataset.name}?`,
        message: 'They will no longer see the team. Entries they already shared stay with the team.',
        confirmText: 'Remove',
        danger: true,
      });
      if (!ok) return;
      runAction(btn, 'Removing…', async () => {
        await removeMember(btn.dataset.remove);
        toast(`${btn.dataset.name} removed`);
        await showMembers(team);
      });
    });

    $('[data-act="leave"]').addEventListener('click', async (e) => {
      const button = e.currentTarget;
      const count = Number(el.dataset.memberCount || 0);
      const lastMember = count === 1;
      const ok = await confirmDialog({
        title: `Leave ${team.teamName}?`,
        message: lastMember
          ? 'You are the only member. Leaving deletes the team and all its shared entries online. Your entries stay on this phone.'
          : 'You will stop seeing the team\'s entries. Entries you shared stay with the team. Your entries stay on this phone.',
        confirmText: lastMember ? 'Delete team' : 'Leave',
        danger: true,
      });
      if (!ok) return;
      runAction(button, 'Leaving…', async () => {
        await leaveTeam({ lastMember });
        toast(lastMember ? 'Team deleted' : 'You left the team');
        await draw();
      });
    });
  }

  // Keep the sync status up to date while this screen is open.
  const onSync = () => showSync();
  window.addEventListener('pitside-sync', onSync);

  await draw();
  if (getTeam() && navigator.onLine) syncNow();

  return {
    unmount() {
      window.removeEventListener('pitside-sync', onSync);
    },
  };
}
