// Meeting log: who came, the goals, what got done and what's next. Kept on the
// phone (settings store, key 'meetings') and in backups. Each week with meetings
// can become one summary slide that also lists that week's entries.
//
//   { id, date: 'YYYY-MM-DD', attendees: ['Sam', ...], goals, done, next, createdAt, updatedAt }

import { readKey, writeKey } from './db.js';
import { canvasToBlob } from './image.js';
import { STAGE_LABELS, TYPE_LABELS, uuid } from './ui.js';

const KEY = 'meetings';

export async function listMeetings() {
  const list = (await readKey(KEY)) || [];
  return list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export async function getMeeting(id) {
  return (await listMeetings()).find((m) => m.id === id) || null;
}

export async function saveMeeting(meeting) {
  const list = await listMeetings();
  const now = new Date().toISOString();
  const saved = { ...meeting, id: meeting.id || uuid(), createdAt: meeting.createdAt || now, updatedAt: now };
  const i = list.findIndex((m) => m.id === saved.id);
  if (i === -1) list.push(saved); else list[i] = saved;
  await writeKey(KEY, list);
  return saved;
}

export async function deleteMeeting(id) {
  await writeKey(KEY, (await listMeetings()).filter((m) => m.id !== id));
}

// Replace the whole list (restoring a backup).
export async function replaceMeetings(list) {
  await writeKey(KEY, list);
}

// ---- Weeks (Monday to Sunday) ----

export const toDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 'YYYY-MM-DD' of the Monday of that day's week.
export function weekStart(day) {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return toDay(date);
}

export function weekLabel(start) {
  const [y, m, d] = start.split('-').map(Number);
  const a = new Date(y, m - 1, d);
  const b = new Date(y, m - 1, d + 6);
  const f = (x) => x.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `Week of ${f(a)} – ${f(b)}`;
}

// Meetings grouped by week, newest week first: [{ start, meetings }]
export function meetingsByWeek(meetings) {
  const map = new Map();
  for (const m of meetings) {
    const w = weekStart(m.date);
    if (!map.has(w)) map.set(w, []);
    map.get(w).push(m);
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([start, list]) => ({
    start,
    meetings: list.sort((a, b) => a.date.localeCompare(b.date)),
  }));
}

// Entries made in that week.
export function entriesInWeek(entries, start) {
  return entries.filter((e) => weekStart(toDay(new Date(e.createdAt))) === start)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

// ---- The weekly summary slide (1920x1080) ----

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

function wrap(ctx, text, width) {
  const out = [];
  for (const para of String(text || '').split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width <= width || !line) line = test;
      else { out.push(line); line = word; }
    }
    if (line) out.push(line);
  }
  return out;
}

export async function weekSlide(start, meetings, entries) {
  const W = 1920;
  const H = 1080;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#1D4ED8';
  ctx.font = `700 44px ${FONT}`;
  ctx.fillText('WEEKLY SUMMARY', 64, 56);
  ctx.fillRect(64, 112, 90, 8);
  ctx.fillStyle = '#111827';
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText(weekLabel(start), 64, 136);

  const attendees = [...new Set(meetings.flatMap((m) => m.attendees || []))];
  ctx.fillStyle = '#4B5563';
  ctx.font = `400 26px ${FONT}`;
  const people = wrap(ctx, `${meetings.length} ${meetings.length === 1 ? 'meeting' : 'meetings'}${attendees.length ? ` · ${attendees.join(', ')}` : ''}`, W - 128);
  people.slice(0, 2).forEach((l, i) => ctx.fillText(l, 64, 188 + i * 34));

  // Left: meetings. Right: entries made this week.
  const colTop = 270;
  const leftW = 1020;
  let y = colTop;
  const bottom = H - 56;
  const section = (title, text, x, width) => {
    if (!(text || '').trim() || y > bottom - 40) return;
    ctx.fillStyle = '#111827';
    ctx.font = `700 26px ${FONT}`;
    ctx.fillText(title, x, y);
    y += 36;
    ctx.fillStyle = '#374151';
    ctx.font = `400 24px ${FONT}`;
    for (const line of wrap(ctx, text, width)) {
      if (y > bottom - 30) { ctx.fillText('…', x, y); y += 30; break; }
      ctx.fillText(line, x, y);
      y += 30;
    }
    y += 10;
  };
  for (const m of meetings) {
    if (y > bottom - 60) break;
    const [yy, mm, dd] = m.date.split('-').map(Number);
    ctx.fillStyle = '#1D4ED8';
    ctx.font = `700 28px ${FONT}`;
    ctx.fillText(new Date(yy, mm - 1, dd).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }), 64, y);
    y += 42;
    section('Goals', m.goals, 64, leftW);
    section('Done', m.done, 64, leftW);
    section('Next', m.next, 64, leftW);
    y += 8;
  }

  const rx = 64 + leftW + 64;
  const rw = W - rx - 64;
  let ry = colTop;
  ctx.fillStyle = '#F3F4F6';
  ctx.fillRect(rx - 24, colTop - 20, rw + 48, bottom - colTop + 30);
  ctx.fillStyle = '#111827';
  ctx.font = `700 28px ${FONT}`;
  ctx.fillText(`Entries this week: ${entries.length}`, rx, ry);
  ry += 44;
  // Count by subsystem.
  const counts = new Map();
  for (const e of entries) counts.set(e.subsystem || TYPE_LABELS[e.type], (counts.get(e.subsystem || TYPE_LABELS[e.type]) || 0) + 1);
  ctx.font = `400 24px ${FONT}`;
  ctx.fillStyle = '#374151';
  const tally = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).join(' · ');
  for (const line of wrap(ctx, tally, rw).slice(0, 3)) { ctx.fillText(line, rx, ry); ry += 30; }
  ry += 16;
  for (const e of entries) {
    if (ry > bottom - 60) { ctx.fillText(`+ ${entries.length - entries.indexOf(e)} more`, rx, ry); break; }
    const head = [e.stage ? STAGE_LABELS[e.stage] : TYPE_LABELS[e.type], e.subsystem, e.author].filter(Boolean).join(' · ');
    ctx.fillStyle = '#111827';
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText(head, rx, ry);
    ry += 28;
    ctx.fillStyle = '#4B5563';
    ctx.font = `400 22px ${FONT}`;
    const first = (e.caption || '').split('\n').find((l) => l.trim()) || '';
    const line = wrap(ctx, first, rw)[0];
    if (line) { ctx.fillText(line, rx, ry); ry += 28; }
    ry += 12;
  }
  return canvasToBlob(c, 'image/png');
}
