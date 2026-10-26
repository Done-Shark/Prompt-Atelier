/**
 * 整库备份 / 恢复：Prompt、RP 角色卡、原图、API Key 处理。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTmpDir, openTestDb, rmDir } from '../../testing/helpers.js';
import * as prompts from '../prompts/service.js';
import * as characters from '../characters/service.js';
import * as tagCategories from '../tagCategories/service.js';
import * as backup from './service.js';

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

test('备份 → 删除 → 恢复：Prompt / 角色卡 / 原图都回来，API Key 不落盘', async (t) => {
  const { db, dir } = await openTestDb(t);
  const config = {
    dataDir: dir,
    imagesDir: path.join(dir, 'images'),
    thumbsDir: path.join(dir, 'thumbs'),
  };
  const ctx = { db, config };

  await prompts.create(db, { target: 'nai', positive: '1girl, solo' });
  const card = await characters.create(ctx, {
    name: '塞拉',
    image: pngWithCard({ spec: 'chara_card_v2', data: { name: '塞拉' } }).toString('base64'),
  });
  await db.mutate((data) => {
    data.settings.translation.apiKey = 'secret-key';
  });
  const customCategory = await tagCategories.create(ctx, { label: '自定义分类' });

  const target = await makeTmpDir('pa-backup-');
  t.after(() => rmDir(target));

  const exported = await backup.exportBackup(ctx, { targetDir: target });
  const raw = JSON.parse(await fs.readFile(path.join(exported.path, 'data.json'), 'utf8'));
  assert.equal(raw.characters.length, 1);
  assert.ok(raw.tagCategories.some((item) => item.id === customCategory.id));
  assert.equal(raw.settings.translation.apiKey, '');
  assert.equal(raw.settings.dataDir, undefined);
  assert.equal(exported.manifest.counts.characters, 1);
  assert.ok(await fs.stat(path.join(exported.path, 'images', 'rp', `${card.imageHash}.png`)));

  // 破坏当前数据：删角色卡与 Prompt
  await characters.remove(ctx, card.id);
  await prompts.remove(db, db.snapshot().prompts[0].id);
  assert.equal(db.snapshot().prompts.length, 0);
  assert.equal(db.snapshot().characters.length, 0);

  const restored = await backup.restoreBackup(ctx, { sourceDir: exported.path });
  assert.equal(restored.ok, true);
  assert.equal(db.snapshot().prompts.length, 1);
  assert.equal(db.snapshot().characters.length, 1);
  assert.ok(db.snapshot().tagCategories.some((item) => item.id === customCategory.id));
  // 备份里没有 Key，恢复后沿用当前机器的
  assert.equal(db.snapshot().settings.translation.apiKey, 'secret-key');
  assert.ok(await fs.stat(path.join(config.imagesDir, 'rp', `${card.imageHash}.png`)));

  // 恢复前会自动存一份当前数据
  const safety = await fs.readdir(path.join(dir, 'backups'));
  assert.ok(safety.some((name) => name.startsWith('pre-restore-')));
});

test('inspect：识别无效目录与有效备份', async (t) => {
  const { db, dir } = await openTestDb(t);
  const ctx = { db, config: { dataDir: dir, imagesDir: path.join(dir, 'images'), thumbsDir: path.join(dir, 'thumbs') } };
  const target = await makeTmpDir('pa-backup-');
  t.after(() => rmDir(target));

  await assert.rejects(() => backup.inspectBackup(ctx, { sourceDir: target }), /manifest/);

  const exported = await backup.exportBackup(ctx, { targetDir: target });
  const info = await backup.inspectBackup(ctx, { sourceDir: exported.path });
  assert.equal(info.manifest.app, 'prompt-atelier');
  assert.equal(info.manifest.format, 1);
  assert.ok(info.dataBytes > 0);
});

test('导出：拒绝把备份写进数据目录', async (t) => {
  const { db, dir } = await openTestDb(t);
  const ctx = { db, config: { dataDir: dir, imagesDir: path.join(dir, 'images'), thumbsDir: path.join(dir, 'thumbs') } };
  await assert.rejects(() => backup.exportBackup(ctx, { targetDir: dir }), /数据目录/);
});
