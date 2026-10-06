// Turns pictures into WebP right before they are uploaded to the team (Supabase),
// and keeps every uploaded picture at most 3 MB.
//
// Chrome / Firefox / Android can make WebP with a <canvas>. Safari (and every
// browser on iPhone/iPad) can't, so there we use Google's libwebp encoder,
// bundled in js/vendor/webp (only downloaded the first time it's needed).
//
// The photos saved on the phone are not changed; only the uploaded copies are WebP.

import { loadImage, canvasToBlob } from './image.js';

export const MAX_WEBP_BYTES = 3 * 1024 * 1024;   // 3 MB per picture

// Does this browser's canvas make real WebP files? (Asked once.)
let canvasWebp = null;
async function canvasCanMakeWebp() {
  if (canvasWebp === null) {
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 2;
    const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.8));
    canvasWebp = Boolean(blob && blob.type === 'image/webp');
  }
  return canvasWebp;
}

// libwebp settings (the encoder needs every one of them; these are its defaults).
const LIBWEBP_OPTIONS = {
  quality: 75, target_size: 0, target_PSNR: 0, method: 4, sns_strength: 50,
  filter_strength: 60, filter_sharpness: 0, filter_type: 1, partitions: 0, segments: 4,
  pass: 1, show_compressed: 0, preprocessing: 0, autofilter: 0, partition_limit: 0,
  alpha_compression: 1, alpha_filtering: 1, alpha_quality: 100, lossless: 0, exact: 0,
  image_hint: 0, emulate_jpeg_size: 0, thread_level: 0, low_memory: 0, near_lossless: 100,
  use_delta_palette: 0, use_sharp_yuv: 0,
};

let libwebp = null;
function loadLibwebp() {
  if (!libwebp) {
    libwebp = import('./vendor/webp/webp_enc.js')
      .then((m) => m.default({ noInitialRun: true }))
      .catch((err) => { libwebp = null; throw err; });
  }
  return libwebp;
}

async function encodeOnce(img, width, height, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  if (await canvasCanMakeWebp()) return canvasToBlob(canvas, 'image/webp', quality);

  const pixels = ctx.getImageData(0, 0, width, height);
  const encoder = await loadLibwebp();
  const bytes = encoder.encode(pixels.data, width, height, { ...LIBWEBP_OPTIONS, quality: Math.round(quality * 100) });
  if (!bytes) throw new Error('WebP encoding failed');
  return new Blob([bytes], { type: 'image/webp' });
}

// Any picture Blob (JPEG, PNG, WebP) -> WebP Blob of at most 3 MB.
// Transparent drawings stay transparent. If a picture is too big, the quality
// goes down a little, then (only if still needed) the size.
export async function toWebp(blob, quality = 0.82) {
  const img = await loadImage(blob);
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  let q = quality;
  for (let attempt = 0; attempt < 10; attempt++) {
    const out = await encodeOnce(img, w, h, q);
    if (out.size <= MAX_WEBP_BYTES) return out;
    if (q > 0.5) q -= 0.15;
    else { w = Math.max(1, Math.round(w * 0.8)); h = Math.max(1, Math.round(h * 0.8)); }
  }
  throw new Error('This picture is too big to upload, even after shrinking it.');
}
