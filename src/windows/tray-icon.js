// tray-icon.js — Mysthi's menu-bar icon: a cat head with two eye holes, drawn as a macOS template image
const { nativeImage } = require('electron');

const SIZE = 18;  // menu-bar points
const SCALE = 2;  // drawn at @2x for Retina
const SAMPLES = 4; // 4×4 supersampling per pixel for smooth edges

// Is point (x, y), in 18-point icon space, inside the cat head?
function inside(x, y) {
  const inCircle = (cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  const inTriangle = (ax, ay, bx, by, cx, cy) => {
    const s = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
    const d1 = s(x, y, ax, ay, bx, by), d2 = s(x, y, bx, by, cx, cy), d3 = s(x, y, cx, cy, ax, ay);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  const head = inCircle(9, 10.6, 6.4)
    || inTriangle(3.2, 8.4, 4.0, 1.6, 8.0, 5.2)    // left ear
    || inTriangle(10.0, 5.2, 14.0, 1.6, 14.8, 8.4); // right ear
  const eyes = inCircle(6.6, 10.4, 1.7) || inCircle(11.4, 10.4, 1.7);
  return head && !eyes;
}

function createTrayIcon() {
  const px = SIZE * SCALE;
  const buf = Buffer.alloc(px * px * 4); // BGRA, black with coverage as alpha
  for (let py = 0; py < px; py++) {
    for (let pxX = 0; pxX < px; pxX++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (pxX + (sx + 0.5) / SAMPLES) / SCALE;
          const y = (py + (sy + 0.5) / SAMPLES) / SCALE;
          if (inside(x, y)) hits++;
        }
      }
      buf[(py * px + pxX) * 4 + 3] = Math.round((255 * hits) / (SAMPLES * SAMPLES));
    }
  }
  const image = nativeImage.createFromBitmap(buf, { width: px, height: px, scaleFactor: SCALE });
  image.setTemplateImage(true); // macOS tints it to match light and dark menu bars
  return image;
}

module.exports = { createTrayIcon };
