// Opens a notebook PDF and turns its pages into pictures (for picking a sample page).
// Uses Mozilla's pdf.js, bundled in js/vendor/pdfjs and only loaded when needed.
// Everything happens on the phone: the PDF is never uploaded.

let pdfjs = null;
async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('./vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}

// file: a PDF File. Returns { pageCount, render(pageNumber, width) -> canvas, close() }.
export async function openPdf(file) {
  const lib = await loadPdfjs();
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  return {
    pageCount: doc.numPages,
    // Draw one page (1 = first) into a canvas that is `width` pixels wide.
    async render(pageNumber, width) {
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, canvas, viewport }).promise;
      page.cleanup();
      return canvas;
    },
    // (Newer pdf.js versions free the document through its loading task.)
    close: () => task.destroy(),
  };
}
