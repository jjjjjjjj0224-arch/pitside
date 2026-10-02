// The photos of an entry, one under another, for the detail screens.
// Each photo has a Download button; "Download all photos" when there are several.
// Downloads are full size, with the drawing (if any) merged on top.

import { flattenPhoto } from './image.js';
import { photoFileName, shareOrDownload } from './exporter.js';
import { toast } from './ui.js';

// count: number of photos. Returns HTML with empty frames (filled in by mountGallery).
export function galleryHtml(count) {
  if (!count) return '';
  const items = Array.from({ length: count }, (_, i) => `
    <figure class="gallery-item">
      <div class="photo-frame detail-photo">
        <img class="layer" data-photo="${i}" alt="Photo ${i + 1} of ${count}">
        <img class="layer" data-drawing="${i}" alt="Drawing on photo ${i + 1}" hidden>
        <p class="photo-busy" data-busy="${i}" hidden>Downloading photo…</p>
      </div>
      <figcaption class="gallery-caption">
        <span>${count > 1 ? `Photo ${i + 1} of ${count}` : 'Photo'}</span>
        <button type="button" class="btn btn-secondary btn-small" data-download="${i}">Download</button>
      </figcaption>
    </figure>`).join('');
  return `
    <section class="gallery" aria-label="Photos">
      ${items}
      ${count > 1 ? `<button type="button" class="btn btn-secondary btn-block" data-download-all>Download all ${count} photos</button>` : ''}
    </section>`;
}

// el: screen element. loadPhotos(): Promise of [{ photo, drawing }] with Blobs.
// base: file name start, e.g. "2026-10-01_1542_build". thumb: small picture to show while loading.
export function mountGallery(el, { count, loadPhotos, base, urls, thumb }) {
  if (!count) return;
  if (thumb) el.querySelector('[data-photo="0"]').src = urls.make(thumb);
  el.querySelectorAll('[data-busy]').forEach((b) => { b.hidden = false; });

  // Load the photos, then get the download files ready (so a tap shares at once).
  const ready = loadPhotos().then(async (photos) => {
    photos.forEach((p, i) => {
      el.querySelector(`[data-photo="${i}"]`).src = urls.make(p.photo);
      const d = el.querySelector(`[data-drawing="${i}"]`);
      if (p.drawing) { d.src = urls.make(p.drawing); d.hidden = false; }
    });
    const files = [];
    for (let i = 0; i < photos.length; i++) {
      files.push(new File([await flattenPhoto(photos[i])], photoFileName(base, i, photos.length), { type: 'image/jpeg' }));
    }
    return files;
  });
  ready
    .catch((err) => {
      console.warn(err);
      toast(navigator.onLine ? 'Couldn\'t load the photos.' : 'Connect to the internet to see the full photos.');
    })
    .finally(() => el.querySelectorAll('[data-busy]').forEach((b) => { b.hidden = true; }));

  async function download(files, button) {
    button.disabled = true;
    try {
      const result = await shareOrDownload(files, 'PitSide photos', { preferDownload: true });
      if (result === 'downloaded') toast(files.length > 1 ? `${files.length} photos downloaded` : 'Photo downloaded');
      if (result === 'retry') toast('Photos ready. Tap Download again.');
    } finally {
      button.disabled = false;
    }
  }

  el.querySelectorAll('[data-download]').forEach((btn) => btn.addEventListener('click', async () => {
    const files = await ready.catch(() => null);
    if (files) download([files[Number(btn.dataset.download)]], btn);
  }));
  const allBtn = el.querySelector('[data-download-all]');
  if (allBtn) {
    allBtn.addEventListener('click', async () => {
      const files = await ready.catch(() => null);
      if (files) download(files, allBtn);
    });
  }
}
