// Talks to Supabase (the online database and file storage for teams) using
// plain fetch() calls, instead of the Supabase library.
//
//   Auth:     /auth/v1/...     sign in (no email: an anonymous account per phone)
//   Database: /rest/v1/...     read/write tables and call the team functions
//   Storage:  /storage/v1/...  upload/download photos, drawings and voice notes
//
// Every request carries the project key (apikey) and this phone's sign-in token.
// The security rules in supabase/schema.sql decide what that token may see.

import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { readKey, writeKey, deleteKey } from './db.js';

const BUCKET = 'entry-files';

export function isCloudConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

const baseUrl = () => SUPABASE_URL.replace(/\/+$/, '');

// An error from Supabase, with a short code we can turn into a friendly message.
export class CloudError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code || '';
  }
}

// ---- Sign-in session ----

let session = null;       // { access_token, refresh_token, expires_at, user_id }
let sessionLoaded = false;
let refreshing = null;

async function loadSession() {
  if (!sessionLoaded) {
    session = (await readKey('session')) || null;
    sessionLoaded = true;
  }
  return session;
}

async function saveSession(data) {
  if (!data) {
    session = null;
    await deleteKey('session');
    return;
  }
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user_id: data.user.id,
  };
  await writeKey('session', session);
}

async function readError(res) {
  const body = await res.json().catch(() => ({}));
  const message = body.message || body.msg || body.error_description || body.error || `Request failed (${res.status})`;
  return new CloudError(message, res.status, body.error_code || body.code || body.error);
}

// Sign in without an email. Supabase makes an "anonymous" account for this phone.
async function signInAnonymously() {
  const res = await fetch(`${baseUrl()}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: {} }),
  });
  if (!res.ok) throw await readError(res);
  await saveSession(await res.json());
  return session.user_id;
}

// Returns this phone's user id, signing in first if needed.
export async function ensureSignedIn() {
  const s = await loadSession();
  if (s) return s.user_id;
  return signInAnonymously();
}

export async function getUserId() {
  const s = await loadSession();
  return s ? s.user_id : null;
}

// Sign-in tokens last about an hour; swap the refresh token for a new one when needed.
async function accessToken() {
  const s = await loadSession();
  if (!s) throw new CloudError('Not signed in', 401, 'not_signed_in');
  if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
  if (!refreshing) refreshing = refreshSession().finally(() => { refreshing = null; });
  return refreshing;
}

async function refreshSession() {
  const res = await fetch(`${baseUrl()}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (!res.ok) {
    const err = await readError(res);
    // The sign-in is no longer valid (not just "no internet"): forget it.
    if (res.status >= 400 && res.status < 500) await saveSession(null);
    err.code = 'session_expired';
    throw err;
  }
  await saveSession(await res.json());
  return session.access_token;
}

export async function signOut() {
  await saveSession(null);
}

// ---- Requests ----

async function request(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const token = await accessToken();
  const h = { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, ...headers };
  let payload = body;
  if (body !== undefined && !(body instanceof Blob)) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(baseUrl() + path, { method, headers: h, body: payload });
  if (!res.ok) throw await readError(res);
  if (raw) return res;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Database tables (PostgREST). query is the part after "?", e.g. "team_id=eq.123".
export const table = {
  select: (name, query) => request(`/rest/v1/${name}?${query}`),
  // Insert, or update if a row with the same id exists.
  upsert: (name, row) => request(`/rest/v1/${name}`, {
    method: 'POST',
    body: row,
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  }),
  remove: (name, query) => request(`/rest/v1/${name}?${query}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  }),
};

// Call one of the team functions in schema.sql (create_team, join_team, ...).
export const rpc = (fn, args = {}) => request(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args });

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

// File storage (private bucket, only team members can read).
export const files = {
  async upload(path, blob, contentType) {
    try {
      await request(`/storage/v1/object/${BUCKET}/${encodePath(path)}`, {
        method: 'POST',
        body: blob,
        headers: { 'Content-Type': contentType, 'x-upsert': 'false' },
      });
    } catch (err) {
      // Already uploaded (e.g. an earlier try stopped half way): that's fine.
      if (err.status === 409 || /duplicate|already exists/i.test(err.message)) return;
      throw err;
    }
  },
  async download(path) {
    const res = await request(`/storage/v1/object/authenticated/${BUCKET}/${encodePath(path)}`, { raw: true });
    return res.blob();
  },
  async remove(paths) {
    const list = paths.filter(Boolean);
    if (!list.length) return;
    await request(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', body: { prefixes: list } });
  },
};

// Turn any error into a short message a student can act on.
export function friendlyError(err) {
  if (!navigator.onLine || err instanceof TypeError) return 'No internet connection. Try again when you\'re online.';
  const text = `${err.code} ${err.message}`;
  if (/already_in_team/.test(text)) return 'You\'re already in a team. Leave it first.';
  if (/bad_code/.test(text)) return 'No team has that code. Check it and try again.';
  if (/too_many_attempts/.test(text)) return 'Too many wrong codes. Wait an hour and try again.';
  if (/not_owner/.test(text)) return 'Only the team owner can do that.';
  if (/anonymous_provider_disabled|Anonymous sign-ins are disabled/i.test(text)) {
    return 'Team sign-in is switched off. In Supabase, turn on "Allow anonymous sign-ins".';
  }
  if (/'photos' column|column .*photos/i.test(text)) {
    return 'The team database needs a quick update: in Supabase, run supabase/schema.sql again.';
  }
  if (err.status === 429) return 'Too many sign-ins from this network. Try again in a while.';
  if (/session_expired|not_signed_in/.test(text)) return 'Your team sign-in ended. Join the team again with its code.';
  if (err.status === 401 || err.status === 403) return 'Not allowed. You may have been removed from the team.';
  return err.message || 'Something went wrong.';
}
