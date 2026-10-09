# PitSide v1.3

A mobile-first Progressive Web App for VEX team members: save a quick evidence entry
(photos + caption and/or voice note + entry type) in under 30 seconds, with no internet,
then export entries as slide-ready images for the engineering notebook in Google Slides.

- **Several photos per entry (new in v1.2):** up to 10. Switch with **‹ Prev / Next ›**,
  a swipe, or the numbered thumbnails; **+ Add photo** / **+ Add from gallery** adds more.
  Each photo has its own drawing. Exports as one slide image per photo ("Photo 2 of 3").
- **Download photos:** every photo on an entry (yours or a teammate's) has **Download**,
  plus **Download all photos**. On a phone this opens the share sheet ("Save Image");
  on a laptop it saves to Downloads. The Export ZIP can also include a `photos/` folder.
  Downloads include the drawing; the saved original photo is never changed.

- Plain HTML, CSS and JavaScript (ES modules). No framework, no build step, no libraries.
- Entries are saved on the device in IndexedDB first, so everything works offline.
- **Teams:** sign in with Google (v1.3), then create or join teams with a 6-character code
  or invite link, and see each other's shared entries. You can be in **several teams**;
  each entry is shared with one of them (or none). Uses a free Supabase project.
- **WebP uploads (v1.3):** every picture is converted to WebP before it goes to Supabase,
  at most 3 MB each (the phone keeps its own copy unchanged).
- Works fully offline after the first load (service worker caches the whole app).
  Shared entries upload by themselves when the phone is back online.

---

## Run it on your computer

Camera, microphone and service workers only work on **HTTPS or localhost**.

**Windows (no installs needed):** open PowerShell in this folder and run:

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open <http://localhost:8080> in Chrome or Edge. Press Ctrl+C to stop.

**Mac / Linux / anything with Python:** `python3 -m http.server 8080` in this folder, then open <http://localhost:8080>.

> A phone can't use `localhost` on your computer, and `http://192.168...` isn't HTTPS,
> so to test on a phone, deploy it (below). It takes about 2 minutes.

## Deploy (free HTTPS hosting)

The app is just static files, so any static host works. Upload the whole folder
(`tools/`, `supabase/` and `serve.ps1` aren't needed by the app but don't hurt).

**GitHub Pages:**
1. Create a GitHub repository and upload these files (keep the folder structure).
2. Repository **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. After a minute the app is at `https://<username>.github.io/<repo>/`.
   All paths in the app are relative, so it works from that sub-folder.

**Netlify Drop:** go to <https://app.netlify.com/drop>, drag this folder onto the page.

## Install it on a phone

- **iPhone (Safari):** open the link → Share button → **Add to Home Screen**.
- **Android (Chrome):** open the link → menu **⋮ → Install app** (or "Add to Home screen").

Open it once while online so it can cache itself. After that it works in airplane mode.

**Important on iPhone:** install it to the Home Screen. If PitSide is only used in a Safari
tab, iOS may delete website data after about 7 days without visiting. Home Screen apps are
not affected. Export regularly anyway.

**Updating from v1.1 with teams:** run `supabase/schema.sql` again in the Supabase SQL Editor
once. It adds the `photos` column and keeps all existing data.

## Updating the app after you change code

Phones check for a new version whenever PitSide is opened or brought back to the front.
When one has downloaded, a **"New version of PitSide ready – Reload"** bar appears (it never
reloads by itself, so nothing being typed is lost). Settings shows the version at the bottom.

The service worker serves the cached copy first (that's what makes it work offline).
When you change any file, open `sw.js` and bump `VERSION` (e.g. `pitside-v1.1.1`).
Phones download the new files in the background and use them the next time the app opens.
If you add a new file, also add it to the `APP_SHELL` list in `sw.js`.

---

## Team sharing setup

Until this is done, PitSide works without teams (everything else works).

### 1. Supabase project
1. Create a free account and project at <https://supabase.com>.
2. **SQL Editor → New query** → paste all of [`supabase/schema.sql`](supabase/schema.sql) → **Run**
   ("Success. No rows returned"). Run it again after every PitSide update that changes it;
   it's safe to re-run and keeps your data.
3. **Project Settings → API Keys**: put the **Project URL** and the **publishable** key
   (`sb_publishable_…`) in [`js/config.js`](js/config.js), bump `VERSION` in `sw.js`, push.
   **Never** use the `secret` / `service_role` key in the app.

### 2. Google sign-in (about 10 minutes)
1. **Google Cloud Console** (<https://console.cloud.google.com>, any Google account):
   create a project (e.g. "PitSide").
2. **APIs & Services → OAuth consent screen** (Google Auth Platform): app name "PitSide",
   your email as support/developer contact, audience **External**. Then **Publish app**
   (it only asks for name/email, so Google doesn't need to review it). While it's in
   "Testing", only test users you add can sign in.
3. **Clients → Create client → Web application.** Under **Authorized redirect URIs** add
   your Supabase callback: `https://<your-project-ref>.supabase.co/auth/v1/callback`
   (Supabase shows this exact address on its Google provider page). Create, then copy the
   **Client ID** and **Client secret**.
4. **Supabase → Authentication → Sign In / Providers → Google:** turn on, paste the
   Client ID and Client secret, **Save**. (The secret goes only here, never in the app.)
5. **Supabase → Authentication → URL Configuration:** set **Site URL** to the app's address
   (e.g. `https://<username>.github.io/pitside/`) and add the same address under
   **Redirect URLs**.
6. **Supabase → Authentication → Sign In / Providers:**
   - **Allow manual linking: on** (lets phones that joined a team before v1.3 keep their
     team when they sign in with Google)
   - **Allow anonymous sign-ins: off** (no longer used; this closes the "throwaway
     accounts" gap)

### How teams work

- **Sign in** on the Team screen with Google. Saving entries never needs a sign-in.
  Signing in on a new phone brings your teams back.
- **Create a team:** you get a code like `ABC234` and an invite link.
  **Join:** tap the invite link, or Team → type the code.
- **Several teams:** up to 20. The Team screen lists them; tap one for its code, invite,
  members and Leave.
- **Share with:** every entry has *Only on this phone / Team A / Team B*. New entries start
  with the team you used last. Changing it moves the entry to the other team.
  Entries saved before joining a team can be shared from the Team screen.
- **Mine / Team** on Home: Team shows the shared entries of one team (pick which, if you're
  in several), with each author's name. Teammates' photos download when opened, then work offline.
- **Export → Whole team:** one ZIP with that team's images, voice notes and a CSV.
- **Owner:** can remove members, delete any team entry, and make a new code (old code and
  links stop working). If the owner leaves, the longest-standing member becomes owner.
  If the last member leaves, the team and all its shared entries are deleted.
- **Pictures are uploaded as WebP**, max 3 MB each. Chrome/Android make WebP themselves;
  iPhones (Safari can't) use Google's libwebp encoder bundled in `js/vendor/webp/`.
  The server also refuses any file over 3 MB.

### Privacy and security

- Only entries shared with a team are uploaded (with your PitSide name), to that team's
  private storage. Everything else never leaves the phone.
- Supabase keeps your Google name and email (that's how sign-in works). Teammates see
  your PitSide name, not your email.
- The rules in `supabase/schema.sql` (Row Level Security) are enforced by the database:
  only members can see a team, its entries and its files; you can only add or edit your
  own entries; only the owner can remove people; anonymous accounts can't create, join or
  upload. 10 wrong codes in an hour blocks that account for the hour.
- The publishable key in `js/config.js` is meant to be public; the security rules protect the data.

---

## Export in your own notebook's format

Settings → Export options → (Build / Competition / Programming) → **Set up from my notebook PDF**.

1. Choose your notebook as a PDF (Google Slides: File → Download → PDF), or a picture of one page.
2. Tap the page that looks the way that entry type should look.
3. Add boxes (Photo, Date and time, Author, Caption, …), drag them over the old content and
   drag the corner to resize. "Cover" paints over what was there; "Match the page" picks the
   page color.
4. Preview, then **Save template**. That type's export now uses "My notebook's layout".

To give teammates the same layout: **Share this template with a teammate** makes a
`.pitside-template.json` file; they open it with **Choose notebook PDF** and tap Save.

All on the phone: the PDF is read by the bundled pdf.js (`js/vendor/pdfjs`) and never
uploaded. Only the chosen page is kept, as a picture in IndexedDB (key `template:<type>`).

---

## How it works (for the process journal)

```
index.html              The single page. Loads css/app.css and js/app.js.
manifest.webmanifest    Name, icons, colors, "standalone" (no browser bar) → makes it installable.
sw.js                   Service worker: caches every app file on first load, then answers
                        from the cache ("cache first"), so the app opens offline.
css/app.css             All styles. Mobile first: 48px buttons, 17px text.
icons/                  App icons (made by tools/make-icons.ps1).
supabase/schema.sql     Team database tables, file storage and security rules (run in Supabase).

js/app.js               Start-up: loads settings and team, connects addresses to screens,
                        registers sw.js, shows the "Offline" note, starts team sync.
js/router.js            Screens have addresses (#/home, #/new, #/entry/ID…). Uses browser history
                        so the phone's Back button works. Asks the screen "canLeave()?" first
                        (that's how "Discard this entry?" works).
js/db.js                IndexedDB: "entries" (my entries, photos/audio as Blobs), "settings"
                        (small values) and "teamEntries" (copies of the team's shared entries).
js/settings.js          Default settings and saving them.
js/ui.js                Shared helpers: constants, date formatting, the confirm box, toast messages.
js/image.js             Resizes photos to max 1600px JPEG (quality 0.8), makes list thumbnails.
js/draw.js              Draw mode: canvas over the photo. Keeps a list of strokes so Undo can
                        redraw everything. Saves a separate transparent PNG.
js/recorder.js          Voice note: MediaRecorder, hold-to-record or tap-to-start/stop, 30 s limit.
js/render.js            Draws one entry as a 1920×1080 or 1080×1080 PNG for Slides.
js/zip.js               A small ZIP writer (headers + CRC-32 checksums), so no library is needed.
js/exporter.js          File names, entries.csv, building the ZIP, Share or Download.
js/gallery.js           The photo list on the detail screens, with Full screen and Download.
js/viewer.js            Full-screen photo viewer with pinch / double-tap / button zoom.
js/config.js            Supabase Project URL + publishable key (empty = no team features).
js/cloud.js             Talks to Supabase with plain fetch(): Google sign-in (PKCE), database,
                        file storage.
js/team.js              My teams; create, join, leave, members, new code, sign out.
js/sync.js              Uploads shared entries to their team, removes moved/deleted ones,
                        downloads each team's entries.
js/webp.js              Makes pictures WebP (max 3 MB) right before they're uploaded.
js/vendor/webp/         Google's libwebp encoder (WebAssembly), used on iPhones only.
js/screens/*.js         One file per screen: welcome, home, capture, saved, detail, export,
                        settings, team, teamEntry.
```

**Saving an entry:** the capture screen keeps everything in a `draft` object in memory.
Save checks there is a photo or caption, adds author + timestamps, makes a thumbnail,
and writes one record to IndexedDB. If the write fails (storage full) the draft is
still on screen, so nothing is lost.

**Sharing never slows saving down:** saving only writes to the phone and marks the entry
`sync: 'pending'`. `sync.js` then uploads it when there's internet (on save, when the app
opens, when it comes back online). It uploads the files first, then the database row.
File names include the edit time, so an edited entry gets new files and the old ones are
deleted. If the connection drops half way, the next sync simply tries again.

**Drawing never changes the photo:** the photo and the drawing are two separate images
of the same size. On screen they are stacked with the same `object-fit`, so they line up.
The export and thumbnails draw the photo first, then the drawing on top.

**Offline:** `sw.js` stores all app files in the Cache Storage on first load. Every later
request for app files is answered from that cache. Team sync requests go to Supabase only
when online.

### Data model (IndexedDB store `entries`)

| field | notes |
|---|---|
| `id` | random UUID (same id online when shared) |
| `type` | `build` / `competition` / `programming` |
| `stage` | `define` / `brainstorm` / `select` / `cad` / `build` / `test` / `analysis` / `null` |
| `photos` | list of up to 10 `{ photo, drawing }`: photo = JPEG Blob, longest side ≤ 1600 px, quality 0.8; drawing = transparent PNG Blob the same size, or `null`. Empty for caption-only entries. (Entries saved before v1.2 have single `photo` / `drawing` fields; `photosOf()` in image.js reads both.) |
| `caption` | text |
| `audio`, `audioMime` | voice note Blob (≤ 30 s) and its type, or `null` |
| `matchNumber` | competition only, else `null` |
| `author` | from settings |
| `createdAt`, `updatedAt` | ISO timestamps |
| `thumb` | *(extra)* 320 px JPEG of photo + drawing, so the Home list loads fast |
| `shared` | *(teams)* `true` / `false`, or missing for entries saved before joining a team |
| `sync` | *(teams)* `'pending'` = needs uploading/removing, `'synced'` = done |
| `remote` | *(teams)* team id + online file paths, or `null` if not uploaded |

Online (Supabase): tables `teams`, `team_members`, `entries`, `join_attempts`, and the
private storage bucket `entry-files` with files at `team/user/entry/file`.

---

## Small decisions worth knowing

- **No JSZip / idb / Supabase library:** I wrote a small ZIP writer (`zip.js`), IndexedDB
  helper (`db.js`) and Supabase client (`cloud.js`) instead, so every line is explainable.
  The one bundled library is the WebP encoder, because iPhones can't make WebP any other way.
- **Google sign-in, not email:** Supabase's free email sender only reaches the project owner
  (2 emails an hour). Google sign-in needs no email sending, works across phones, and stops
  throwaway accounts. (v1.1–1.2 used anonymous sign-in; those phones are upgraded to their
  Google account on first sign-in, keeping their teams.)
- **Sign-in uses PKCE:** the app keeps a random secret on the phone and only a hash of it
  goes to Google, so an intercepted sign-in code is useless to anyone else.
- **Thumbnail field:** each entry also stores a small thumbnail. Showing dozens of
  full-size photos in the list could run a phone out of memory.
- **Design stage memory:** a new entry has no stage until you tap "Add design stage";
  opening it pre-selects the stage you used last. "No stage" removes it.
- **Hold vs tap to record:** press longer than 0.4 s = hold mode (let go to stop);
  a quick tap = tap mode (tap again to stop). Keyboard Enter/Space toggles.
- **Back button while drawing** acts like Done (keeps the drawing).
- **Export dates:** This week (since Monday) / Last 7 days (today + 6 days before) /
  Custom (whole days, inclusive) / All entries (extra option).
- **Sharing a ZIP:** iPhone can share ZIP files; Android Chrome can't share ZIPs, so
  it downloads instead. Single-entry Share (a PNG) uses the share sheet on both.
- **Voice note format:** Chrome/Android records `.webm`, iPhone records `.m4a`
  (picked with `MediaRecorder.isTypeSupported`, webm first then mp4, as specified).

## What was tested, and what still needs real phones

Tested in Chrome (phone-sized window), including with the web server switched off:
first launch, saving photo + caption entries, caption-only entries, the
"Add a photo or a caption" rule, Discard this entry? (Keep / Discard), entry type and
match number, stage memory, draw / undo / clear / reopen / Back-while-drawing (original
photo pixels unchanged), voice notes with a simulated microphone (hold, tap, 30 s
auto-stop, delete, saved and decoded after reload), mic-blocked message, storage-full
message (nothing lost, retry works), edit, delete, delete all (two confirmations),
export filters, ZIP contents and checksums (and Windows opens the ZIP), CSV, per-type
export settings changing the image, offline note, and the whole app working offline.

Teams were tested against real Postgres (PGlite) running `supabase/schema.sql` with
several users: outsiders see nothing, members can't edit or delete others' entries or
upload into others' folders, owner powers, wrong-code limit, owner hand-over, last member
deletes the team. The app was tested end to end against a fake Supabase API using those
same rules: create/join (code and invite link, including a brand-new user), sharing,
editing, un-sharing, offline then online upload, deleting (including a dropped connection
half way), teammates' entries and downloads, whole-team export, removing a member,
being removed, leaving, and v1 data upgrading safely. With `config.js` empty, the app
makes no network requests and shows no team features.

**Please check on real devices / the real Supabase project:**
- Install to Home Screen on iPhone and Android, opens without the browser bar.
- Real camera (Take photo) and the photo picker on both phones.
- Real microphone on iPhone Safari and Android Chrome, including the permission prompt
  and blocking it in settings. (Note: iPhone Home Screen apps may ask for mic permission
  again after the app is closed. That's iOS behaviour.)
- Share sheet → Google Slides / Drive. Drop an exported PNG onto a 16:9 Google Slide.
- Restart the phone and check entries are still there.
- Teams on two real phones: create on one, join on the other, share, see, export.
