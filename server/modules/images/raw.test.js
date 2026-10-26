/**
 * 原始元数据拆表：metadata.raw → imageRaw；导入 / 删除 / 迁移。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { openTestDb } from '../../testing/helpers.js';
import { encodePng } from '../../media/pngEncode.js';
import { migrate } from '../../store/schema.js';
import * as images from './service.js';

function pngWithWorkflow(workflow) {
  return encodePng({
    width: 8,
    height: 8,
    textChunks: [{ key: 'workflow', value: JSON.stringify(workflow) }],
    pixel: () => [12, 24, 36],
  });
}

test('导入：raw 进 imageRaw，metadata 里不再保留', async (t) => {
  const { db, dir } = await openTestDb(t);
  const ctx = { db, config: { dataDir: dir, imagesDir: path.join(dir, 'images'), thumbsDir: path.join(dir, 'thumbs') } };

  const workflow = { nodes: { 1: { class_type: 'KSampler' } } };
  const result = await images.importImages(ctx, {
    files: [{ name: 'a.png', data: pngWithWorkflow(workflow).toString('base64') }],
  });
  assert.equal(result.imported.length, 1);

  const snap = db.snapshot();
  const image = snap.images[0];
  assert.equal(image.metadata.raw, undefined);
  assert.deepEqual(snap.imageRaw, [{ id: image.id, raw: workflow }]);

  await images.remove(ctx, image.id);
  assert.equal(db.snapshot().imageRaw.length, 0);
});

test('迁移：老数据 metadata.raw 自动搬到 imageRaw', () => {
  const migrated = migrate(
    {
      images: [
        { id: 'i1', metadata: { format: 'comfyui', raw: { nodes: {} } } },
        { id: 'i2', metadata: { format: 'nai' } },
      ],
    },
    '/tmp/pa',
  );
  assert.equal(migrated.images[0].metadata.raw, undefined);
  assert.deepEqual(migrated.imageRaw, [{ id: 'i1', raw: { nodes: {} } }]);
  assert.equal(migrated.images[1].metadata.raw, undefined);
});
