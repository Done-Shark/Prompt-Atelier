/**
 * RP 角色卡：原图落盘、增删改查、PNG / JSON 导入与去重。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openTestDb } from '../../testing/helpers.js';
import * as characters from './service.js';
import * as folders from '../folders/service.js';

const CARD = {
  spec: 'chara_card_v2',
  data: {
    name: '银发骑士',
    description: '一位沉默的银发骑士。',
    personality: '冷静、寡言。',
    scenario: '北境要塞。',
    creator_notes: '慢热剧情。',
    tags: ['骑士', '银发'],
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

test('创建 / 读取 / 更新 / 删除：原图按 rp/<hash>.png 落盘', async (t) => {
  const { db, dir } = await openTestDb(t);
  const ctx = { db, config: { imagesDir: path.join(dir, 'images'), dataDir: dir } };
  const buffer = pngWithCard(CARD);

  const created = await characters.create(ctx, {
    name: '手动卡',
    tags: ['测试'],
    settings: '设定',
    description: '简介',
    prompt: 'Prompt 正文',
    image: buffer.toString('base64'),
    originalName: 'card.png',
  });

  assert.equal(created.imageExt, 'png');
  assert.match(created.imageFile, /^rp\/[a-f0-9]{64}\.png$/);
  const abs = characters.imagePathOf(ctx.config, created);
  assert.ok((await fs.stat(abs)).size > 0);
  // 原图逐字节保存
  assert.deepEqual(await fs.readFile(abs), buffer);

  const listed = characters.list(db, { q: '手动' });
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0].name, '手动卡');

  const updated = await characters.update(ctx, created.id, { name: '改名后', tags: ['a', 'b'] });
  assert.equal(updated.name, '改名后');
  assert.deepEqual(updated.tags, ['a', 'b']);

  await characters.remove(ctx, created.id);
  assert.equal(characters.list(db).total, 0);
  await assert.rejects(() => fs.stat(abs));
});

test('导入：PNG 解析字段，重复图片跳过', async (t) => {
  const { db, dir } = await openTestDb(t);
  const ctx = { db, config: { imagesDir: path.join(dir, 'images'), dataDir: dir } };
  const data = pngWithCard(CARD).toString('base64');

  const first = await characters.importCards(ctx, { files: [{ name: 'card.png', data }] });
  assert.equal(first.imported.length, 1);
  assert.equal(first.skipped.length, 0);
  const card = first.imported[0];
  assert.equal(card.name, '银发骑士');
  assert.deepEqual(card.tags, ['骑士', '银发']);
  assert.match(card.settings, /冷静、寡言/);
  assert.equal(card.description, '慢热剧情。');
  assert.equal(card.prompt, '一位沉默的银发骑士。');
  assert.equal(card.source, 'png');
  assert.ok(card.imageFile);

  const again = await characters.importCards(ctx, { files: [{ name: 'card.png', data }] });
  assert.equal(again.imported.length, 0);
  assert.match(again.skipped[0].reason, /同名|重复/);
});

test('导入：JSON 卡片没有图片也能入库，坏文件单独跳过', async (t) => {
  const { db, dir } = await openTestDb(t);
  const ctx = { db, config: { imagesDir: path.join(dir, 'images'), dataDir: dir } };
  const json = Buffer.from(JSON.stringify(CARD), 'utf8').toString('base64');

  const result = await characters.importCards(ctx, {
    files: [
      { name: 'card.json', data: json },
      { name: 'broken.png', data: Buffer.from('nope').toString('base64') },
    ],
  });
  assert.equal(result.imported.length, 1);
  assert.equal(result.imported[0].imageFile, null);
  assert.equal(result.skipped.length, 1);
});


test('文件夹：RP 作用域的增删与角色卡归属', async (t) => {
  const { db, dir } = await openTestDb(t);
  const ctx = { db, config: { imagesDir: path.join(dir, 'images'), dataDir: dir } };

  const parent = await folders.create(db, { name: '奇幻', scope: 'rp' });
  const child = await folders.create(db, { name: '北境', parentId: parent.id, scope: 'rp' });
  assert.equal(parent.scope, 'rp');

  const card = await characters.create(ctx, { name: '塞拉', folderId: child.id });
  assert.equal(card.folderId, child.id);

  const list = characters.list(db, { folderId: child.id });
  assert.equal(list.total, 1);
  // 选中父文件夹时包含子文件夹里的卡
  assert.equal(characters.list(db, { folderId: parent.id }).total, 1);
  assert.equal(characters.list(db, { folderId: 'root' }).total, 0);

  const counts = folders.list(db, { scope: 'rp' }).items;
  assert.equal(counts.find((item) => item.id === parent.id).characterTotal, 1);
  assert.equal(counts.find((item) => item.id === child.id).characterCount, 1);

  await folders.remove(db, child.id);
  assert.equal(db.snapshot().characters[0].folderId, null);
});

test('缩略图：保存 WebP 到 thumbs/<hash>.webp', async (t) => {
  const { db, dir } = await openTestDb(t);
  const ctx = { db, config: { imagesDir: path.join(dir, 'images'), dataDir: dir } };
  const buffer = pngWithCard(CARD);
  const card = await characters.create(ctx, { name: '带图', image: buffer.toString('base64') });

  const webp = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('WEBP', 'ascii'),
    Buffer.from('fake', 'ascii'),
  ]);
  const saved = await characters.saveThumb(ctx, card.id, webp.toString('base64'));
  assert.equal(saved.ok, true);

  const file = characters.thumbPathOf(ctx.config, card);
  assert.ok((await fs.stat(file)).size > 0);
  assert.deepEqual(await fs.readFile(file), webp);

  await assert.rejects(() => characters.saveThumb(ctx, card.id, Buffer.from('not webp').toString('base64')), /WebP/);
});

test('移动：PATCH folderId 在文件夹之间切换', async (t) => {
  const { db, dir } = await openTestDb(t);
  const ctx = { db, config: { imagesDir: path.join(dir, 'images'), dataDir: dir } };
  const folder = await folders.create(db, { name: '都市', scope: 'rp' });
  const card = await characters.create(ctx, { name: '陈默' });
  assert.equal(card.folderId, null);

  const moved = await characters.update(ctx, card.id, { folderId: folder.id });
  assert.equal(moved.folderId, folder.id);
  assert.equal(characters.list(db, { folderId: folder.id }).total, 1);

  const back = await characters.update(ctx, card.id, { folderId: null });
  assert.equal(back.folderId, null);
  assert.equal(characters.list(db, { folderId: 'root' }).total, 1);
});

test('导入：同名角色卡默认跳过，allowDuplicateNames 可放行', async (t) => {
  const { db, dir } = await openTestDb(t);
  const ctx = { db, config: { imagesDir: path.join(dir, 'images'), dataDir: dir } };
  const data = Buffer.from(JSON.stringify({ name: '塞拉', description: '描述' }), 'utf8').toString('base64');

  const first = await characters.importCards(ctx, { files: [{ name: 'a.json', data }] });
  assert.equal(first.imported.length, 1);

  const second = await characters.importCards(ctx, { files: [{ name: 'b.json', data }] });
  assert.equal(second.imported.length, 0);
  assert.match(second.skipped[0].reason, /同名角色卡/);

  const third = await characters.importCards(ctx, { files: [{ name: 'b.json', data }], allowDuplicateNames: true });
  assert.equal(third.imported.length, 1);
  assert.equal(characters.list(db).total, 2);
});

test('批量删除：共享原图只在最后一张删除时清理', async (t) => {
  const { db, dir } = await openTestDb(t);
  const ctx = { db, config: { imagesDir: path.join(dir, 'images'), dataDir: dir } };
  const image = pngWithCard(CARD).toString('base64');

  const first = await characters.create(ctx, { name: 'A', image });
  const second = await characters.create(ctx, { name: 'B', image });
  const abs = characters.imagePathOf(ctx.config, first);
  assert.ok(await fs.stat(abs));

  await characters.batchDelete(ctx, { ids: [first.id] });
  assert.equal(characters.list(db).total, 1);
  assert.ok(await fs.stat(abs));

  await characters.batchDelete(ctx, { ids: [second.id] });
  assert.equal(characters.list(db).total, 0);
  await assert.rejects(() => fs.stat(abs));
});

test('批量移动：folderId 为 null 时移回未归档', async (t) => {
  const { db, dir } = await openTestDb(t);
  const ctx = { db, config: { imagesDir: path.join(dir, 'images'), dataDir: dir } };
  const folder = await folders.create(db, { name: '奇幻', scope: 'rp' });
  const a = await characters.create(ctx, { name: 'A' });
  const b = await characters.create(ctx, { name: 'B' });

  const moved = await characters.batchMove(ctx, { ids: [a.id, b.id], folderId: folder.id });
  assert.equal(moved.moved, 2);
  assert.equal(characters.list(db, { folderId: folder.id }).total, 2);

  await characters.batchMove(ctx, { ids: [a.id, b.id], folderId: null });
  assert.equal(characters.list(db, { folderId: 'root' }).total, 2);
});
