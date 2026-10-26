/**
 * SillyTavern 角色卡解析：JSON / PNG(chara) / 字段映射。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cardToFields, decodeCardPayload, parseRpCard } from './rpCard.js';

const CARD = {
  spec: 'chara_card_v2',
  data: {
    name: '银发骑士',
    description: '一位沉默的银发骑士，守护北境。',
    personality: '冷静、寡言、重视承诺。',
    scenario: '边境要塞的冬夜。',
    creator_notes: '适合慢热剧情。',
    tags: ['骑士', '银发', '奇幻'],
    first_mes: '你来了。',
  },
};

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, data, Buffer.alloc(4)]);
}

function pngWithCard(card) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(64, 0);
  ihdr.writeUInt32BE(64, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const payload = Buffer.from(JSON.stringify(card), 'utf8').toString('base64');
  const text = Buffer.concat([Buffer.from('chara', 'latin1'), Buffer.from([0]), Buffer.from(payload, 'utf8')]);
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('tEXt', text), chunk('IEND', Buffer.alloc(0))]);
}

test('decodeCardPayload：base64 与原始 JSON 都能解', () => {
  assert.equal(decodeCardPayload(Buffer.from(JSON.stringify(CARD)).toString('base64')).data.name, '银发骑士');
  assert.equal(decodeCardPayload(JSON.stringify(CARD)).data.name, '银发骑士');
  assert.equal(decodeCardPayload('not a card'), null);
});

test('cardToFields：简介取作者备注，设定取性格+场景，Prompt 取描述全文', () => {
  const fields = cardToFields(CARD);
  assert.equal(fields.name, '银发骑士');
  assert.deepEqual(fields.tags, ['骑士', '银发', '奇幻']);
  assert.match(fields.settings, /冷静、寡言/);
  assert.match(fields.settings, /场景：边境要塞的冬夜/);
  assert.equal(fields.description, '适合慢热剧情。');
  assert.equal(fields.prompt, '一位沉默的银发骑士，守护北境。');
});

test('parseRpCard：PNG 的 chara 块', () => {
  const parsed = parseRpCard(pngWithCard(CARD));
  assert.equal(parsed.source, 'png');
  assert.equal(parsed.name, '银发骑士');
  assert.deepEqual(parsed.tags, ['骑士', '银发', '奇幻']);
});

test('parseRpCard：JSON 文件与扁平结构', () => {
  const parsed = parseRpCard(Buffer.from(JSON.stringify(CARD), 'utf8'));
  assert.equal(parsed.source, 'json');
  assert.equal(parsed.name, '银发骑士');

  const flat = parseRpCard(Buffer.from(JSON.stringify({ name: '扁平卡', description: '描述' }), 'utf8'));
  assert.equal(flat.name, '扁平卡');
  assert.equal(flat.prompt, '描述');
});

test('parseRpCard：普通图片 / 空文件返回 null', () => {
  assert.equal(parseRpCard(Buffer.from('hello')), null);
  assert.equal(parseRpCard(Buffer.alloc(0)), null);
});
