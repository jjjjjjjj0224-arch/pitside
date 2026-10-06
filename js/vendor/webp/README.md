# WebP encoder (vendored)

`webp_enc.js` + `webp_enc.wasm` are Google's libwebp encoder compiled to WebAssembly,
from the npm package [`@jsquash/webp`](https://github.com/jamsinclair/jSquash) version 1.5.0
(`codec/enc/`), unchanged. Checksum of the package was verified against the npm registry.

PitSide uses it only on browsers that can't make WebP images with a canvas
(Safari and every browser on iPhone/iPad). See `js/webp.js`.

Licenses: `LICENSE.txt` (Apache-2.0, jSquash/Squoosh) and `LICENSE.libwebp.md` (libwebp, BSD).
