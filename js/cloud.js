// Talks to Supabase (the online database and file storage for teams) using
// plain fetch() calls, instead of the Supabase library.
//
//   Auth:     /auth/v1/...     sign in with Google (Supabase Auth, PKCE flow)
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

// { access_token, refresh_token, expires_at, user_id, email, name, anonymous }
let session = null;
let sessionLoaded = false;
let refreshing = null;

async function loadSession() {
  if (!sessionLoaded) {
    session = (await readKey('session')) || null;
    sessionLoaded = true;
  }
  return session;
}

// The part of a sign-in token we can read: who it's for, and if it's anonymous.
function tokenClaims(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part));
  } catch {
    return {};
  }
}

async function saveSession(data) {
  if (!data) {
    session = null;
    await deleteKey('session');
    return;
  }
  const user = data.user || {};
  const meta = user.user_metadata || {};
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user_id: user.id,
    email: user.email || '',
    name: meta.full_name || meta.name || '',
    anonymous: typeof user.is_anonymous === 'boolean' ? user.is_anonymous : Boolean(tokenClaims(data.access_token).is_anonymous),
  };
  await writeKey('session', session);
}

async function readError(res) {
  const body = await res.json().catch(() => ({}));
  const message = body.message || body.msg || body.error_description || body.error || `Request failed (${res.status})`;
  return new CloudError(message, res.status, body.error_code || body.code || body.error);
}

// Who is signed in on this phone: { userId, email, name, anonymous } or null.
// (anonymous = signed in by an older PitSide without Google; it needs a Google sign-in now.)
export async function getAccount() {
  const s = await loadSession();
  if (!s) return null;
  return { userId: s.user_id, email: s.email || '', name: s.name || '', anonymous: isAnonymous(s) };
}

// Sessions saved by older versions don't have the "anonymous" field: read it from the token.
function isAnonymous(s) {
  return typeof s.anonymous === 'boolean' ? s.anonymous : Boolean(tokenClaims(s.access_token).is_anonymous);
}

export async function getUserId() {
  const s = await loadSession();
  return s ? s.user_id : null;
}

// ---- Sign in with Google (PKCE) ----
// 1. Make a random secret ("verifier") and keep it on the phone.
// 2. Send the browser to Supabase -> Google, with a hash of the secret ("challenge").
// 3. Google sends the browser back to PitSide with ?code=...
// 4. PitSide swaps the code + secret for a sign-in session.
// Only this phone knows the secret, so a stolen code is useless to anyone else.

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makePkce() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(hash)) };
}

// Where Google sends the browser back to: this app's own address (without #...).
const appAddress = () => `${location.origin}${location.pathname}`;

// Leave the app for the Google sign-in page. (Kept in an object so tests can replace it.)
export const browser = { go: (url) => window.location.assign(url) };

// returnHash: the screen to show after signing in, e.g. '#/team' or '#/join/ABC234'.
export async function startGoogleSignIn(returnHash = '#/team') {
  const { verifier, challenge } = await makePkce();
  // prompt=select_account: Google always shows the account picker, so you can
  // switch to a different Google account instead of being signed straight back in.
  const params = `provider=google&redirect_to=${encodeURIComponent(appAddress())}`
    + `&code_challenge=${challenge}&code_challenge_method=s256&prompt=select_account`;
  const current = await loadSession();

  let url;
  if (current && isAnonymous(current)) {
    // Phone joined a team before Google sign-in existed: link Google to that same
    // account, so it keeps its teams. (Needs "Allow manual linking" in Supabase.)
    const res = await request(`/auth/v1/user/identities/authorize?${params}&skip_http_redirect=true`, { raw: true })
      .catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    url = body && body.url;
  }
  if (!url) url = `${baseUrl()}/auth/v1/authorize?${params}`;

  await writeKey('pkce', { verifier, returnHash, at: Date.now() });
  browser.go(url);
}

// Called when the app opens. If we just came back from Google (?code=... or ?error=...),
// finish signing in. Returns { returnHash, error } or null if this wasn't a sign-in return.
export async function finishGoogleSignIn() {
  const query = new URLSearchParams(location.search);
  const code = query.get('code');
  const error = query.get('error_description') || query.get('error');
  if (!code && !error) return null;

  const saved = (await readKey('pkce')) || {};
  await deleteKey('pkce');
  const returnHash = saved.returnHash || '#/team';
  // Remove ?code=... from the address bar (so a reload doesn't try again).
  history.replaceState(history.state, '', `${appAddress()}${returnHash}`);

  if (error) return { returnHash, error: friendlyError(new CloudError(error.replace(/\+/g, ' '), 400, query.get('error'))) };
  if (!saved.verifier) return { returnHash, error: 'Sign-in was started on another page. Please try again.' };
  try {
    const res = await fetch(`${baseUrl()}/auth/v1/token?grant_type=pkce`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_code: code, code_verifier: saved.verifier }),
    });
    if (!res.ok) throw await readError(res);
    await saveSession(await res.json());
    return { returnHash, error: null };
  } catch (err) {
    console.warn('Sign-in failed', err);
    return { returnHash, error: friendlyError(err) };
  }
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

// Sign out on this phone (tells Supabase too, if online).
export async function signOut() {
  const s = await loadSession();
  if (s && navigator.onLine) {
    await fetch(`${baseUrl()}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${s.access_token}` },
    }).catch(() => {});
  }
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
  if (/bad_code/.test(text)) return 'No team has that code. Check it and try again.';
  if (/too_many_attempts/.test(text)) return 'Too many wrong codes. Wait an hour and try again.';
  if (/too_many_teams/.test(text)) return 'You\'re in the most teams allowed (20). Leave one first.';
  if (/not_owner/.test(text)) return 'Only the team owner can do that.';
  if (/need_google_sign_in/.test(text)) return 'Sign in with Google first (Team screen).';
  if (/provider is not enabled|Unsupported provider/i.test(text)) {
    return 'Google sign-in isn\'t switched on yet. In Supabase: Authentication > Sign In / Providers > Google.';
  }
  if (/access_denied|cancel/i.test(text)) return 'Sign-in was cancelled.';
  if (/flow state|code verifier|code_verifier|bad_code_verifier|invalid_grant/i.test(text)) {
    return 'That sign-in didn\'t finish in time. Please tap Sign in with Google again.';
  }
  if (/redirect|not allowed/i.test(text)) {
    return 'Supabase doesn\'t allow this app address yet. Add it in Authentication > URL Configuration.';
  }
  if (/own_entry/.test(text)) return 'You can\'t witness your own entry. Ask a teammate.';
  if (/already_witnessed/.test(text)) return 'Someone else already witnessed this entry.';
  if (/not_found/.test(text)) return 'That entry isn\'t shared with your team any more.';
  if (/'(photos|subsystem|test_data|match_data)' column|column .*(photos|subsystem|test_data|match_data)|entry_comments|witness_entry|add_comment/i.test(text)) {
    return 'The team database needs a quick update: in Supabase, run supabase/schema.sql again.';
  }
  if (err.status === 429) return 'Too many sign-ins from this network. Try again in a while.';
  if (/session_expired|not_signed_in/.test(text)) return 'You\'re signed out. Sign in with Google again on the Team screen.';
  if (err.status === 401 || err.status === 403) return 'Not allowed. You may have been removed from the team.';
  return err.message || 'Something went wrong.';
}
