# PitSide v1

A mobile-first Progressive Web App for VEX team members: save a quick evidence entry
(photo + caption and/or voice note + entry type) in under 30 seconds, with no internet,
then export entries as slide-ready images for the engineering notebook in Google Slides.

- Plain HTML, CSS and JavaScript (ES modules). No framework, no build step, no libraries.
- No backend, no accounts. Everything is stored on the device in IndexedDB.
- Works fully offline after the first load (service worker caches the whole app).

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
(`tools/` and `serve.ps1` aren't needed but don't hurt).

**Netlify Drop (easiest):** go to <https://app.netlify.com/drop>, drag this folder onto the page.
You get an `https://….netlify.app` link right away.

**GitHub Pages:**
1. Create a GitHub repository and upload these files (keep the folder structure).
2. Repository **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. After a minute the app is at `https://<username>.github.io/<repo>/`.
   All paths in the app are relative, so it works from that sub-folder.

## Install it on a phone

- **iPhone (Safari):** open the link → Share button → **Add to Home Screen**.
- **Android (Chrome):** open the link → menu **⋮ → Install app** (or "Add to Home screen").

Open it once while online so it can cache itself. After that it works in airplane mode.

**Important on iPhone:** install it to the Home Screen. If PitSide is only used in a Safari
tab, iOS may delete website data after about 7 days without visiting. Home Screen apps are
not affected. Export regularly anyway.

## Updating the app after you change code

The service worker serves the cached copy first (that's what makes it work offline).
When you change any file, open `sw.js` and bump `VERSION` (e.g. `pitside-v1.0.1`).
Phones download the new files in the background and use them the next time the app opens.
While developing on your computer, DevTools → Application → Service workers →
"Update on reload" saves you from bumping it every time.

If you add a new file, also add it to the `APP_SHELL` list in `sw.js`.

---

## How it works (for the process journal)

```
index.html              The single page. Loads css/app.css and js/app.js.
manifest.webmanifest    Name, icons, colors, "standalone" (no browser bar) → makes it installable.
sw.js                   Service worker: caches every app file on first load, then answers
                        from the cache ("cache first"), so the app opens offline.
css/app.css             All styles. Mobile first: 48px buttons, 17px text.
icons/                  App icons (made by tools/make-icons.ps1).

js/app.js               Start-up: loads settings, connects addresses to screens, registers sw.js,
                        shows the "Offline" note.
js/router.js            Screens have addresses (#/home, #/new, #/entry/ID…). Uses browser history
                        so the phone's Back button works. Asks the screen "canLeave()?" first
                        (that's how "Discard this entry?" works).
js/db.js                IndexedDB: store "entries" (one record per entry, photos/audio as Blobs)
                        and store "settings". Also asks for persistent storage on first save.
js/settings.js          Default settings and saving them.
js/ui.js                Shared helpers: constants, date formatting, the confirm box, toast messages.
js/image.js             Resizes photos to max 1600px JPEG (quality 0.8), makes list thumbnails.
js/draw.js              Draw mode: canvas over the photo. Keeps a list of strokes so Undo can
                        redraw everything. Saves a separate transparent PNG.
js/recorder.js          Voice note: MediaRecorder, hold-to-record or tap-to-start/stop, 30 s limit.
js/render.js            Draws one entry as a 1920×1080 or 1080×1080 PNG for Slides.
js/zip.js               A small ZIP writer (headers + CRC-32 checksums), so no library is needed.
js/exporter.js          File names, entries.csv, building the ZIP, Share or Download.
js/screens/*.js         One file per screen: welcome, home, capture, saved, detail, export, settings.
```

**Saving an entry:** the capture screen keeps everything in a `draft` object in memory.
Save checks there is a photo or caption, adds author + timestamps, makes a thumbnail,
and writes one record to IndexedDB. If the write fails (storage full) the draft is
still on screen, so nothing is lost.

**Drawing never changes the photo:** the photo and the drawing are two separate images
of the same size. On screen they are stacked with the same `object-fit`, so they line up.
The export and thumbnails draw the photo first, then the drawing on top.

**Offline:** `sw.js` stores all app files in the Cache Storage on first load. Every later
request is answered from that cache, so the app makes no network requests.

### Data model (IndexedDB store `entries`)

| field | notes |
|---|---|
| `id` | random UUID |
| `type` | `build` / `competition` / `programming` |
| `stage` | `define` / `brainstorm` / `select` / `cad` / `build` / `test` / `analysis` / `null` |
| `photo` | JPEG Blob, longest side ≤ 1600 px, quality 0.8 (or `null` for caption-only) |
| `drawing` | transparent PNG Blob, same size as photo, or `null` |
| `caption` | text |
| `audio`, `audioMime` | voice note Blob (≤ 30 s) and its type, or `null` |
| `matchNumber` | competition only, else `null` |
| `author` | from settings |
| `createdAt`, `updatedAt` | ISO timestamps |
| `thumb` | *(extra)* 320 px JPEG of photo + drawing, so the Home list loads fast |

---

## Small decisions worth knowing

- **No JSZip / idb:** the spec allowed them; I wrote a small ZIP writer (`zip.js`) and
  IndexedDB helper (`db.js`) instead, so there is nothing to download or bundle and every
  line is explainable. ZIP files are "stored" (not compressed), because PNG, JPEG and
  audio are already compressed.
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

## What I tested, and what still needs a real phone

Tested in Chrome (phone-sized window), including with the web server switched off:
first launch, saving photo + caption entries, caption-only entries, the
"Add a photo or a caption" rule, Discard this entry? (Keep / Discard), entry type and
match number, stage memory, draw / undo / clear / reopen / Back-while-drawing (original
photo pixels unchanged), voice notes with a simulated microphone (hold, tap, 30 s
auto-stop, delete, saved and decoded after reload), mic-blocked message, storage-full
message (nothing lost, retry works), edit, delete, delete all (two confirmations),
export filters (Programming-only = only programming entries), ZIP contents and checksums
(and Windows opens the ZIP), CSV, per-type export settings changing the image, offline
note, and the whole app working with the server stopped.

**Please check on real devices** (the acceptance checklist items I couldn't do from a computer):
- Install to Home Screen on iPhone and Android, opens without the browser bar.
- Real camera (Take photo) and the photo picker on both phones.
- Real microphone on iPhone Safari and Android Chrome, including the permission prompt
  and blocking it in settings. (Note: iPhone Home Screen apps may ask for mic permission
  again after the app is closed. That's iOS behaviour.)
- Share sheet → Google Slides / Drive.
- Drop an exported PNG onto a 16:9 Google Slide.
- Restart the phone and check entries are still there.
