/**
 * 相簿：多对多集合、系统收藏相簿、批量加入/移出、删除清理。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../../testing/helpers.js';
import * as albums from './service.js';
import { list as listImages } from '../images/service.js';

function image(id, overrides = {}) {
  return {
    id,
    target: 'nai',
    fileName: `${id}.png`,
    ext: 'png',
    width: 64,
    height: 64,
    bytes: 100,
    hash: `h_${id}`,
    folderId: null,
    albumIds: [],
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
    file: `nai/h_${id}.png`,
    order: 0,
    ...overrides,
  };
}

test('创建相簿：同名冲突、列表带收藏系统相簿', async (t) => {
  const { db } = await openTestDb(t);
  const album = await albums.create(db, { name: '精选' });
  assert.equal(album.name, '精选');

  await assert.rejects(() => albums.create(db, { name: '精选' }), /同名/);

  const list = albums.list(db);
  assert.equal(list.items[0].id, 'favorites');
  assert.equal(list.items[0].system, true);
  assert.equal(list.items[1].name, '精选');
});

test('一张图可以同时属于多个相簿，收藏是独立维度', async (t) => {
  const { db } = await openTestDb(t);
  const a = await albums.create(db, { name: '精选' });
  const b = await albums.create(db, { name: '待参考' });
  await db.mutate((data) => {
    data.images.push(image('i_1'));
  });
  const ctx = { db };

  await albums.membership(ctx, a.id, { ids: ['i_1'], action: 'add' });
  await albums.membership(ctx, b.id, { ids: ['i_1'], action: 'add' });
  await albums.membership(ctx, 'favorites', { ids: ['i_1'], action: 'add' });

  const stored = db.snapshot().images[0];
  assert.deepEqual(stored.albumIds.sort(), [a.id, b.id].sort());
  assert.equal(stored.favorite, true);

  const counts = albums.list(db).items;
  assert.equal(counts.find((item) => item.id === a.id).count, 1);
  assert.equal(counts.find((item) => item.id === b.id).count, 1);
  assert.equal(counts.find((item) => item.id === 'favorites').count, 1);
});

test('移出相簿与删除相簿都会清理图片引用', async (t) => {
  const { db } = await openTestDb(t);
  const album = await albums.create(db, { name: '精选' });
  await db.mutate((data) => {
    data.images.push(image('i_1'), image('i_2'));
  });
  const ctx = { db };
  await albums.membership(ctx, album.id, { ids: ['i_1', 'i_2'], action: 'add' });

  await albums.membership(ctx, album.id, { ids: ['i_1'], action: 'remove' });
  assert.deepEqual(db.snapshot().images[0].albumIds, []);
  assert.deepEqual(db.snapshot().images[1].albumIds, [album.id]);

  const result = await albums.remove(db, album.id);
  assert.equal(result.removed, 1);
  assert.equal(db.snapshot().albums.length, 0);
  assert.deepEqual(db.snapshot().images[1].albumIds, []);
});

test('图片列表按相簿筛选，收藏走 favorite', async (t) => {
  const { db } = await openTestDb(t);
  const album = await albums.create(db, { name: '精选' });
  await db.mutate((data) => {
    data.images.push(image('i_1'), image('i_2', { favorite: true }));
  });
  await albums.membership({ db }, album.id, { ids: ['i_1'], action: 'add' });

  assert.equal(listImages(db, { albumId: album.id }).total, 1);
  assert.equal(listImages(db, { albumId: 'favorites' }).total, 1);
  assert.equal(listImages(db, { albumId: album.id }).items[0].id, 'i_1');
});

test('系统相簿不能改名或删除', async (t) => {
  const { db } = await openTestDb(t);
  await assert.rejects(() => albums.update(db, 'favorites', { name: 'x' }), /系统相簿/);
  await assert.rejects(() => albums.remove(db, 'favorites'), /系统相簿/);
});

test('相簿拖动排序：按 ids 顺序重排，未列出的按原顺序追加', async (t) => {
  const { db } = await openTestDb(t);
  const a = await albums.create(db, { name: 'A' });
  const b = await albums.create(db, { name: 'B' });
  const c = await albums.create(db, { name: 'C' });

  const names = () =>
    albums
      .list(db)
      .items.filter((album) => !album.system)
      .map((album) => album.name);

  await albums.reorder(db, { ids: [c.id, a.id, b.id] });
  assert.deepEqual(names(), ['C', 'A', 'B']);

  await albums.reorder(db, { ids: [b.id] });
  assert.deepEqual(names(), ['B', 'C', 'A']);

  // 收藏始终是第一个，且不受排序影响
  assert.equal(albums.list(db).items[0].id, albums.FAVORITES_ID);
});
