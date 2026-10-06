// Team screens.
//   #/team        sign in with Google, your teams, join a team, create a team
//   #/join/CODE   invite link: same screen, with the code filled in
//   #/team/ID     one team: code, invite, members, new code, leave

import { getSettings } from '../settings.js';
import { go, goBack } from '../router.js';
import { isCloudConfigured, getAccount, startGoogleSignIn, friendlyError } from '../cloud.js';
import {
  getTeams, getTeamById, createTeam, joinTeam, refreshTeams, listMembers, removeMember,
  resetJoinCode, leaveTeam, inviteLink, signOut,
} from '../team.js';
import { syncNow, getSyncStatus } from '../sync.js';
import { getAllEntries, putEntry } from '../db.js';
import { esc, confirmDialog, toast } from '../ui.js';

const CODE_LENGTH = 6;

function header(title) {
  return `
    <header class="topbar">
      <button type="button" class="btn btn-ghost" data-act="back">Back</button>
      <h1>${esc(title)}</h1>
      <span class="topbar-spacer"></span>
    </header>`;
}

// Runs a button's action: shows "Working…" text, and any error under the form.
function makeRunner(el) {
  let busy = false;
  const showError = (message) => {
    const box = el.querySelector('.form-error');
    if (!box) return;
    box.textContent = message;
    box.hidden = !message;
  };
  async function run(button, label, action) {
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
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = original;
      }
    }
  }
  return { run, showError };
}

// ======================================================================
// #/team and #/join/CODE
// ======================================================================

export async function renderTeams(el, codeFromLink) {
  const prefill = (codeFromLink || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
  const { run, showError } = makeRunner(el);

  async function draw() {
    if (!isCloudConfigured()) {
      el.innerHTML = `${header('Teams')}
        <main class="page">
          <section class="card">
            <h2 class="section-title">Team sharing isn't set up yet</h2>
            <p>Whoever looks after PitSide needs to connect it to Supabase first (see the README, "Team sharing setup").</p>
            <p class="hint">Everything else in PitSide works without it.</p>
          </section>
        </main>`;
      wireBack();
      return;
    }
    const account = await getAccount();
    if (!account || account.anonymous) {
      el.innerHTML = `${header('Teams')}${signInHtml(account)}`;
      wireBack();
      el.querySelector('[data-act="google"]').addEventListener('click', (e) => {
        run(e.currentTarget, 'Opening Google…', () => startGoogleSignIn(location.hash || '#/team'));
      });
      return;
    }
    el.innerHTML = `${header('Teams')}${signedInHtml(account)}`;
    wireBack();
    wireSignedIn(account);
  }

  function wireBack() {
    el.querySelector('[data-act="back"]').addEventListener('click', () => goBack('#/home'));
  }

  // ---------- Not signed in ----------

  function signInHtml(account) {
    const oldTeams = getTeams();
    return `
      <main class="page team">
        <section class="card">
          <h2 class="section-title">${prefill ? `Sign in to join team ${esc(prefill)}` : 'Sign in to share with your team'}</h2>
          <p>Teams let you see each other's entries. Sign in with your Google account, then create a team or join one with its code.</p>
          ${account && account.anonymous && oldTeams.length ? `
            <p><strong>Your teams now use Google sign-in.</strong> Sign in once and you'll stay in
            ${esc(oldTeams.map((t) => t.teamName).join(', '))}.</p>` : ''}
          <button type="button" class="btn btn-primary btn-block btn-lg" data-act="google">Sign in with Google</button>
          <p class="form-error" role="alert" hidden></p>
          <p class="hint">PitSide only uses your Google account to know who you are: your name and email.
            Teammates see the name you use in PitSide, not your email. Your entries stay on this phone
            unless you share them.</p>
          ${prefill && !matchMedia('(display-mode: standalone)').matches
            ? '<p class="hint">Installed PitSide on your Home Screen? Open it there, sign in, and type the code, so your entries and team are in the same place.</p>' : ''}
        </section>
        <p class="hint">You don't need to sign in to save entries; that always works offline.</p>
      </main>`;
  }

  // ---------- Signed in ----------

  function signedInHtml(account) {
    const teams = getTeams();
    return `
      <main class="page team">
        <section class="card account-card">
          <div>
            <span class="label-small">Signed in with Google</span>
            <strong>${esc(account.name || getSettings().author)}</strong>
            <span class="muted account-email">${esc(account.email)}</span>
          </div>
          <div class="account-buttons">
            <button type="button" class="btn btn-secondary btn-small" data-act="switch-account">Switch account</button>
            <button type="button" class="btn btn-ghost btn-small" data-act="sign-out">Sign out</button>
          </div>
        </section>

        <section class="card">
          <h2 class="section-title">Your teams</h2>
          ${teams.length ? `
            <ul class="team-list">
              ${teams.map((t) => `
                <li><a class="team-row" href="#/team/${encodeURIComponent(t.teamId)}">
                  <span class="team-row-name">${esc(t.teamName)}</span>
                  <span class="muted">${t.role === 'owner' ? 'Owner' : 'Member'} · code ${esc(t.joinCode)}</span>
                </a></li>`).join('')}
            </ul>` : '<p class="muted">You\'re not in a team yet. Join one with a code, or create one below.</p>'}
        </section>

        <section class="card" aria-live="polite" ${teams.length ? '' : 'hidden'}>
          <h2 class="section-title">Sharing</h2>
          <p class="sync-text"></p>
          <button type="button" class="btn btn-secondary" data-act="sync">Sync now</button>
          <div class="share-old" hidden>
            <p class="share-old-text"></p>
            <div class="share-old-row">
              <select class="input" data-share-old-team aria-label="Team to share them with">
                ${teams.map((t) => `<option value="${esc(t.teamId)}">${esc(t.teamName)}</option>`).join('')}
              </select>
              <button type="button" class="btn btn-secondary" data-act="share-old">Share</button>
            </div>
          </div>
        </section>

        <form class="card" data-form="join" novalidate>
          <h2 class="section-title">Join a team</h2>
          <p class="hint">Got a code from a teammate? Type it here.</p>
          <label class="label" for="join-code">Team code</label>
          <input id="join-code" class="input code-input" type="text" inputmode="text" autocomplete="off"
                 autocapitalize="characters" spellcheck="false" maxlength="${CODE_LENGTH}"
                 placeholder="ABC234" value="${esc(prefill)}">
          <button type="submit" class="btn btn-primary btn-block btn-lg">Join team</button>
        </form>

        <form class="card" data-form="create" novalidate>
          <h2 class="section-title">Create a team</h2>
          <p class="hint">Starting a new team? Create it here and PitSide gives you a code to send to your teammates.</p>
          <label class="label" for="team-name">Team name</label>
          <input id="team-name" class="input" type="text" maxlength="60" autocomplete="off"
                 autocapitalize="words" placeholder="e.g. VEX 1234A">
          <button type="submit" class="btn btn-secondary btn-block btn-lg">Create team</button>
        </form>

        <p class="form-error" role="alert" hidden></p>
        <p class="hint">Teammates see you as <strong>${esc(getSettings().author)}</strong>. You can change your name in Settings.</p>
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
    else text = s.lastSynced ? 'Everything you shared is uploaded.' : 'Tap Sync now to get your teams\' latest entries.';
    box.textContent = text;

    // Entries saved before joining a team: offer to share them with one.
    const older = (await getAllEntries()).filter((e) => e.shareTeam === undefined);
    const wrap = el.querySelector('.share-old');
    if (!wrap) return;
    wrap.hidden = older.length === 0;
    el.querySelector('.share-old-text').textContent = `You have ${older.length} earlier ${older.length === 1 ? 'entry' : 'entries'} that ${older.length === 1 ? 'isn\'t' : 'aren\'t'} shared. Share them with:`;
  }

  function wireSignedIn(account) {
    const $ = (s) => el.querySelector(s);
    showSync();

    $('[data-act="sign-out"]').addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Sign out?',
        message: 'You stay in your teams; sign in again to see them. Entries stay on this phone. Shared entries that haven\'t uploaded yet will upload after you sign in again.',
        confirmText: 'Sign out',
      });
      if (!ok) return;
      await signOut();
      toast('Signed out');
      await draw();
    });

    // Sign out, then straight to Google's account picker to choose another account.
    $('[data-act="switch-account"]').addEventListener('click', async (e) => {
      const button = e.currentTarget;
      const ok = await confirmDialog({
        title: 'Switch Google account?',
        message: `You'll be signed out of ${account.email} and can pick another account. Your entries stay on this phone; anything waiting to upload to ${account.email}'s teams waits until that account signs in again.`,
        confirmText: 'Switch account',
      });
      if (!ok) return;
      run(button, 'Opening Google…', async () => {
        await signOut();
        await startGoogleSignIn('#/team');
      });
    });

    $('[data-act="sync"]').addEventListener('click', (e) => {
      run(e.currentTarget, 'Syncing…', async () => {
        await syncNow();
        const s = getSyncStatus();
        if (s.state === 'error') throw new Error(s.error);
        toast('Up to date');
        await draw();
      });
    });

    $('[data-act="share-old"]').addEventListener('click', async () => {
      const teamId = $('[data-share-old-team]').value;
      const team = getTeamById(teamId);
      const older = (await getAllEntries()).filter((e) => e.shareTeam === undefined);
      const ok = await confirmDialog({
        title: `Share ${older.length} ${older.length === 1 ? 'entry' : 'entries'} with ${team.teamName}?`,
        message: 'Your teammates will be able to see them. You can change who sees an entry by editing it.',
        confirmText: 'Share',
      });
      if (!ok) return;
      for (const entry of older) await putEntry({ ...entry, shareTeam: teamId, sync: 'pending' });
      toast('Uploading when online');
      syncNow();
      showSync();
    });

    const codeInput = $('#join-code');
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });

    $('[data-form="join"]').addEventListener('submit', (e) => {
      e.preventDefault();
      const code = codeInput.value.trim();
      if (code.length !== CODE_LENGTH) { showError(`The team code has ${CODE_LENGTH} letters and numbers.`); return; }
      run(e.target.querySelector('button'), 'Joining…', async () => {
        const team = await joinTeam(code, getSettings().author);
        toast(`You joined ${team.teamName}`);
        syncNow();
        go(`#/team/${encodeURIComponent(team.teamId)}`, { replace: location.hash.startsWith('#/join/') });
      });
    });

    $('[data-form="create"]').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = $('#team-name').value.trim();
      if (!name) { showError('Type a team name.'); return; }
      run(e.target.querySelector('button'), 'Creating…', async () => {
        const team = await createTeam(name, getSettings().author);
        toast('Team created. Share the code with your teammates.');
        go(`#/team/${encodeURIComponent(team.teamId)}`);
      });
    });
  }

  const onSync = () => showSync();
  window.addEventListener('pitside-sync', onSync);

  await draw();
  // Bring the team list up to date (e.g. joined on another phone).
  const account = await getAccount();
  if (account && !account.anonymous && navigator.onLine) {
    refreshTeams().then(() => { if (el.isConnected && !el.querySelector('input:focus')) draw(); }).catch(() => {});
  }

  return { unmount: () => window.removeEventListener('pitside-sync', onSync) };
}

// ======================================================================
// #/team/ID: one team
// ======================================================================

export async function renderTeamDetail(el, teamId) {
  const { run, showError } = makeRunner(el);
  const account = await getAccount();

  function draw() {
    const team = getTeamById(teamId);
    if (!team) {
      el.innerHTML = `${header('Team')}
        <main class="page"><p>You're not in this team any more.</p>
          <a class="btn btn-primary btn-block" href="#/team">Your teams</a></main>`;
      el.querySelector('[data-act="back"]').addEventListener('click', () => goBack('#/team'));
      return;
    }
    const owner = team.role === 'owner';
    el.innerHTML = `${header(team.teamName)}
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
          <p class="hint">Teammates open the link, or open PitSide, tap Team, sign in and type the code.</p>
          ${owner ? '<button type="button" class="btn btn-ghost btn-small" data-act="reset-code">Make a new code</button>' : ''}
        </section>

        <section class="card">
          <h2 class="section-title">Members</h2>
          <ul class="member-list"><li class="muted">Loading…</li></ul>
        </section>

        <p class="form-error" role="alert" hidden></p>
        <button type="button" class="btn btn-danger btn-block" data-act="leave">Leave ${esc(team.teamName)}</button>
      </main>`;
    wire(team);
  }

  async function showMembers(team) {
    const list = el.querySelector('.member-list');
    try {
      const members = await listMembers(team.teamId);
      list.innerHTML = members.map((m) => `
        <li class="member">
          <span class="member-name">${esc(m.display_name)}${account && m.user_id === account.userId ? ' (you)' : ''}</span>
          ${m.role === 'owner' ? '<span class="stage-tag">Owner</span>' : ''}
          ${team.role === 'owner' && account && m.user_id !== account.userId
            ? `<button type="button" class="btn btn-ghost btn-small btn-danger-text" data-remove="${esc(m.user_id)}" data-name="${esc(m.display_name)}">Remove</button>` : ''}
        </li>`).join('');
      el.dataset.memberCount = String(members.length);
    } catch (err) {
      list.innerHTML = `<li class="muted">${esc(navigator.onLine ? friendlyError(err) : 'Connect to the internet to see members.')}</li>`;
    }
  }

  function wire(team) {
    const $ = (s) => el.querySelector(s);
    $('[data-act="back"]').addEventListener('click', () => goBack('#/team'));
    showMembers(team);

    const shareBtn = $('[data-act="share-invite"]');
    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        try {
          await navigator.share({
            title: `Join ${team.teamName} on PitSide`,
            text: `Join "${team.teamName}" on PitSide. Team code: ${team.joinCode}`,
            url: inviteLink(team.joinCode),
          });
        } catch (err) {
          if (err.name !== 'AbortError') toast('Couldn\'t open sharing. Use Copy invite link.');
        }
      });
    }

    $('[data-act="copy-invite"]').addEventListener('click', async () => {
      const text = `Join "${team.teamName}" on PitSide: ${inviteLink(team.joinCode)} (team code ${team.joinCode})`;
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
        run(resetBtn, 'Making code…', async () => {
          await resetJoinCode(team.teamId);
          toast('New code ready');
          draw();
        });
      });
    }

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
      run(btn, 'Removing…', async () => {
        await removeMember(team.teamId, btn.dataset.remove);
        toast(`${btn.dataset.name} removed`);
        await showMembers(team);
      });
    });

    $('[data-act="leave"]').addEventListener('click', async (e) => {
      const button = e.currentTarget;
      const lastMember = Number(el.dataset.memberCount || 0) === 1;
      const ok = await confirmDialog({
        title: `Leave ${team.teamName}?`,
        message: lastMember
          ? 'You are the only member. Leaving deletes the team and all its shared entries online. Your entries stay on this phone.'
          : 'You will stop seeing this team\'s entries. Entries you shared stay with the team. Your entries stay on this phone.',
        confirmText: lastMember ? 'Delete team' : 'Leave',
        danger: true,
      });
      if (!ok) return;
      run(button, 'Leaving…', async () => {
        await leaveTeam(team.teamId, { lastMember });
        toast(lastMember ? 'Team deleted' : `You left ${team.teamName}`);
        go('#/team', { replace: true });
      });
    });
  }

  draw();
  return {};
}
