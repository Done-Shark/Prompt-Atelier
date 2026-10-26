/**
 * 图片文件夹：按目标格式隔离、同名可共存、删除后图片回到未归档。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../../testing/helpers.js';
import * as folders from './service.js';
import { list as listImages, update as updateImage } from '../images/service.js';

function fakeImage(overrides = {}) {
  return {
    id: 'i_test',
    target: 'nai',
    fileName: 'a.png',
    ext: 'png',
    width: 64,
    height: 64,
    bytes: 100,
    hash: 'hash_test',
    folderId: null,
    tags: [],
    favorite: false,
    metadata: { format: 'nai', positive: '', negative: '', model: null, sampler: null, scheduler: null, seed: null, steps: null, cfg: null, width: 64, height: 64, loras: [], raw: null },
    promptId: null,
    importedAt: '2026-01-01T00:00:00.000Z',
    sourcePath: null,
    file: 'nai/hash_test.png',
    ...overrides,
  };
}

test('图片文件夹：同一名称可在 NAI 与 ComfyUI 下共存', async (t) => {
  const { db } = await openTestDb(t);
  const nai = await folders.create(db, { name: '场景', target: 'nai', scope: 'image' });
  const comfy = await folders.create(db, { name: '场景', target: 'comfyui', scope: 'image' });

  assert.equal(nai.scope, 'image');
  assert.equal(nai.target, 'nai');
  assert.equal(comfy.target, 'comfyui');

  const naiList = folders.list(db, { scope: 'image', target: 'nai' });
  assert.equal(naiList.total, 1);
  assert.equal(naiList.items[0].id, nai.id);
});

test('图片文件夹：必须指定目标格式，且不能与 Prompt 文件夹重名冲突', async (t) => {
  const { db } = await openTestDb(t);
  await assert.rejects(() => folders.create(db, { name: '无目标', scope: 'image' }), /图片文件夹必须指定/);

  await folders.create(db, { name: '场景', target: 'nai', scope: 'prompt' });
  const imageFolder = await folders.create(db, { name: '场景', target: 'nai', scope: 'image' });
  assert.ok(imageFolder.id);

  // Prompt 文件夹列表不应包含图片文件夹
  assert.equal(folders.list(db, { scope: 'prompt' }).total, 1);
});

test('图片文件夹：子文件夹继承目标，跨目标父级被拒绝', async (t) => {
  const { db } = await openTestDb(t);
  const nai = await folders.create(db, { name: '场景', target: 'nai', scope: 'image' });
  const child = await folders.create(db, { name: '夜景', parentId: nai.id, target: 'nai', scope: 'image' });
  assert.equal(child.parentId, nai.id);

  await assert.rejects(
    () => folders.create(db, { name: '错位', parentId: nai.id, target: 'comfyui', scope: 'image' }),
    /目标格式不一致/,
  );
});

test('图片：只能归档到同目标的图片文件夹，列表按 folderId 过滤', async (t) => {
  const { db } = await openTestDb(t);
  const naiFolder = await folders.create(db, { name: '场景', target: 'nai', scope: 'image' });
  const comfyFolder = await folders.create(db, { name: '场景', target: 'comfyui', scope: 'image' });
  await db.mutate((data) => {
    data.images.push(fakeImage({ id: 'i_a', hash: 'h_a', file: 'nai/h_a.png', folderId: naiFolder.id }));
    data.images.push(fakeImage({ id: 'i_b', hash: 'h_b', file: 'nai/h_b.png', target: 'comfyui' }));
  });

  const ctx = { db, config: { imagesDir: '.' } };
  // 跨目标归档被拒绝，落到未归档
  const updated = await updateImage(ctx, 'i_b', { folderId: naiFolder.id });
  assert.equal(updated.folderId, null);
  const correct = await updateImage(ctx, 'i_b', { folderId: comfyFolder.id });
  assert.equal(correct.folderId, comfyFolder.id);

  assert.equal(listImages(db, { target: 'nai', folderId: naiFolder.id }).total, 1);
  assert.equal(listImages(db, { target: 'comfyui', folderId: 'root' }).total, 0);
  assert.equal(listImages(db, { target: 'comfyui', folderId: comfyFolder.id }).total, 1);

  await folders.remove(db, naiFolder.id);
  assert.equal(db.snapshot().images.find((image) => image.id === 'i_a').folderId, null);
});

test('文件夹计数：父级包含子文件夹的图片总数', async (t) => {
  const { db } = await openTestDb(t);
  const parent = await folders.create(db, { name: '作品', target: 'nai', scope: 'image' });
  const child = await folders.create(db, {
    name: '第一章',
    parentId: parent.id,
    target: 'nai',
    scope: 'image',
  });
  await db.mutate((data) => {
    data.images.push(
      fakeImage({ id: 'i_1', hash: 'h_1', file: 'nai/h_1.png', folderId: child.id }),
      fakeImage({ id: 'i_2', hash: 'h_2', file: 'nai/h_2.png', folderId: parent.id }),
    );
  });

  const list = folders.list(db, { scope: 'image', target: 'nai' }).items;
  const parentRow = list.find((folder) => folder.id === parent.id);
  const childRow = list.find((folder) => folder.id === child.id);
  assert.equal(parentRow.imageCount, 1);
  assert.equal(parentRow.imageTotal, 2);
  assert.equal(childRow.imageCount, 1);
  assert.equal(childRow.imageTotal, 1);
});

test('文件夹拖动：同级排序、拖进子级、再拖回根级', async (t) => {
  const { db } = await openTestDb(t);
  const a = await folders.create(db, { name: 'A', target: 'nai', scope: 'image' });
  const b = await folders.create(db, { name: 'B', target: 'nai', scope: 'image' });
  const c = await folders.create(db, { name: 'C', target: 'nai', scope: 'image' });

  const rootNames = () =>
    folders
      .list(db, { scope: 'image', target: 'nai' })
      .items.filter((folder) => folder.parentId === null)
      .map((folder) => folder.name);

  // C 拖到 A 之前
  await folders.move(db, c.id, { parentId: null, beforeId: a.id });
  assert.deepEqual(rootNames(), ['C', 'A', 'B']);

  // B 拖进 C，成为子级且顺序从 0 开始
  await folders.move(db, b.id, { parentId: c.id, beforeId: null });
  const moved = db.snapshot().folders.find((folder) => folder.id === b.id);
  assert.equal(moved.parentId, c.id);
  assert.equal(moved.order, 0);
  assert.deepEqual(rootNames(), ['C', 'A']);

  // 再拖回根级末尾
  await folders.move(db, b.id, { parentId: null, beforeId: null });
  assert.deepEqual(rootNames(), ['C', 'A', 'B']);
});

test('文件夹拖动：不能拖进自身或子级，改父级时同级重名被拒绝', async (t) => {
  const { db } = await openTestDb(t);
  const parent = await folders.create(db, { name: '父', target: 'nai', scope: 'image' });
  const child = await folders.create(db, {
    name: '子',
    parentId: parent.id,
    target: 'nai',
    scope: 'image',
  });

  await assert.rejects(() => folders.move(db, parent.id, { parentId: parent.id }), /自身或其子级/);
  await assert.rejects(() => folders.move(db, parent.id, { parentId: child.id }), /自身或其子级/);

  const other = await folders.create(db, { name: '目标', target: 'nai', scope: 'image' });
  await folders.create(db, { name: '子', parentId: other.id, target: 'nai', scope: 'image' });
  await assert.rejects(() => folders.move(db, child.id, { parentId: other.id }), /同名/);
});

test('文件夹拖动：跨目标父级被拒绝', async (t) => {
  const { db } = await openTestDb(t);
  const nai = await folders.create(db, { name: 'NAI 场景', target: 'nai', scope: 'image' });
  const comfy = await folders.create(db, { name: 'Comfy 场景', target: 'comfyui', scope: 'image' });
  await assert.rejects(() => folders.move(db, comfy.id, { parentId: nai.id }), /目标格式不一致/);
});

test('Prompt 文件夹计数：直属与含子级', async (t) => {
  const { db } = await openTestDb(t);
  const parent = await folders.create(db, { name: '角色', target: 'all', scope: 'prompt' });
  const child = await folders.create(db, {
    name: '产品摄影',
    parentId: parent.id,
    target: 'all',
    scope: 'prompt',
  });
  await db.mutate((data) => {
    data.prompts.push(
      { id: 'p_1', folderId: child.id },
      { id: 'p_2', folderId: parent.id },
      { id: 'p_3', folderId: null },
    );
  });

  const list = folders.list(db, { scope: 'prompt' }).items;
  const parentRow = list.find((folder) => folder.id === parent.id);
  const childRow = list.find((folder) => folder.id === child.id);
  assert.equal(parentRow.promptCount, 1);
  assert.equal(parentRow.promptTotal, 2);
  assert.equal(childRow.promptCount, 1);
  assert.equal(childRow.promptTotal, 1);
});
