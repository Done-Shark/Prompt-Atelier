/**
 * 极简 PNG 编码器：只为演示数据与测试生成真实可解码的图片。
 * 支持在 IHDR 之后插入 tEXt / zTXt / iTXt 文本块。
 */
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function textChunk({ key, value, type = 'tEXt', compress = false }) {
  const keyBuf = Buffer.from(key, 'latin1');
  const valueBuf = Buffer.from(value, 'utf8');
  if (type === 'zTXt') {
    const data = Buffer.concat([keyBuf, Buffer.from([0, 0]), zlib.deflateSync(valueBuf)]);
    return chunk('zTXt', data);
  }
  if (type === 'iTXt') {
    const flag = compress ? 1 : 0;
    const payload = compress ? zlib.deflateSync(valueBuf) : valueBuf;
    const head = Buffer.concat([
      keyBuf,
      Buffer.from([0, flag, 0]),
      Buffer.from('', 'latin1'), // languageTag
      Buffer.from([0]),
      Buffer.from('', 'utf8'), // translatedKeyword
      Buffer.from([0]),
    ]);
    return chunk('iTXt', Buffer.concat([head, payload]));
  }
  return chunk('tEXt', Buffer.concat([keyBuf, Buffer.from([0]), valueBuf]));
}

/**
 * @param {{ width: number, height: number, textChunks?: object[], pixel?: (x:number,y:number)=>[number,number,number] }} options
 * @returns {Buffer}
 */
export function encodePng(options) {
  const { width, height, textChunks = [], pixel } = options;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(height * (width * 3 + 1));
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    raw[cursor] = 0; // filter: none
    cursor += 1;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel
        ? pixel(x, y)
        : [Math.round((x / Math.max(1, width - 1)) * 255), Math.round((y / Math.max(1, height - 1)) * 255), 128];
      raw[cursor] = r & 0xff;
      raw[cursor + 1] = g & 0xff;
      raw[cursor + 2] = b & 0xff;
      cursor += 3;
    }
  }

  const parts = [SIGNATURE, chunk('IHDR', ihdr)];
  for (const item of textChunks) parts.push(textChunk(item));
  parts.push(chunk('IDAT', zlib.deflateSync(raw, { level: 9 })));
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
