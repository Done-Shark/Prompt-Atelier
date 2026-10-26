/**
 * 缩略图缓存：只接受 WebP、落盘到 thumbsDir、删除时清理。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openTestDb, makeTmpDir, rmDir } from '../../testing/helpers.js';
import { dropThumb, saveThumb, thumbPathOf } from './service.js';

function webpBuffer(size = 64) {
  const buffer = Buffer.alloc(size);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(size - 8, 4);
  buffer.write('WEBP', 8, 'ascii');
  return buffer;
}

function imageRecord(hash) {
  return {
    id: 'i_thumb',
    target: 'nai',
    fileName: 'a.png',
    ext: 'png',
    width: 64,
    height: 64,
    bytes: 100,
    hash,
    folderId: null,
    albumIds: [],
    tags: [],
    favorite: false,
    metadata: { format: 'nai', positive: '', negative: '', model: null, sampler: null, scheduler: null, seed: null, steps: null, cfg: null, width: 64, height: 64, loras: [], raw: null },
    promptId: null,
    importedAt: '2026-01-01T00:00:00.000Z',
    sourcePath: null,
    file: `nai/${hash}.png`,
    order: 0,
  };
}

test('缩略图：保存 WebP、拒绝非法格式、可删除', async (t) => {
  const { db } = await openTestDb(t);
  const thumbsDir = await makeTmpDir('pa-thumbs-');
  t.after(() => rmDir(thumbsDir));
  const image = imageRecord('hash_thumb');
  await db.mutate((data) => data.images.push(image));
  const ctx = { db, config: { thumbsDir, imagesDir: thumbsDir, dataDir: thumbsDir } };

  const result = await saveThumb(ctx, image.id, webpBuffer().toString('base64'));
  assert.equal(result.ok, true);
  assert.ok(await fs.stat(thumbPathOf(ctx.config, image)));

  await assert.rejects(() => saveThumb(ctx, image.id, Buffer.from('not webp').toString('base64')), /WebP/);

  await dropThumb(ctx, image);
  await assert.rejects(() => fs.stat(thumbPathOf(ctx.config, image)));
});
