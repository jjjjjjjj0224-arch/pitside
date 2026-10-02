// Photo helpers: load, resize and make thumbnails using a <canvas>.

export const MAX_PHOTO_SIDE = 1600;   // longest side of a saved photo, in pixels
export const MAX_PHOTOS = 10;         // photos per entry

// An entry's photos as a list of { photo, drawing } (each drawing belongs to its photo).
// Entries saved before multiple photos have single `photo` and `drawing` fields instead.
export function photosOf(entry) {
  if (Array.isArray(entry.photos)) return entry.photos;
  return entry.photo ? [{ photo: entry.photo, drawing: entry.drawing || null }] : [];
}
const JPEG_QUALITY = 0.8;
const THUMB_SIZE = 320;

// Turn a Blob/File into a loaded <img>. Modern browsers apply the photo's
// rotation (EXIF) automatically, so phone photos come out the right way up.
export function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image')); };
    img.src = url;
  });
}

// canvas.toBlob, but as a Promise.
export function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not create image'))), type, quality);
  });
}

// Shrink a picked photo so its longest side is at most 1600 px, save as JPEG.
export async function resizePhoto(file) {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';            // screenshots can be transparent; JPEG can't
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY);
}

// Small square thumbnail for the Home list: photo with the drawing on top,
// cropped to fill the square. Saved with the entry so the list loads fast.
export async function makeThumbnail(photoBlob, drawingBlob) {
  if (!photoBlob) return null;
  const photo = await loadImage(photoBlob);
  const drawing = drawingBlob ? await loadImage(drawingBlob) : null;
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_SIZE;
  canvas.height = THUMB_SIZE;
  const ctx = canvas.getContext('2d');
  // "cover" crop: scale so the short side fills the square, centre the rest.
  const w = photo.naturalWidth;
  const h = photo.naturalHeight;
  const scale = THUMB_SIZE / Math.min(w, h);
  const dw = w * scale;
  const dh = h * scale;
  const dx = (THUMB_SIZE - dw) / 2;
  const dy = (THUMB_SIZE - dh) / 2;
  ctx.drawImage(photo, dx, dy, dw, dh);
  if (drawing) ctx.drawImage(drawing, dx, dy, dw, dh);
  return canvasToBlob(canvas, 'image/jpeg', 0.75);
}

// A full-size copy of a photo for downloading: the drawing (if any) is merged on top.
// The saved photo itself is never changed. { photo, drawing } -> JPEG Blob
export async function flattenPhoto({ photo, drawing }) {
  if (!drawing) return photo;
  const img = await loadImage(photo);
  const over = await loadImage(drawing);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  ctx.drawImage(over, 0, 0, canvas.width, canvas.height);
  return canvasToBlob(canvas, 'image/jpeg', 0.9);
}

// Work out where to draw a w x h image so it fits inside a box ("contain").
export function fitContain(w, h, box) {
  const scale = Math.min(box.w / w, box.h / h);
  const dw = w * scale;
  const dh = h * scale;
  return { x: box.x + (box.w - dw) / 2, y: box.y + (box.h - dh) / 2, w: dw, h: dh };
}
