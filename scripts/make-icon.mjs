/**
 * 生成应用图标（build/icon.png + build/icon.ico）。
 * 纯代码绘制，不依赖图形库：4× 超采样后缩小，得到平滑边缘。
 *
 * 用法：npm run icon
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { encodePng } from '../server/media/pngEncode.js';

const SIZE = 256;
const SCALE = 4;
const BIG = SIZE * SCALE;

const BG_TOP = [32, 31, 30];
const BG_BOTTOM = [18, 17, 16];
const ACCENT = [169, 155, 255];
const BORDER = [58, 56, 52];

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** 点到线段的距离（用于画粗线 + 圆头） */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return Math.hypot(px - cx, py - cy);
}

function inRoundedRect(x, y, size, radius) {
  const r = radius;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

// 以 256 为基准的图形参数，绘制时乘 SCALE
const GLYPH = {
  left: [80, 188, 128, 68],
  right: [176, 188, 128, 68],
  bar: [99, 148, 157, 148],
  width: 17,
};

function renderBig() {
  const pixels = Buffer.alloc(BIG * BIG * 3);
  for (let y = 0; y < BIG; y += 1) {
    for (let x = 0; x < BIG; x += 1) {
      const u = x / SCALE;
      const v = y / SCALE;
      let color = [0, 0, 0];

      if (!inRoundedRect(u, v, SIZE, 58)) {
        color = [0, 0, 0];
      } else {
        color = mix(BG_TOP, BG_BOTTOM, v / SIZE);
        // 内描边
        const edge = Math.min(u, v, SIZE - u, SIZE - v);
        if (edge < 2.5) color = mix(color, BORDER, 0.9);
        // 顶部高光
        color = mix(color, [255, 255, 255], Math.max(0, 0.05 - v / SIZE / 10));
      }

      if (inRoundedRect(u, v, SIZE, 58)) {
        const d = Math.min(
          distanceToSegment(u, v, ...GLYPH.left),
          distanceToSegment(u, v, ...GLYPH.right),
          distanceToSegment(u, v, ...GLYPH.bar),
        );
        if (d <= GLYPH.width / 2) color = ACCENT;
        else if (d <= GLYPH.width / 2 + 1.2) color = mix(ACCENT, color, (d - GLYPH.width / 2) / 1.2);
      }

      const offset = (y * BIG + x) * 3;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
    }
  }
  return pixels;
}

function downsample(pixels) {
  const out = Buffer.alloc(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SCALE; sy += 1) {
        for (let sx = 0; sx < SCALE; sx += 1) {
          const offset = ((y * SCALE + sy) * BIG + (x * SCALE + sx)) * 3;
          r += pixels[offset];
          g += pixels[offset + 1];
          b += pixels[offset + 2];
        }
      }
      const count = SCALE * SCALE;
      const target = (y * SIZE + x) * 3;
      out[target] = Math.round(r / count);
      out[target + 1] = Math.round(g / count);
      out[target + 2] = Math.round(b / count);
    }
  }
  return out;
}

function toIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry[0] = 0; // 256
  entry[1] = 0;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}

const big = renderBig();
const small = downsample(big);
const png = encodePng({ width: SIZE, height: SIZE, pixel: (x, y) => {
  const offset = (y * SIZE + x) * 3;
  return [small[offset], small[offset + 1], small[offset + 2]];
} });

const outDir = path.resolve('build');
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'icon.png'), png);
await fs.writeFile(path.join(outDir, 'icon.ico'), toIco(png));
console.log(`已生成 ${path.join(outDir, 'icon.png')} 与 icon.ico（${SIZE}×${SIZE}）`);
