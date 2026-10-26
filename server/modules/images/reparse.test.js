/**
 * 重新解析：解析规则修复后，已入库的图片可以就地刷新元数据。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { openTestDb } from '../../testing/helpers.js';
import { encodePng } from '../../media/pngEncode.js';
import * as images from './service.js';

function graphWithLinkedPositive() {
  return {
    1: {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0],
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
        seed: 1,
        steps: 20,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
      },
    },
    2: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'm.safetensors' } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: ['10', 0], clip: ['2', 1] } },
    4: { class_type: 'CLIPTextEncode', inputs: { text: 'NEG TEXT', clip: ['2', 1] } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    10: { class_type: 'PrimitiveStringMultiline', inputs: { value: 'POS TEXT' } },
  };
}

test('导入时就能解析 text 为字符串链路的正向提示词', async (t) => {
  const { db, dir } = await openTestDb(t);
  const ctx = { db, config: { dataDir: dir, imagesDir: path.join(dir, 'images'), thumbsDir: path.join(dir, 'thumbs') } };
  const png = encodePng({
    width: 8,
    height: 8,
    textChunks: [{ key: 'prompt', value: JSON.stringify(graphWithLinkedPositive()) }],
    pixel: () => [10, 20, 30],
  });

  await images.importImages(ctx, { files: [{ name: 'a.png', data: png.toString('base64') }] });
  const image = db.snapshot().images[0];
  assert.equal(image.metadata.positive, 'POS TEXT');
  assert.equal(image.metadata.negative, 'NEG TEXT');
});

test('重新解析：把错误的元数据改回正确值，并刷新 imageRaw', async (t) => {
  const { db, dir } = await openTestDb(t);
  const ctx = { db, config: { dataDir: dir, imagesDir: path.join(dir, 'images'), thumbsDir: path.join(dir, 'thumbs') } };
  const graph = graphWithLinkedPositive();
  const png = encodePng({
    width: 8,
    height: 8,
    textChunks: [{ key: 'prompt', value: JSON.stringify(graph) }],
    pixel: () => [10, 20, 30],
  });

  await images.importImages(ctx, { files: [{ name: 'a.png', data: png.toString('base64') }] });
  const id = db.snapshot().images[0].id;

  await db.mutate((data) => {
    data.images[0].metadata.positive = 'NEG TEXT';
    data.images[0].metadata.negative = 'NEG TEXT';
    data.imageRaw = [];
  });

  const fixed = await images.reparse(ctx, id);
  assert.equal(fixed.metadata.positive, 'POS TEXT');
  assert.equal(fixed.metadata.negative, 'NEG TEXT');
  assert.deepEqual(db.snapshot().imageRaw, [{ id, raw: { prompt: graph } }]);
});
