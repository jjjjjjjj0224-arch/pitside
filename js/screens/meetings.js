// Meeting log screens: the list (#/meetings, grouped by week, with a summary slide
// per week) and one meeting (#/meeting/new or #/meeting/<id>).

import { getAllEntries, getAllTeamEntries } from '../db.js';
import { getSettings } from '../settings.js';
import { getTeams } from '../team.js';
import { go, goBack } from '../router.js';
import { shareOrDownload } from '../exporter.js';
import {
  listMeetings, getMeeting, saveMeeting, deleteMeeting, meetingsByWeek, entriesInWeek, weekSlide, weekLabel, toDay,
} from '../meetings.js';
import { esc, confirmDialog, toast } from '../ui.js';

// My entries plus my teams' entries (each once): what the team did that week.
async function allEntries() {
  const mine = await getAllEntries();
  const ids = new Set(mine.map((e) => e.id));
  const team = getTeams().length ? (await getAllTeamEntries()).filter((e) => !ids.has(e.id)) : [];
  return [...mine, ...team];
}

const prettyDate = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

export async function renderMeetings(el) {
  const weeks = meetingsByWeek(await listMeetings());
  el.innerHTML = `
    <header class="topbar">
      <button type="button" class="btn btn-ghost" data-act="back">Back</button>
      <h1>Meetings</h1>
      <span class="topbar-spacer"></span>
    </header>
    <main class="page meetings">
      <a class="btn btn-primary btn-block btn-lg" href="#/meeting/new">New meeting</a>
      <p class="hint">Who came, the goals, what got done. Each week can become one summary slide,
        with the entries made that week. They're also in Export.</p>
      ${weeks.length ? weeks.map((w) => `
        <section class="card">
          <div class="template-head">
            <h2 class="section-title">${esc(weekLabel(w.start))}</h2>
            <button type="button" class="btn btn-secondary btn-small" data-week="${w.start}">Week slide</button>
          </div>
          <ul class="meeting-list">
            ${w.meetings.map((m) => `
              <li><a class="meeting-row" href="#/meeting/${encodeURIComponent(m.id)}">
                <strong>${esc(prettyDate(m.date))}</strong>
                <span class="muted">${esc((m.attendees || []).join(', ') || 'No one listed')}</span>
                <span>${esc(((m.goals || m.done || '').split('\n')[0]) || '')}</span>
              </a></li>`).join('')}
          </ul>
        </section>`).join('') : '<p class="empty-state">No meetings yet.</p>'}
    </main>`;

  el.querySelector('[data-act="back"]').addEventListener('click', () => goBack('#/home'));
  el.querySelectorAll('[data-week]').forEach((btn) => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const week = weeks.find((w) => w.start === btn.dataset.week);
      const png = await weekSlide(week.start, week.meetings, entriesInWeek(await allEntries(), week.start));
      const file = new File([png], `week_of_${week.start}.png`, { type: 'image/png' });
      const r = await shareOrDownload(file, weekLabel(week.start), { preferDownload: true });
      if (r === 'retry') toast('Ready. Tap again to save.');
    } finally {
      btn.disabled = false;
    }
  }));
  return {};
}

export async function renderMeetingEdit(el, id) {
  const existing = id === 'new' ? null : await getMeeting(id);
  if (id !== 'new' && !existing) {
    el.innerHTML = '<main class="page"><h1>Meeting not found</h1><a class="btn btn-primary btn-block" href="#/meetings">Meetings</a></main>';
    return {};
  }
  const settings = getSettings();
  const m = existing
    ? { ...existing, attendees: [...(existing.attendees || [])] }
    : { date: toDay(new Date()), attendees: settings.author ? [settings.author] : [], goals: '', done: '', next: '' };

  // Names to tick: me, people from earlier meetings, and teammates who shared entries.
  const past = (await listMeetings()).flatMap((x) => x.attendees || []);
  const teamAuthors = getTeams().length ? (await getAllTeamEntries()).map((e) => e.author) : [];
  let names = [...new Set([settings.author, ...m.attendees, ...past, ...teamAuthors].filter(Boolean))];
  let dirty = false;

  el.innerHTML = `
    <header class="topbar">
      <button type="button" class="btn btn-ghost" data-act="back">Back</button>
      <h1>${existing ? 'Meeting' : 'New meeting'}</h1>
      <span class="topbar-spacer"></span>
    </header>
    <main class="page meeting-edit">
      <label class="mini-field"><span class="label">Date</span>
        <input class="input" type="date" data-m="date" value="${esc(m.date)}"></label>
      <fieldset class="field">
        <legend class="label">Who came</legend>
        <div class="chips attendee-chips" role="group" aria-label="Who came"></div>
        <div class="search-row">
          <label class="sr-only" for="new-attendee">Add someone</label>
          <input id="new-attendee" class="input" type="text" maxlength="60" placeholder="Add someone" autocapitalize="words">
          <button type="button" class="btn btn-secondary" data-act="add-person">Add</button>
        </div>
      </fieldset>
      <label class="mini-field"><span class="label">Goals for today</span>
        <textarea class="input textarea" rows="3" data-m="goals" maxlength="3000">${esc(m.goals)}</textarea></label>
      <label class="mini-field"><span class="label">What got done</span>
        <textarea class="input textarea" rows="3" data-m="done" maxlength="3000">${esc(m.done)}</textarea></label>
      <label class="mini-field"><span class="label">Next time</span>
        <textarea class="input textarea" rows="2" data-m="next" maxlength="3000">${esc(m.next)}</textarea></label>
      <p class="form-error" role="alert" hidden></p>
      <div class="button-row">
        <button type="button" class="btn btn-primary btn-lg" data-act="save">Save</button>
        ${existing ? '<button type="button" class="btn btn-danger" data-act="delete">Delete</button>' : ''}
      </div>
    </main>`;

  const $ = (s) => el.querySelector(s);
  function drawPeople() {
    $('.attendee-chips').innerHTML = names.map((n) => `
      <button type="button" class="chip" data-person="${esc(n)}" aria-pressed="${m.attendees.includes(n)}">${esc(n)}</button>`).join('');
  }
  $('.attendee-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-person]');
    if (!chip) return;
    const n = chip.dataset.person;
    m.attendees = m.attendees.includes(n) ? m.attendees.filter((x) => x !== n) : [...m.attendees, n];
    dirty = true;
    drawPeople();
  });
  const addPerson = () => {
    const input = $('#new-attendee');
    const n = input.value.trim();
    if (!n) return;
    if (!names.includes(n)) names = [...names, n];
    if (!m.attendees.includes(n)) m.attendees.push(n);
    input.value = '';
    dirty = true;
    drawPeople();
  };
  $('[data-act="add-person"]').addEventListener('click', addPerson);
  $('#new-attendee').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addPerson(); } });
  el.querySelectorAll('[data-m]').forEach((input) => input.addEventListener('input', () => {
    m[input.dataset.m] = input.value;
    dirty = true;
  }));

  $('[data-act="save"]').addEventListener('click', async () => {
    if (!m.date) {
      const err = $('.form-error');
      err.textContent = 'Pick the date of the meeting.';
      err.hidden = false;
      return;
    }
    await saveMeeting({ ...m, goals: m.goals.trim(), done: m.done.trim(), next: m.next.trim() });
    dirty = false;
    toast('Meeting saved');
    if (existing) goBack('#/meetings'); else go('#/meetings', { replace: true });
  });
  const del = $('[data-act="delete"]');
  if (del) {
    del.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Delete this meeting?', confirmText: 'Delete', danger: true });
      if (!ok) return;
      await deleteMeeting(existing.id);
      dirty = false;
      toast('Meeting deleted');
      goBack('#/meetings');
    });
  }
  $('[data-act="back"]').addEventListener('click', () => goBack('#/meetings'));
  drawPeople();

  return {
    async canLeave() {
      if (!dirty) return true;
      return confirmDialog({ title: 'Leave without saving?', message: 'Your notes for this meeting will be lost.', confirmText: 'Leave', cancelText: 'Keep editing', danger: true });
    },
  };
}
