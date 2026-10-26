/**
 * Tag 库：目录自动收录、人工修正、词典翻译、跳过已修正、导入导出。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../../testing/helpers.js';
import * as prompts from '../prompts/service.js';
import * as tags from './service.js';

const POSITIVE = 'masterpiece, 1girl, long hair, school uniform, smile, city lights, depth of field';

test('目录：创建 Prompt 后自动收录 tag，并统计使用次数', async (t) => {
  const { db } = await openTestDb(t);
  await prompts.create(db, { target: 'nai', positive: POSITIVE });

  const payload = tags.list(db, {});
  assert.ok(payload.total >= 7);
  const longHair = payload.items.find((item) => item.tag === 'long_hair');
  assert.equal(longHair.usage, 1);
  assert.equal(longHair.category, 'appearance');
  assert.equal(longHair.translation, '');
  assert.equal(payload.stats.pending, payload.stats.total);
});

test('人工修正：改翻译后标记 reviewed，自动翻译不再覆盖', async (t) => {
  const { db } = await openTestDb(t);
  await prompts.create(db, { target: 'nai', positive: POSITIVE });

  const updated = await tags.update(db, { tag: 'long_hair', translation: '长长的头发', category: 'appearance' });
  assert.equal(updated.translation, '长长的头发');
  assert.equal(updated.reviewed, true);
  assert.equal(updated.translationSource, 'manual');
  assert.equal(updated.categorySource, 'manual');

  const result = await tags.translate({ db }, { provider: 'dictionary' });
  assert.equal(result.provider, 'dictionary');

  const after = tags.list(db, { q: 'long_hair' }).items[0];
  assert.equal(after.translation, '长长的头发');
});

test('词典翻译：只补空，不覆盖已有翻译', async (t) => {
  const { db } = await openTestDb(t);
  await prompts.create(db, { target: 'nai', positive: POSITIVE });

  const first = await tags.translate({ db }, { provider: 'dictionary' });
  assert.ok(first.updated > 0);

  const hair = tags.list(db, { q: 'long_hair' }).items[0];
  assert.equal(hair.translation, '长发');
  assert.equal(hair.translationSource, 'dictionary');

  const second = await tags.translate({ db }, { provider: 'dictionary' });
  assert.equal(second.updated, 0);
  assert.match(second.message || '', /没有需要处理/);
});

test('lookup：批量返回分类、翻译与是否已收录', async (t) => {
  const { db } = await openTestDb(t);
  await prompts.create(db, { target: 'nai', positive: POSITIVE });
  await tags.translate({ db }, { provider: 'dictionary' });

  const { items } = tags.lookup(db, ['long_hair', 'city lights', 'not_in_catalog_xyz']);
  const hair = items.find((item) => item.tag === 'long_hair');
  const city = items.find((item) => item.tag === 'city_lights');
  const missing = items.find((item) => item.tag === 'not_in_catalog_xyz');
  assert.equal(hair.translation, '长发');
  assert.equal(city.category, 'scene');
  assert.equal(missing.known, false);
  assert.equal(missing.category, 'unsorted');
});

test('导入导出：保留人工修正标记', async (t) => {
  const { db } = await openTestDb(t);
  await prompts.create(db, { target: 'nai', positive: POSITIVE });
  await tags.update(db, { tag: 'smile', translation: '笑', category: 'expression' });

  const pack = tags.exportPack(db);
  assert.ok(pack.tags.some((entry) => entry.tag === 'smile' && entry.reviewed));

  const target = await openTestDb(t);
  const result = await tags.importPack(target.db, pack);
  assert.ok(result.imported > 0);
  const imported = tags.list(target.db, { q: 'smile' }).items[0];
  assert.equal(imported.translation, '笑');
  assert.equal(imported.reviewed, true);
});

test('syncCatalog：把新 Prompt 的 tag 补进目录且幂等', async (t) => {
  const { db } = await openTestDb(t);
  await prompts.create(db, { target: 'nai', positive: '1girl, long hair' });
  const before = db.snapshot().tags.length;

  const first = await tags.syncCatalog(db);
  const second = await tags.syncCatalog(db);
  assert.equal(first.added, 0);
  assert.equal(second.added, 0);
  assert.equal(db.snapshot().tags.length, before);
});

test('批量修改：一次事务改多条，改翻译/分类自动锁定', async (t) => {
  const { db } = await openTestDb(t);
  await prompts.create(db, { target: 'nai', positive: POSITIVE });

  const result = await tags.batchUpdate(
    { db },
    { tags: ['long_hair', 'city_lights', 'not_exists'], patch: { translation: '批量译文' } },
  );
  assert.deepEqual(result, { ok: true, updated: 2, skipped: 1 });

  const snap = db.snapshot();
  for (const key of ['long_hair', 'city_lights']) {
    const entry = snap.tags.find((item) => item.tag === key);
    assert.equal(entry.translation, '批量译文');
    assert.equal(entry.translationSource, 'manual');
    assert.equal(entry.reviewed, true);
  }

  // 取消锁定不改翻译
  await tags.batchUpdate({ db }, { tags: ['long_hair'], patch: { reviewed: false } });
  const after = db.snapshot().tags.find((item) => item.tag === 'long_hair');
  assert.equal(after.reviewed, false);
  assert.equal(after.translation, '批量译文');
});

test('来源筛选：按 translationSource 过滤', async (t) => {
  const { db } = await openTestDb(t);
  await prompts.create(db, { target: 'nai', positive: POSITIVE });
  await tags.update(db, { tag: 'long_hair', translation: '长发' });

  const manual = tags.list(db, { source: 'manual' });
  assert.equal(manual.total, 1);
  assert.equal(manual.items[0].tag, 'long_hair');

  const dictionary = tags.list(db, { source: 'dictionary' });
  assert.equal(dictionary.total, 0);

  const none = tags.list(db, { source: 'none' });
  assert.ok(none.total >= 1);
  assert.ok(none.items.every((item) => !item.translation));
});
