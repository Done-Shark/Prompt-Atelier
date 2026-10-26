/**
 * Tag 分类：自建、重命名、排序、删除回退、与 Tag 库联动。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../../testing/helpers.js';
import * as prompts from '../prompts/service.js';
import * as tags from '../tags/service.js';
import * as categories from './service.js';

test('默认分类：12 个内置分类，按 order 返回', async (t) => {
  const { db } = await openTestDb(t);
  const items = categories.list(db);
  assert.equal(items.length, 12);
  assert.equal(items[0].id, 'character');
  assert.equal(items.at(-1).id, 'unsorted');
  assert.ok(items.every((item) => item.builtin));
});

test('新建 / 重命名 / 排序 / 删除：与 Tag 库联动', async (t) => {
  const { db } = await openTestDb(t);
  const ctx = { db };
  await prompts.create(db, { target: 'nai', positive: 'long_hair, solo' });

  const custom = await categories.create(ctx, { label: '服装风格' });
  assert.equal(custom.builtin, false);
  assert.equal(categories.list(db).at(-1).id, custom.id);

  await categories.update(ctx, custom.id, { label: '穿搭风格' });
  assert.equal(categories.list(db).find((item) => item.id === custom.id).label, '穿搭风格');

  await tags.update(db, { tag: 'long_hair', category: custom.id });
  assert.equal(tags.list(db, { category: custom.id }).total, 1);

  await categories.reorder(ctx, { ids: [custom.id, 'unsorted'] });
  const ordered = categories.list(db);
  assert.equal(ordered[0].id, custom.id);
  assert.equal(ordered[1].id, 'unsorted');

  const removed = await categories.remove(ctx, custom.id);
  assert.equal(removed.moved, 1);
  assert.equal(db.snapshot().tags.find((entry) => entry.tag === 'long_hair').category, 'unsorted');

  await assert.rejects(() => categories.remove(ctx, 'character'), /内置分类不能删除/);
});

test('校验：重名与未知分类被拒绝', async (t) => {
  const { db } = await openTestDb(t);
  const ctx = { db };
  await assert.rejects(() => categories.create(ctx, { label: '人物' }), /同名/);
  await assert.rejects(() => categories.create(ctx, { label: '   ' }), /不能为空/);

  await prompts.create(db, { target: 'nai', positive: 'solo' });
  await assert.rejects(() => tags.update(db, { tag: 'solo', category: 'not_exists' }), /分类无效/);
});

test('迁移：保留自建分类与自定义顺序', async (t) => {
  const { db } = await openTestDb(t);
  const ctx = { db };
  const custom = await categories.create(ctx, { label: '项目专用' });
  await categories.reorder(ctx, { ids: [custom.id] });

  const reopened = categories.list(db);
  assert.equal(reopened[0].id, custom.id);
  assert.equal(reopened[0].builtin, false);
});
