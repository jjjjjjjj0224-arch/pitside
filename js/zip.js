// A minimal ZIP file writer (used instead of the JSZip library).
//
// Files are "stored" (not compressed): PNG, JPEG and audio are already
// compressed, so compressing again would barely help. A ZIP file is simply:
//   [local header + file data] for each file
//   [central directory: one record per file]
//   [end record]
// Every number is little-endian. Each file needs a CRC-32 checksum.

// CRC-32 lookup table (standard ZIP polynomial 0xEDB88320).
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ZIP stores dates in the old MS-DOS format.
function dosDateTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

// files: [{ name: 'a.png', data: Blob | string, date: Date }]
// Returns a Blob of type application/zip.
export async function makeZip(files) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const data = typeof file.data === 'string'
      ? encoder.encode(file.data)
      : new Uint8Array(await file.data.arrayBuffer());
    const name = encoder.encode(file.name);
    const crc = crc32(data);
    const { time, date } = dosDateTime(file.date || new Date());
    const UTF8_NAMES = 0x0800;   // flag: file names are UTF-8

    // Local file header (30 bytes + name)
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);   // signature
    local.setUint16(4, 20, true);           // version needed (2.0)
    local.setUint16(6, UTF8_NAMES, true);
    local.setUint16(8, 0, true);            // method 0 = stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); // compressed size
    local.setUint32(22, data.length, true); // uncompressed size
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);           // extra field length
    parts.push(local.buffer, name, data);

    // Central directory record (46 bytes + name)
    const rec = new DataView(new ArrayBuffer(46));
    rec.setUint32(0, 0x02014b50, true);     // signature
    rec.setUint16(4, 20, true);             // version made by
    rec.setUint16(6, 20, true);             // version needed
    rec.setUint16(8, UTF8_NAMES, true);
    rec.setUint16(10, 0, true);             // stored
    rec.setUint16(12, time, true);
    rec.setUint16(14, date, true);
    rec.setUint32(16, crc, true);
    rec.setUint32(20, data.length, true);
    rec.setUint32(24, data.length, true);
    rec.setUint16(28, name.length, true);
    // 30: extra len, 32: comment len, 34: disk, 36: internal attrs, 38: external attrs = 0
    rec.setUint32(42, offset, true);        // where this file's local header starts
    central.push(rec.buffer, name);

    offset += 30 + name.length + data.length;
  }

  const centralSize = central.reduce((sum, p) => sum + p.byteLength, 0);

  // End of central directory record (22 bytes)
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);     // entries on this disk
  end.setUint16(10, files.length, true);    // total entries
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);          // central directory starts here

  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

// Read a ZIP made by makeZip (files stored, not compressed): Map of name -> Blob.
// Used to restore backups. Throws if it isn't a ZIP or a file is compressed.
export async function readZip(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  // The end record is in the last 22 bytes (+ an optional comment of up to 64 KB).
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('not_a_zip');
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);     // start of the central directory
  const decoder = new TextDecoder();
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('bad_zip');
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (method !== 0) throw new Error('compressed_zip');
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    files.set(name, new Blob([bytes.subarray(dataStart, dataStart + size)]));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
