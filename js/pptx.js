// Editable slides: a PowerPoint file (.pptx) with one 16:9 slide per entry.
// Every photo and every piece of text is its own object, so you can move,
// resize and reword them yourself (Google Slides: File > Import slides, or open
// the file in PowerPoint / Keynote).
//
// Each slide: a title line (type, stage, date, author, match), all the entry's
// photos in a grid with each photo's note under it, and the caption on the right.
//
// A .pptx is a ZIP of XML files; this writes the smallest set PowerPoint and
// Google Slides accept (one master, one blank layout, a theme).

import { makeZip } from './zip.js';
import { photosOf, flattenPhoto, loadImage } from './image.js';
import { entryTitle, matchSummary, testSummary, testStats, witnessText } from './entrydata.js';
import { captionPoints, renderTestImage } from './render.js';

const EMU = 914400;                    // EMUs per inch
const SLIDE_W = 12192000;              // 13.333 in (16:9)
const SLIDE_H = 6858000;               // 7.5 in
const in2emu = (inches) => Math.round(inches * EMU);
const MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const xmlEsc = (s) => String(s ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
  + 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// entries: oldest first is nice for a notebook. settings: for the caption options.
// onProgress(done, total). Returns a Blob (.pptx).
export async function buildPptx(entries, settings, onProgress = () => {}) {
  const files = [];
  const slides = [];
  let imageNo = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const images = [];
    for (const p of photosOf(e)) {
      const jpeg = await flattenPhoto(p);
      const img = await loadImage(jpeg);
      imageNo += 1;
      const name = `image${imageNo}.jpeg`;
      files.push({ name: `ppt/media/${name}`, data: jpeg });
      images.push({ name, w: img.naturalWidth, h: img.naturalHeight, note: (p.note || '').trim() });
    }
    // Test results: their table + chart as one more picture you can move.
    if (testStats(e.testData)) {
      imageNo += 1;
      const name = `image${imageNo}.png`;
      files.push({ name: `ppt/media/${name}`, data: await renderTestImage(e.testData) });
      images.push({ name, w: 1600, h: 900, note: '', label: 'Test results' });
    }
    slides.push(slideXml(e, images, settings.export[e.type] || {}));
    onProgress(i + 1, entries.length);
  }

  const n = slides.length;
  const out = [
    { name: '[Content_Types].xml', data: contentTypes(n) },
    { name: '_rels/.rels', data: rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]) },
    { name: 'docProps/app.xml', data: `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>PitSide</Application></Properties>` },
    { name: 'docProps/core.xml', data: `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>PitSide entries</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>` },
    { name: 'ppt/presentation.xml', data: presentation(n) },
    { name: 'ppt/_rels/presentation.xml.rels', data: rels([
      ['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
      ['rId2', 'theme', 'theme/theme1.xml'],
      ['rId3', 'presProps', 'presProps.xml'],
      ['rId4', 'viewProps', 'viewProps.xml'],
      ['rId5', 'tableStyles', 'tableStyles.xml'],
      ...slides.map((_, i) => [`rId${10 + i}`, 'slide', `slides/slide${i + 1}.xml`]),
    ]) },
    { name: 'ppt/presProps.xml', data: `${XML}<p:presentationPr ${NS}/>` },
    { name: 'ppt/viewProps.xml', data: `${XML}<p:viewPr ${NS}/>` },
    { name: 'ppt/tableStyles.xml', data: `${XML}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>` },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: master() },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: rels([
      ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
      ['rId2', 'theme', '../theme/theme1.xml'],
    ]) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: layout() },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]) },
    { name: 'ppt/theme/theme1.xml', data: theme() },
  ];
  slides.forEach((s, i) => {
    out.push({ name: `ppt/slides/slide${i + 1}.xml`, data: s.xml });
    out.push({ name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: rels([
      ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
      ...s.images.map((name, k) => [`rId${k + 2}`, 'image', `../media/${name}`]),
    ]) });
  });
  const zip = await makeZip([...out, ...files]);
  return new Blob([zip], { type: MIME });
}

// ---- One slide ----

function slideXml(entry, images, options) {
  let id = 1;
  const shapes = [];
  const M = 0.4;   // margin, inches

  // Title line: "Build - Intake  ·  Friday, October 9, 2026  ·  Yvonne  ·  Match Q12"
  const d = new Date(entry.createdAt);
  const title = [
    entryTitle(entry),
    d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    entry.author || '',
    entry.matchNumber ? `Match ${entry.matchNumber}` : '',
  ].filter(Boolean).join('  ·  ');
  shapes.push(textBox(++id, 'Title', { x: M, y: 0.25, w: 13.333 - M * 2, h: 0.6 }, [{ text: title }], { size: 22, bold: true }));

  // Details (match result, test summary, witness) and the caption, on the right
  // (or across the slide when there are no photos).
  const captionArea = images.length
    ? { x: 8.75, y: 1.05, w: 13.333 - 8.75 - M, h: 7.5 - 1.05 - M }
    : { x: M, y: 1.05, w: 13.333 - M * 2, h: 7.5 - 1.05 - M };
  const details = [matchSummary(entry.match), testSummary(entry.testData), witnessText(entry)].filter(Boolean);
  const caption = (entry.caption || '').trim();
  if (details.length || caption) {
    const paras = [
      ...details.map((text) => ({ text, muted: true })),
      ...(details.length && caption ? [{ text: '' }] : []),
      ...(!caption ? [] : options.bullets
        ? captionPoints(caption).map((text) => ({ text, bullet: true }))
        : caption.split(/\r?\n/).map((text) => ({ text }))),
    ];
    shapes.push(textBox(++id, 'Caption', captionArea, paras, { size: 16 }));
  }

  // Photos in a grid, each with its note in a text box underneath.
  const rIds = [];
  if (images.length) {
    const hasNotes = images.some((im) => im.note);
    const noteH = hasNotes ? 0.45 : 0;
    const area = { x: M, y: 1.05, w: 8.75 - M - 0.3, h: 7.5 - 1.05 - M };
    gridCells(area, images.length, 0.2, noteH).forEach((cell, k) => {
      const im = images[k];
      const photoBox = { x: cell.x, y: cell.y, w: cell.w, h: cell.h - noteH };
      const s = Math.min(photoBox.w / im.w, photoBox.h / im.h);
      const w = im.w * s;
      const h = im.h * s;
      const r = { x: photoBox.x + (photoBox.w - w) / 2, y: photoBox.y + (photoBox.h - h) / 2, w, h };
      rIds.push(im.name);
      shapes.push(picture(++id, im.label || `Photo ${k + 1}`, `rId${k + 2}`, r));
      if (im.note) {
        shapes.push(textBox(++id, `Photo ${k + 1} note`, { x: cell.x, y: r.y + r.h + 0.03, w: cell.w, h: noteH }, [{ text: im.note }], { size: 12 }));
      }
    });
  }

  const xml = `${XML}<p:sld ${NS}><p:cSld><p:spTree>`
    + '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
    + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
    + `${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  return { xml, images: rIds };
}

// Grid cells (inches) for `count` photos, best fit for 4:3 photos plus a note line.
function gridCells(box, count, gap, noteH) {
  let best = null;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const w = (box.w - gap * (cols - 1)) / cols;
    const h = (box.h - gap * (rows - 1)) / rows;
    const score = Math.min(w / 4, (h - noteH) / 3);
    if (!best || score > best.score) best = { cols, w, h, score };
  }
  return Array.from({ length: count }, (_, i) => ({
    x: box.x + (i % best.cols) * (best.w + gap),
    y: box.y + Math.floor(i / best.cols) * (best.h + gap),
    w: best.w,
    h: best.h,
  }));
}

const xfrm = (b) => `<a:xfrm><a:off x="${in2emu(b.x)}" y="${in2emu(b.y)}"/><a:ext cx="${in2emu(b.w)}" cy="${in2emu(b.h)}"/></a:xfrm>`;

// paras: [{ text, bullet, muted }]. The text shrinks to fit when edited (normAutofit).
function textBox(id, name, box, paras, { size = 16, bold = false } = {}) {
  const body = paras.map((p) => {
    const ppr = p.bullet
      ? '<a:pPr marL="285750" indent="-285750"><a:buFont typeface="Arial"/><a:buChar char="&#8226;"/></a:pPr>'
      : '<a:pPr><a:buNone/></a:pPr>';
    const run = p.text
      ? `<a:r><a:rPr lang="en-US" sz="${(p.muted ? size - 2 : size) * 100}"${bold ? ' b="1"' : ''} dirty="0"><a:solidFill><a:srgbClr val="${p.muted ? '4B5563' : '111827'}"/></a:solidFill></a:rPr><a:t>${xmlEsc(p.text)}</a:t></a:r>`
      : '';
    return `<a:p>${ppr}${run}<a:endParaRPr lang="en-US" sz="${size * 100}" dirty="0"/></a:p>`;
  }).join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xmlEsc(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr>${xfrm(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`
    + `<p:txBody><a:bodyPr wrap="square" lIns="45720" tIns="45720" rIns="45720" bIns="45720" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>${body}</p:txBody></p:sp>`;
}

function picture(id, name, rId, box) {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${xmlEsc(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`
    + `<p:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>`
    + `<p:spPr>${xfrm(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

// ---- The fixed parts of the package ----

function rels(list) {
  return `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')
    + '</Relationships>';
}

function contentTypes(n) {
  const pml = 'application/vnd.openxmlformats-officedocument.presentationml';
  return `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Default Extension="jpeg" ContentType="image/jpeg"/>'
    + '<Default Extension="png" ContentType="image/png"/>'
    + `<Override PartName="/ppt/presentation.xml" ContentType="${pml}.presentation.main+xml"/>`
    + `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${pml}.slideMaster+xml"/>`
    + `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${pml}.slideLayout+xml"/>`
    + '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
    + `<Override PartName="/ppt/presProps.xml" ContentType="${pml}.presProps+xml"/>`
    + `<Override PartName="/ppt/viewProps.xml" ContentType="${pml}.viewProps+xml"/>`
    + `<Override PartName="/ppt/tableStyles.xml" ContentType="${pml}.tableStyles+xml"/>`
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
    + Array.from({ length: n }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="${pml}.slide+xml"/>`).join('')
    + '</Types>';
}

function presentation(n) {
  return `${XML}<p:presentation ${NS} saveSubsetFonts="1">`
    + '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
    + `<p:sldIdLst>${Array.from({ length: n }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${10 + i}"/>`).join('')}</p:sldIdLst>`
    + `<p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="${SLIDE_H}" cy="${SLIDE_W}"/>`
    + '<p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:defaultTextStyle>'
    + '</p:presentation>';
}

const EMPTY_TREE = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
  + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';

function master() {
  return `${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${EMPTY_TREE}</p:cSld>`
    + '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
    + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>'
    + '<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3200"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles>'
    + '</p:sldMaster>';
}

function layout() {
  return `${XML}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank">${EMPTY_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

function theme() {
  const clr = (name, hex) => `<a:${name}><a:srgbClr val="${hex}"/></a:${name}>`;
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const line = (w) => `<a:ln w="${w}"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>`;
  return `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="PitSide"><a:themeElements>`
    + '<a:clrScheme name="PitSide">'
    + '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>'
    + clr('dk2', '1F2937') + clr('lt2', 'F3F4F6') + clr('accent1', 'C2410C') + clr('accent2', 'B91C1C')
    + clr('accent3', '1D4ED8') + clr('accent4', '15803D') + clr('accent5', '6D28D9') + clr('accent6', '0E7490')
    + clr('hlink', '1D4ED8') + clr('folHlink', '6D28D9')
    + '</a:clrScheme>'
    + '<a:fontScheme name="PitSide"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
    + '<a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
    + `<a:fmtScheme name="PitSide"><a:fillStyleLst>${fill}${fill}${fill}</a:fillStyleLst>`
    + `<a:lnStyleLst>${line(6350)}${line(12700)}${line(19050)}</a:lnStyleLst>`
    + '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
    + `<a:bgFillStyleLst>${fill}${fill}${fill}</a:bgFillStyleLst></a:fmtScheme>`
    + '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
}
