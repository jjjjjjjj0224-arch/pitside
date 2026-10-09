// Extra entry details and what they add up to (used by the screens, the exported
// images, the editable slides and the CSV).
//
//   entry.subsystem: 'Intake' ('' = none)
//   entry.testData:  { kind: 'number' | 'passfail', metric, unit, goal, better: 'lower' | 'higher',
//                      trials: [{ value, pass }] }        (null = no test data)
//   entry.match:     { event, partners, our, their, auton: '' | 'worked' | 'partly' | 'failed' }
//   entry.witness:   { name, at } (set by a teammate, see sync.js)

import { STAGE_LABELS, TYPE_LABELS } from './ui.js';

export const AUTON_LABELS = { worked: 'Auton worked', partly: 'Auton partly worked', failed: 'Auton failed' };

const num = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

// Did one trial pass? (number tests pass when they meet the goal; null = no goal)
export function trialPassed(test, trial) {
  if (test.kind === 'passfail') return trial.pass === true ? true : trial.pass === false ? false : null;
  const value = num(trial.value);
  const goal = num(test.goal);
  if (value === null || goal === null) return null;
  return test.better === 'higher' ? value >= goal : value <= goal;
}

// Totals for a test: how many trials, average/min/max (number tests), and success rate.
export function testStats(test) {
  if (!test || !Array.isArray(test.trials)) return null;
  const trials = test.trials.filter((t) => (test.kind === 'passfail' ? t.pass === true || t.pass === false : num(t.value) !== null));
  if (!trials.length) return null;
  const values = trials.map((t) => num(t.value)).filter((v) => v !== null);
  const results = trials.map((t) => trialPassed(test, t)).filter((r) => r !== null);
  const round = (v) => Math.round(v * 100) / 100;
  return {
    count: trials.length,
    avg: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    passed: results.filter(Boolean).length,
    judged: results.length,
    rate: results.length ? Math.round((results.filter(Boolean).length / results.length) * 100) : null,
  };
}

// "Time: avg 12.4 s (min 11.8, max 13.1) · 4/5 passed (80%) · goal ≤ 15 s"
export function testSummary(test, { withName = true } = {}) {
  const s = testStats(test);
  if (!s) return '';
  const unit = test.unit ? ` ${test.unit}` : '';
  const parts = [];
  const name = withName ? `${test.metric || 'Result'}: ` : '';
  if (s.avg !== null) parts.push(`${name}avg ${s.avg}${unit} (min ${s.min}, max ${s.max})`);
  else if (withName) parts.push(`${test.metric || 'Result'}`);
  if (s.rate !== null) parts.push(`${s.passed}/${s.judged} passed (${s.rate}%)`);
  if (test.kind !== 'passfail' && num(test.goal) !== null) parts.push(`goal ${test.better === 'higher' ? '≥' : '≤'} ${test.goal}${unit}`);
  parts.push(`${s.count} ${s.count === 1 ? 'trial' : 'trials'}`);
  return parts.join(' · ');
}

// 'W' / 'L' / 'T', or '' when the scores aren't filled in.
export function matchResult(match) {
  if (!match) return '';
  const our = num(match.our);
  const their = num(match.their);
  if (our === null || their === null) return '';
  return our > their ? 'W' : our < their ? 'L' : 'T';
}

// "Won 34–20 · with 1234A · Auton worked · Event: Regionals"
export function matchSummary(match) {
  if (!match) return '';
  const r = matchResult(match);
  const parts = [];
  if (r) parts.push(`${{ W: 'Won', L: 'Lost', T: 'Tied' }[r]} ${num(match.our)}–${num(match.their)}`);
  if ((match.partners || '').trim()) parts.push(`with ${match.partners.trim()}`);
  if (AUTON_LABELS[match.auton]) parts.push(AUTON_LABELS[match.auton]);
  if ((match.event || '').trim()) parts.push(match.event.trim());
  return parts.join(' · ');
}

// Page title like a notebook's "Build - Drivetrain": the design stage (or the
// entry type), then the subsystem.
export function entryTitle(entry) {
  const first = entry.stage ? (STAGE_LABELS[entry.stage] || entry.stage) : (TYPE_LABELS[entry.type] || entry.type);
  return entry.subsystem ? `${first} - ${entry.subsystem}` : first;
}

// "Witnessed by Sam on 10/09/2026" ('' if nobody has)
export function witnessText(entry) {
  const w = entry.witness;
  if (!w || !w.name) return '';
  return `Witnessed by ${w.name}${w.at ? ` on ${shortDate(w.at)}` : ''}`;
}

export function shortDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
}

// An empty test, for the editor.
export function newTest() {
  return { kind: 'number', metric: '', unit: '', goal: '', better: 'lower', trials: [{ value: '', pass: null }, { value: '', pass: null }, { value: '', pass: null }] };
}

// Keep only what was filled in (null if nothing).
export function cleanTest(test) {
  if (!test) return null;
  const trials = (test.trials || [])
    .map((t) => ({ value: num(t.value), pass: t.pass === true ? true : t.pass === false ? false : null }))
    .filter((t) => (test.kind === 'passfail' ? t.pass !== null : t.value !== null));
  if (!trials.length && !(test.metric || '').trim()) return null;
  return {
    kind: test.kind === 'passfail' ? 'passfail' : 'number',
    metric: (test.metric || '').trim().slice(0, 60),
    unit: (test.unit || '').trim().slice(0, 20),
    goal: num(test.goal),
    better: test.better === 'higher' ? 'higher' : 'lower',
    trials: trials.slice(0, 50),
  };
}

export function cleanMatch(match) {
  if (!match) return null;
  const m = {
    event: (match.event || '').trim().slice(0, 80),
    partners: (match.partners || '').trim().slice(0, 80),
    our: num(match.our),
    their: num(match.their),
    auton: AUTON_LABELS[match.auton] ? match.auton : '',
  };
  return m.event || m.partners || m.our !== null || m.their !== null || m.auton ? m : null;
}
