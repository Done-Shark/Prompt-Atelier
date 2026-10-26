/**
 * 图片尺寸/类型嗅探：不依赖元数据，直接读文件头。
 */
import { isPng, readSize as readPngSize } from './png.js';

export function sniffFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (isPng(buffer)) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** 统一入口：{ format, ext, width, height } */
export function probe(buffer) {
  const format = sniffFormat(buffer);
  const size = format ? readSizeByFormat(buffer, format) : null;
  return {
    format,
    ext: format === 'jpeg' ? 'jpg' : format,
    width: size?.width ?? null,
    height: size?.height ?? null,
  };
}

export function readSizeByFormat(buffer, format) {
  if (format === 'png') return readPngSize(buffer);
  if (format === 'jpeg') return readJpegSize(buffer);
  if (format === 'webp') return readWebpSize(buffer);
  return null;
}

/** 逐段扫描 JPEG，遇到 SOFn 读出宽高 */
function readJpegSize(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (offset + 9 > buffer.length) return null;
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    if (marker === 0xda) return null; // 进入扫描数据，停止
    offset += 2 + length;
  }
  return null;
}

function readWebpSize(buffer) {
  const chunk = buffer.toString('latin1', 12, 16);
  if (chunk === 'VP8 ' && buffer.length >= 30) {
    // 有损：帧头 3 字节后是 14 位宽高
    const start = 26;
    const width = buffer.readUInt16LE(start) & 0x3fff;
    const height = buffer.readUInt16LE(start + 2) & 0x3fff;
    return { width, height };
  }
  if (chunk === 'VP8L' && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === 'VP8X' && buffer.length >= 30) {
    return {
      width: buffer.readUIntLE(24, 3) + 1,
      height: buffer.readUIntLE(27, 3) + 1,
    };
  }
  return null;
}
