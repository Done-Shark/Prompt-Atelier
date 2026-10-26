/**
 * PNG chunk 解析：只关心文本块与 IHDR 尺寸。
 * 支持 tEXt（未压缩）、zTXt（deflate）、iTXt（可选压缩 + UTF-8）。
 */
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPng(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 8 && buffer.subarray(0, 8).equals(SIGNATURE);
}

/**
 * 遍历 chunk（不校验 CRC，损坏时尽早停止）。
 * @returns {{type: string, data: Buffer, offset: number}[]}
 */
export function readChunks(buffer) {
  if (!isPng(buffer)) return [];
  const chunks = [];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (length < 0 || dataEnd + 4 > buffer.length) break;
    chunks.push({ type, data: buffer.subarray(dataStart, dataEnd), offset });
    offset = dataEnd + 4; // 跳过 CRC
    if (type === 'IEND') break;
  }
  return chunks;
}

/** 读取 IHDR 尺寸 */
export function readSize(buffer) {
  const ihdr = readChunks(buffer).find((chunk) => chunk.type === 'IHDR');
  if (!ihdr || ihdr.data.length < 8) return null;
  return { width: ihdr.data.readUInt32BE(0), height: ihdr.data.readUInt32BE(4) };
}

/**
 * 解出所有文本块，返回 key → value 的普通对象（同名后者覆盖）。
 */
export function readTextChunks(buffer) {
  const result = {};
  for (const chunk of readChunks(buffer)) {
    const entry = decodeTextChunk(chunk);
    if (entry) result[entry.key] = entry.value;
  }
  return result;
}

function decodeTextChunk(chunk) {
  try {
    if (chunk.type === 'tEXt') {
      const sep = chunk.data.indexOf(0);
      if (sep < 0) return null;
      const key = chunk.data.toString('latin1', 0, sep);
      const value = decodeText(chunk.data.subarray(sep + 1));
      return { key, value };
    }

    if (chunk.type === 'zTXt') {
      const sep = chunk.data.indexOf(0);
      if (sep < 0 || sep + 2 > chunk.data.length) return null;
      const key = chunk.data.toString('latin1', 0, sep);
      // sep+1 是压缩方法（0 = deflate）
      const compressed = chunk.data.subarray(sep + 2);
      const value = zlib.inflateSync(compressed).toString('utf8');
      return { key, value };
    }

    if (chunk.type === 'iTXt') {
      const sep = chunk.data.indexOf(0);
      if (sep < 0 || sep + 3 > chunk.data.length) return null;
      const key = chunk.data.toString('latin1', 0, sep);
      const compressedFlag = chunk.data[sep + 1];
      // sep+2 压缩方法；随后是 languageTag\0 translatedKeyword\0 text
      let cursor = sep + 3;
      const langEnd = chunk.data.indexOf(0, cursor);
      if (langEnd < 0) return null;
      cursor = langEnd + 1;
      const translatedEnd = chunk.data.indexOf(0, cursor);
      if (translatedEnd < 0) return null;
      cursor = translatedEnd + 1;
      const payload = chunk.data.subarray(cursor);
      const value = compressedFlag === 1 ? zlib.inflateSync(payload).toString('utf8') : payload.toString('utf8');
      return { key, value };
    }
  } catch {
    // 单个文本块损坏不影响其他块
    return null;
  }
  return null;
}

/** tEXt 历史上用 latin1，但 NAI 实际写 UTF-8；优先按 UTF-8 解码 */
function decodeText(buffer) {
  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('\uFFFD')) return utf8;
  return buffer.toString('latin1');
}
