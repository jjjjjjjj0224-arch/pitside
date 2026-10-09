// Send the editable slides (slides.pptx) to Google Slides: Google's sign-in popup
// asks for permission once, then the file is uploaded to your Google Drive and
// converted into a Google Slides presentation you can open and copy slides from.
//
// Permission asked: "drive.file" = only files PitSide creates. PitSide can't see
// anything else in your Drive. Uses Google Identity Services (loaded only when needed).

import { GOOGLE_CLIENT_ID } from './config.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

let loading = null;
let tokenClient = null;
let token = null;      // { value, expiresAt }

export const googleSlidesAvailable = () => Boolean(GOOGLE_CLIENT_ID);

// Load Google's sign-in script ahead of time, so the popup can open straight
// from a tap (browsers block popups that open later).
export function prepareGoogle() {
  if (!GOOGLE_CLIENT_ID) return Promise.reject(new Error('not_configured'));
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = resolve;
      s.onerror = () => { loading = null; reject(new Error('google_script')); };
      document.head.appendChild(s);
    }).then(() => {
      tokenClient = window.google.accounts.oauth2.initTokenClient({ client_id: GOOGLE_CLIENT_ID, scope: SCOPE, callback: () => {} });
    });
  }
  return loading;
}

export const googleReady = () => Boolean(tokenClient);

// Call from a tap. Resolves with an access token (asks only the first time per hour).
export function getGoogleToken() {
  return new Promise((resolve, reject) => {
    if (token && token.expiresAt > Date.now() + 60000) { resolve(token.value); return; }
    if (!tokenClient) { reject(new Error('google_not_ready')); return; }
    tokenClient.callback = (resp) => {
      if (resp.error) { reject(new Error(resp.error)); return; }
      token = { value: resp.access_token, expiresAt: Date.now() + Number(resp.expires_in || 3600) * 1000 };
      resolve(token.value);
    };
    tokenClient.error_callback = (err) => reject(new Error((err && err.type) || 'popup_failed'));
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

// Upload the .pptx as a new Google Slides file. Returns { id, link }.
export async function uploadToGoogleSlides(pptx, name, accessToken) {
  // Resumable upload: works for big files too. Step 1 says what's coming...
  const start = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': PPTX,
    },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.presentation' }),
  });
  if (!start.ok) throw await driveError(start);
  const location = start.headers.get('Location');
  if (!location) throw new Error('upload_failed');
  // ...step 2 sends the file. Google converts it to Slides.
  const put = await fetch(location, { method: 'PUT', headers: { 'Content-Type': PPTX }, body: pptx });
  if (!put.ok) throw await driveError(put);
  const file = await put.json();
  return { id: file.id, link: file.webViewLink || `https://docs.google.com/presentation/d/${file.id}/edit` };
}

async function driveError(res) {
  let message = `Google Drive error ${res.status}`;
  try {
    const body = await res.json();
    message = (body.error && body.error.message) || message;
  } catch { /* not JSON */ }
  const err = new Error(message);
  err.status = res.status;
  return err;
}

// A short message a student can act on.
export function googleError(err) {
  const text = String(err && err.message);
  if (!navigator.onLine) return 'No internet connection. Try again when you\'re online.';
  if (/popup_closed|access_denied|popup_failed/.test(text)) return 'Google sign-in was closed. Tap the button again to try once more.';
  if (/google_script|google_not_ready/.test(text)) return 'Couldn\'t reach Google. Check the internet and try again.';
  if (/has not been used|is disabled|API has not/i.test(text)) return 'Google Drive isn\'t switched on for this app yet (Google Cloud: enable the Google Drive API).';
  if (err && (err.status === 401 || err.status === 403)) return 'Google didn\'t allow it. Tap the button again and allow access.';
  return text || 'Something went wrong with Google.';
}
