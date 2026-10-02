// All saved data lives in IndexedDB, a database built into the browser.
// Nothing is ever sent to a server.
//
// Stores:
//   entries     - my entries (photo, drawing, audio are Blobs)
//   settings    - small values by key: "app" (settings), "session" (team sign-in),
//                 "team" (which team I'm in), "pendingDeletes" (to remove from the team)
//   teamEntries - copies of my team's shared entries, so they can be viewed offline
//
// The only things ever sent anywhere are entries you share with a team (see sync.js).

const DB_NAME = 'pitside';
const DB_VERSION = 2;   // 2 = added teamEntries

let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      // Runs the first time (or when DB_VERSION goes up): create the stores.
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('entries')) {
          const store = db.createObjectStore('entries', { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
        if (!db.objectStoreNames.contains('teamEntries')) {
          db.createObjectStore('teamEntries', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
  }
  return dbPromise;
}

// Run one database request and wait until it is safely written.
// (We wait for the whole transaction to complete, not just the request,
// so a "storage full" error is caught here.)
async function run(storeName, mode, makeRequest) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = makeRequest(tx.objectStore(storeName));
    let result;
    req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || req.error);
    tx.onabort = () => reject(tx.error || new Error('Save was cancelled by the browser'));
  });
}

// ---- Entries ----

// All entries, newest first.
export async function getAllEntries() {
  const all = await run('entries', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export const getEntry = (id) => run('entries', 'readonly', (s) => s.get(id));
export const putEntry = (entry) => run('entries', 'readwrite', (s) => s.put(entry));
export const deleteEntry = (id) => run('entries', 'readwrite', (s) => s.delete(id));
export const deleteAllEntries = () => run('entries', 'readwrite', (s) => s.clear());

// ---- Team entries (copies of what teammates shared) ----

export async function getAllTeamEntries() {
  const all = await run('teamEntries', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
export const getTeamEntry = (id) => run('teamEntries', 'readonly', (s) => s.get(id));
export const putTeamEntry = (entry) => run('teamEntries', 'readwrite', (s) => s.put(entry));
export const deleteTeamEntry = (id) => run('teamEntries', 'readwrite', (s) => s.delete(id));
export const clearTeamEntries = () => run('teamEntries', 'readwrite', (s) => s.clear());

// ---- Settings and other small values ----

export const readKey = (key) => run('settings', 'readonly', (s) => s.get(key));
export const writeKey = (key, value) => run('settings', 'readwrite', (s) => s.put(value, key));
export const deleteKey = (key) => run('settings', 'readwrite', (s) => s.delete(key));

export const readSettings = () => readKey('app');
export const writeSettings = (value) => writeKey('app', value);

// ---- Storage ----

// Ask the browser not to clear our data when the phone is low on space.
// Called on the first save (the spec asks for this).
export async function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* not supported: entries are still saved */ }
  return false;
}

export async function isStoragePersistent() {
  try {
    return navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  } catch { return false; }
}

// Add up the size of every photo, drawing, thumbnail and voice note.
export function entryBytes(entry) {
  const blobSize = (b) => (b && b.size) || 0;
  const textSize = (entry.caption || '').length * 2;
  const photoSize = (entry.photos || []).reduce((n, p) => n + blobSize(p.photo) + blobSize(p.drawing), 0);
  return photoSize + blobSize(entry.photo) + blobSize(entry.drawing) + blobSize(entry.audio) + blobSize(entry.thumb) + textSize;
}
