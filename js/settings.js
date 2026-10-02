// App settings: author name, default entry type, last used stage and the
// export options for each entry type. Stored in IndexedDB (store "settings").

import { readSettings, writeSettings } from './db.js';
import { TYPES } from './ui.js';

// Export options for one entry type.
//   size:   'slide' (1920x1080, 16:9) or 'square' (1080x1080)
//   fields: which text to print on the exported image
//   accent: color of the type label
function exportDefaults(accent, showMatch) {
  return {
    size: 'slide',
    fields: { caption: true, datetime: true, author: true, stage: true, match: showMatch },
    accent,
  };
}

const DEFAULTS = {
  author: '',
  defaultType: 'build',
  lastStage: null,
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
    const got = (saved.export && saved.export[type]) || {};
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
