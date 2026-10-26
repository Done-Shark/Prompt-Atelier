/**
 * 图片库：走真实 HTTP 路由，验证扫描、分区归类、去重、文件流、to-prompt。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { api, makeTmpDir, rmDir, startTestServer } from '../../testing/helpers.js';
import { encodePng } from '../../media/pngEncode.js';

const NAI_COMMENT = JSON.stringify({
  prompt: '1girl, solo, {sunset}',
  uc: 'lowres, bad anatomy',
  steps: 28,
  scale: 5,
  seed: 123456,
  sampler: 'k_euler_ancestral',
  width: 512,
  height: 768,
  model: 'nai-diffusion-4-5-full',
  v4_prompt: { caption: { base_caption: '1girl, solo, {sunset}', char_captions: [] } },
  v4_negative_prompt: { caption: { base_caption: 'lowres, bad anatomy', char_captions: [] } },
});

const COMFY_GRAPH = JSON.stringify({
  3: {
    class_type: 'KSampler',
    inputs: {
      seed: 987654,
      steps: 24,
      cfg: 7.5,
      sampler_name: 'dpmpp_2m',
      scheduler: 'karras',
      denoise: 1,
      model: ['10', 0],
      positive: ['6', 0],
      negative: ['7', 0],
      latent_image: ['5', 0],
    },
  },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 64, height: 64, batch_size: 1 } },
  6: { class_type: 'CLIPTextEncode', inputs: { text: 'city at night, neon', clip: ['4', 1] } },
  7: { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, lowres', clip: ['4', 1] } },
  10: {
    class_type: 'LoraLoader',
    inputs: { lora_name: 'style.safetensors', strength_model: 0.8, strength_clip: 0.7, model: ['4', 0], clip: ['4', 1] },
  },
  4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'illustrious_v1.safetensors' } },
});

function naiPng() {
  return encodePng({
    width: 32,
    height: 48,
    textChunks: [{ key: 'Comment', value: NAI_COMMENT }],
    pixel: () => [200, 120, 80],
  });
}

function comfyPng() {
  return encodePng({
    width: 64,
    height: 64,
    textChunks: [{ key: 'prompt', value: COMFY_GRAPH }],
    pixel: () => [40, 60, 120],
  });
}

test('扫描 → 导入 → 分区归类 → 去重 → 文件流 → to-prompt', async (t) => {
  const { base, dataDir } = await startTestServer(t);
  const srcDir = await makeTmpDir('pa-src-');
  t.after(() => rmDir(srcDir));

  await fs.writeFile(path.join(srcDir, 'nai_one.png'), naiPng());
  await fs.writeFile(path.join(srcDir, 'comfy_one.png'), comfyPng());
  await fs.writeFile(path.join(srcDir, 'notes.txt'), 'not an image');

  /* 扫描预览 */
  const scan = await api(base, '/api/images/scan', { method: 'POST', body: { path: srcDir } });
  assert.equal(scan.status, 200);
  assert.equal(scan.body.total, 2);
  assert.deepEqual(scan.body.entries.map((entry) => entry.target).sort(), ['comfyui', 'nai']);
  assert.ok(scan.body.entries.every((entry) => entry.alreadyImported === false));

  /* 导入 */
  const imported = await api(base, '/api/images/import', {
    method: 'POST',
    body: { path: srcDir, target: 'auto', recursive: false },
  });
  assert.equal(imported.status, 200);
  assert.equal(imported.body.imported.length, 2);
  assert.equal(imported.body.scanned, 3);
  assert.equal(imported.body.skipped.length, 1);
  assert.equal(imported.body.skipped[0].reason, '不支持的文件类型');

  const naiImage = imported.body.imported.find((image) => image.target === 'nai');
  const comfyImage = imported.body.imported.find((image) => image.target === 'comfyui');
  assert.ok(naiImage && comfyImage);

  assert.equal(naiImage.metadata.format, 'nai');
  assert.equal(naiImage.metadata.seed, 123456);
  assert.equal(naiImage.metadata.steps, 28);
  assert.equal(naiImage.metadata.positive, '1girl, solo, {sunset}');
  assert.equal(naiImage.width, 32);
  assert.equal(naiImage.height, 48);
  assert.equal(naiImage.promptId, null);
  assert.equal(naiImage.file, undefined, '内部路径不应出现在响应里');

  assert.equal(comfyImage.metadata.format, 'comfyui');
  assert.equal(comfyImage.metadata.model, 'illustrious_v1.safetensors');
  assert.equal(comfyImage.metadata.positive, 'city at night, neon');
  assert.equal(comfyImage.metadata.seed, 987654);
  assert.equal(comfyImage.metadata.loras.length, 1);

  /* 库内副本落在对应分区 */
  const naiDir = path.join(dataDir, 'images', 'nai');
  const comfyDir = path.join(dataDir, 'images', 'comfyui');
  assert.equal((await fs.readdir(naiDir)).length, 1);
  assert.equal((await fs.readdir(comfyDir)).length, 1);
  // 镜像布局：未归档的图片用原文件名放在分区根目录
  assert.equal((await fs.readdir(naiDir))[0], 'nai_one.png');

  /* 分区列表 */
  const naiList = await api(base, '/api/images?target=nai');
  assert.equal(naiList.body.total, 1);
  assert.equal(naiList.body.items[0].id, naiImage.id);
  const allList = await api(base, '/api/images?q=neon');
  assert.equal(allList.body.total, 1);

  /* 文件流 */
  const fileRes = await fetch(`${base}/api/images/${naiImage.id}/file`);
  assert.equal(fileRes.status, 200);
  assert.equal(fileRes.headers.get('content-type'), 'image/png');
  assert.match(fileRes.headers.get('cache-control'), /immutable/);
  const bytes = Buffer.from(await fileRes.arrayBuffer());
  assert.equal(bytes.length, naiImage.bytes);

  /* 重复导入被 sha256 去重 */
  const again = await api(base, '/api/images/import', {
    method: 'POST',
    body: { path: srcDir, target: 'auto', recursive: false },
  });
  assert.equal(again.body.imported.length, 0);
  assert.equal(again.body.skipped.filter((item) => item.reason === '已存在').length, 2);

  /* to-prompt 回填 imageId / promptId */
  const created = await api(base, `/api/images/${naiImage.id}/to-prompt`, {
    method: 'POST',
    body: { tags: ['来自图片'] },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.origin, 'image');
  assert.equal(created.body.imageId, naiImage.id);
  assert.equal(created.body.target, 'nai');
  assert.equal(created.body.params.steps, 28);
  assert.equal(created.body.params.seed, 123456);
  assert.deepEqual(created.body.tags, ['来自图片']);

  const linked = await api(base, `/api/images/${naiImage.id}`);
  assert.equal(linked.body.promptId, created.body.id);

  /* PATCH 收藏与标签 */
  const patched = await api(base, `/api/images/${comfyImage.id}`, {
    method: 'PATCH',
    body: { favorite: true, tags: ['赛博'] },
  });
  assert.equal(patched.body.favorite, true);
  assert.deepEqual(patched.body.tags, ['赛博']);
  assert.equal((await api(base, '/api/images?favorite=1')).body.total, 1);

  /* 删除只影响索引与副本 */
  const removed = await api(base, `/api/images/${naiImage.id}`, { method: 'DELETE' });
  assert.deepEqual(removed.body, { ok: true });
  assert.equal((await fetch(`${base}/api/images/${naiImage.id}/file`)).status, 404);
  assert.equal((await fs.readdir(naiDir)).length, 0);
  // 源目录不受影响
  assert.equal((await fs.readdir(srcDir)).length, 3);
});

test('上传导入：base64 + fallbackTarget，未识别元数据标 unknown', async (t) => {
  const { base } = await startTestServer(t);
  const plainPng = encodePng({ width: 16, height: 16, pixel: () => [10, 10, 10] });

  const result = await api(base, '/api/images/import', {
    method: 'POST',
    body: {
      target: 'auto',
      fallbackTarget: 'comfyui',
      files: [
        { name: 'plain.png', data: plainPng.toString('base64') },
        { name: 'broken.png', data: '!!!not-base64!!!' },
      ],
    },
  });
  assert.equal(result.body.imported.length, 1);
  const image = result.body.imported[0];
  assert.equal(image.target, 'comfyui');
  assert.equal(image.metadata.format, 'unknown');
  assert.equal(image.metadata.positive, '');
  assert.equal(image.width, 16);
  assert.equal(result.body.scanned, 2);

  const toPrompt = await api(base, `/api/images/${image.id}/to-prompt`, { method: 'POST', body: {} });
  assert.equal(toPrompt.status, 201);
  assert.equal(toPrompt.body.positive, '');
  assert.equal(toPrompt.body.target, 'comfyui');
});

test('路径安全：不存在的目录返回 PATH_INVALID，未知图片 404', async (t) => {
  const { base } = await startTestServer(t);

  const bad = await api(base, '/api/images/scan', {
    method: 'POST',
    body: { path: path.join(await makeTmpDir('pa-missing-'), 'nope') },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'PATH_INVALID');

  const missing = await api(base, '/api/images/i_missing');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'NOT_FOUND');
});
