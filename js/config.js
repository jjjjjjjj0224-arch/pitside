// Team sharing settings (Supabase). Leave both empty to use PitSide without teams.
//
// Find these in the Supabase dashboard: Project Settings -> API (or "Connect").
//   SUPABASE_URL: the Project URL, like https://abcdefghijkl.supabase.co
//   SUPABASE_KEY: the "publishable" key (sb_publishable_...) or the legacy "anon public" key.
//
// These are meant to be public. They are safe in the app and on GitHub, because the
// security rules in supabase/schema.sql decide what each person can see.
// NEVER put the "secret" / "service_role" key here.

export const SUPABASE_URL = 'https://riiogohjkshvylaqegln.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_Zj-0Lj0Wdb_p4n8MS99dXA_uVt9Gq2D';

// "Send to Google Slides" (Export screen): the Google OAuth client ID (public, like
// the key above). It only asks for access to files PitSide makes in your Drive.
// Leave empty to hide the button. Before turning it on (with the client ID
// 206731939854-3q08lmeib2oe9f9hv16mtfksnrd499c0.apps.googleusercontent.com), in Google Cloud:
// enable the Google Drive API, add https://jjjjjjjj0224-arch.github.io as an Authorized
// JavaScript origin of that OAuth client, and add the drive.file scope to the consent screen.
export const GOOGLE_CLIENT_ID = '';
