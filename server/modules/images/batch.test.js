/**
 * 图片批量操作与手动排序。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../../testing/helpers.js';
import * as folders from '../folders/service.js';
import { batch, list, reorder, update } from './service.js';

function image(overrides = {}) {
  return {
    id: 'i_a',
    target: 'nai',
    fileName: 'a.png',
    ext: 'png',
    width: 64,
    height: 64,
    bytes: 100,
    hash: 'h_a',
    folderId: null,
    tags: [],
    favorite: false,
    metadata: {
      format: 'nai',
      positive: '',
      negative: '',
      model: null,
      sampler: null,
      scheduler: null,
      seed: null,
      steps: null,
      cfg: null,
      width: 64,
      height: 64,
      loras: [],
      raw: null,
    },
    promptId: null,
    importedAt: '2026-01-01T00:00:00.000Z',
    sourcePath: null,
    file: 'nai/h_a.png',
    order: 0,
    ...overrides,
  };
}

function ctxOf(db) {
  return { db, config: { imagesDir: process.cwd() } };
}

test('批量移动：同目标入库，跨目标跳过并计入 skipped', async (t) => {
  const { db } = await openTestDb(t);
  const folder = await folders.create(db, { name: '场景', target: 'nai', scope: 'image' });
  await db.mutate((data) => {
    data.images.push(image({ id: 'i_a', hash: 'h_a', file: 'nai/h_a.png' }));
    data.images.push(image({ id: 'i_b', hash: 'h_b', file: 'nai/h_b.png', order: 1 }));
    data.images.push(
      image({ id: 'i_c', hash: 'h_c', file: 'comfyui/h_c.png', target: 'comfyui', order: 2 }),
    );
  });

  const result = await batch(ctxOf(db), {
    ids: ['i_a', 'i_b', 'i_c', 'missing'],
    action: 'move',
    folderId: folder.id,
  });
  assert.equal(result.updated, 2);
  assert.equal(result.skipped, 2);

  const snapshot = db.snapshot();
  assert.equal(snapshot.images.find((item) => item.id === 'i_a').folderId, folder.id);
  assert.equal(snapshot.images.find((item) => item.id === 'i_b').folderId, folder.id);
  assert.equal(snapshot.images.find((item) => item.id === 'i_c').folderId, null);
});

test('批量收藏：统一设置状态', async (t) => {
  const { db } = await openTestDb(t);
  await db.mutate((data) => {
    data.images.push(image({ id: 'i_a' }), image({ id: 'i_b', hash: 'h_b', file: 'nai/h_b.png' }));
  });

  await batch(ctxOf(db), { ids: ['i_a', 'i_b'], action: 'favorite', favorite: true });
  assert.ok(db.snapshot().images.every((item) => item.favorite === true));

  await batch(ctxOf(db), { ids: ['i_a'], action: 'favorite', favorite: false });
  assert.equal(db.snapshot().images.find((item) => item.id === 'i_a').favorite, false);
});

test('批量删除：移除索引并清掉 Prompt 的来源引用', async (t) => {
  const { db } = await openTestDb(t);
  await db.mutate((data) => {
    data.images.push(image({ id: 'i_a' }));
    data.prompts.push({
      id: 'p_1',
      title: '来源图',
      target: 'nai',
      positive: '1girl',
      negative: '',
      segments: [],
      tags: [],
      folderId: null,
      favorite: false,
      notes: '',
      params: {},
      usageCount: 0,
      lastUsedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      origin: 'image',
      imageId: 'i_a',
    });
  });

  const result = await batch(ctxOf(db), { ids: ['i_a'], action: 'delete' });
  assert.equal(result.deleted, 1);
  assert.equal(db.snapshot().images.length, 0);
  assert.equal(db.snapshot().prompts[0].imageId, null);
});

test('手动排序：把图片插到目标之前，顺序持久化', async (t) => {
  const { db } = await openTestDb(t);
  await db.mutate((data) => {
    data.images.push(
      image({ id: 'i_a', hash: 'h_a', file: 'nai/h_a.png', order: 0 }),
      image({ id: 'i_b', hash: 'h_b', file: 'nai/h_b.png', order: 1 }),
      image({ id: 'i_c', hash: 'h_c', file: 'nai/h_c.png', order: 2 }),
    );
  });

  await reorder(ctxOf(db), { target: 'nai', folderId: null, ids: ['i_c'], beforeId: 'i_a' });
  const ids = list(db, { target: 'nai', sort: 'manual' }).items.map((item) => item.id);
  assert.deepEqual(ids, ['i_c', 'i_a', 'i_b']);
});

test('移动到文件夹时追加到目标末尾', async (t) => {
  const { db } = await openTestDb(t);
  const folder = await folders.create(db, { name: '场景', target: 'nai', scope: 'image' });
  await db.mutate((data) => {
    data.images.push(
      image({ id: 'i_a', hash: 'h_a', file: 'nai/h_a.png', folderId: folder.id, order: 0 }),
      image({ id: 'i_b', hash: 'h_b', file: 'nai/h_b.png', order: 1 }),
    );
  });

  await update(ctxOf(db), 'i_b', { folderId: folder.id });
  const moved = db.snapshot().images.find((item) => item.id === 'i_b');
  assert.equal(moved.folderId, folder.id);
  assert.ok(moved.order > 0);
});
