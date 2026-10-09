// App settings: author name, default entry type, last used stage and the
// export options for each entry type. Stored in IndexedDB (store "settings").

import { readSettings, writeSettings } from './db.js';
import { TYPES } from './ui.js';

// Export options for one entry type.
//   format: the default export format: 'standard' (PitSide layout) or a notebook
//           format id (templates.js). "Auto" on the Export screen uses this.
//   size:   'slide' (1920x1080, 16:9) or 'square' (1080x1080)    (PitSide layout only)
//   fields: which text to print on the exported image
//   accent: color of the type label
//   photosPerPage: photos on each image, 1, 2, 4 or 'all'  (PitSide layout; a notebook
//                  format has as many as its Photo boxes)
//   captionPages:  when an entry makes several images: caption on the 'first' one,
//                  'spread' over them, or on 'every' one
//   bullets:       caption as bullet points (one per sentence)
function exportDefaults(accent, showMatch) {
  return {
    size: 'slide',
    format: 'standard',
    fields: { caption: true, datetime: true, author: true, stage: true, match: showMatch, subsystem: true, witness: true, test: true },
    accent,
    photosPerPage: 1,
    captionPages: 'first',
    bullets: false,
  };
}

const DEFAULTS = {
  author: '',
  defaultType: 'build',
  lastStage: null,
  lastShareTeam: null,     // the team the last entry was shared with
  lastEvent: '',           // the competition event of the last match entry
  lastBackup: null,        // when the last backup file was made (backup.js)
  theme: 'classic',        // color theme id (js/themes.js), 'auto' or 'custom'
  customTheme: { bg: '#1B1D22', surface: '#25282F', text: '#F1F2F4', accent: '#F59E0B' },
  export: {
    build: exportDefaults('#C2410C', false),        // orange
    competition: exportDefaults('#B91C1C', true),   // red
    programming: exportDefaults('#1D4ED8', false),  // blue
  },
};

let current = null;

// Fill in any missing values with defaults (so older saved settings still work
// if a new option is added later).
function withDefaults(saved = {}) {
  const s = { ...DEFAULTS, ...saved, export: {} };
  for (const type of TYPES) {
    const def = DEFAULTS.export[type];
    const got = { ...((saved.export && saved.export[type]) || {}) };
    // v1.5 had layout: 'template' = this type's own notebook page (now the format 'legacy-<type>').
    if (!got.format && got.layout === 'template') got.format = `legacy-${type}`;
    delete got.layout;
    s.export[type] = { ...def, ...got, fields: { ...def.fields, ...(got.fields || {}) } };
  }
  return s;
}

export async function loadSettings() {
  let saved;
  try { saved = await readSettings(); } catch { saved = undefined; }
  current = withDefaults(saved);
  return current;
}

// Synchronous read of the settings loaded at start-up.
export function getSettings() {
  return current;
}

// Save some settings, e.g. saveSettings({ author: 'Sam' }).
export async function saveSettings(changes) {
  current = withDefaults({ ...current, ...changes });
  await writeSettings(current);
  return current;
}

// Save the export options for one entry type.
export async function saveExportOptions(type, options) {
  const exportOpts = { ...current.export, [type]: options };
  return saveSettings({ export: exportOpts });
}
