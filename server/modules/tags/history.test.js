/**
 * Tag 操作日志：改名 / 查找替换 / 批量修改 / 删除别名的撤销。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../../testing/helpers.js';
import * as prompts from '../prompts/service.js';
import * as tags from './service.js';
import { findReplace, rename } from './tagOps.js';
import { listHistory, undoLast } from './history.js';

test('撤销改名：Prompt、Tag 库与别名一起还原', async (t) => {
  const { db } = await openTestDb(t);
  const prompt = await prompts.create(db, { target: 'nai', positive: 'long_hair, solo', tags: ['long_hair'] });

  await rename({ db }, { from: 'long_hair', to: 'longhair' });
  assert.equal(db.snapshot().prompts[0].positive, 'longhair, solo');
  assert.equal(db.snapshot().tagAliases.length, 1);

  const undone = await undoLast(db);
  assert.match(undone.label, /重命名 long_hair → longhair/);

  const snap = db.snapshot();
  assert.equal(snap.prompts.find((item) => item.id === prompt.id).positive, 'long_hair, solo');
  assert.deepEqual(snap.prompts.find((item) => item.id === prompt.id).tags, ['long_hair']);
  assert.ok(snap.tags.some((entry) => entry.tag === 'long_hair'));
  assert.ok(!snap.tags.some((entry) => entry.tag === 'longhair'));
  assert.equal(snap.tagAliases.length, 0);
  assert.equal(listHistory(db).length, 0);
});

test('撤销查找替换：多条 tag 一起还原', async (t) => {
  const { db } = await openTestDb(t);
  await db.mutate((data) => {
    for (const tag of ['artist:foo', 'artist:bar']) {
      data.tags.push({
        tag,
        category: 'artist',
        categorySource: 'guess',
        translation: '',
        translationSource: 'none',
        reviewed: false,
        postCount: null,
        updatedAt: null,
      });
    }
  });

  await findReplace({ db }, { pattern: '^artist:', replacement: '', regex: true });
  assert.deepEqual(db.snapshot().tags.map((entry) => entry.tag).sort(), ['bar', 'foo']);

  await undoLast(db);
  assert.deepEqual(db.snapshot().tags.map((entry) => entry.tag).sort(), ['artist:bar', 'artist:foo']);
  assert.equal(db.snapshot().tagAliases.length, 0);
});

test('撤销批量修改：译文与锁定状态还原', async (t) => {
  const { db } = await openTestDb(t);
  await prompts.create(db, { target: 'nai', positive: 'long_hair, solo' });

  await tags.batchUpdate({ db }, { tags: ['long_hair', 'solo'], patch: { translation: '批量译文' } });
  assert.equal(db.snapshot().tags.find((entry) => entry.tag === 'long_hair').translation, '批量译文');

  await undoLast(db);
  const snap = db.snapshot();
  assert.equal(snap.tags.find((entry) => entry.tag === 'long_hair').translation, '');
  assert.equal(snap.tags.find((entry) => entry.tag === 'long_hair').reviewed, false);
});

test('删除别名可以撤销', async (t) => {
  const { db } = await openTestDb(t);
  await prompts.create(db, { target: 'nai', positive: 'long_hair' });
  await rename({ db }, { from: 'long_hair', to: 'longhair' });
  assert.equal(db.snapshot().tagAliases.length, 1);

  await tags.deleteAlias({ db }, { alias: 'long_hair' });
  assert.equal(db.snapshot().tagAliases.length, 0);

  await undoLast(db);
  assert.equal(db.snapshot().tagAliases.length, 1);
  assert.equal(db.snapshot().tagAliases[0].canonical, 'longhair');
});

test('操作日志最多保留 20 条', async (t) => {
  const { db } = await openTestDb(t);
  const many = Array.from({ length: 25 }, (_, index) => `tag_${index}`).join(', ');
  await prompts.create(db, { target: 'nai', positive: many });

  for (let index = 0; index < 25; index += 1) {
    await tags.batchUpdate({ db }, { tags: [`tag_${index}`], patch: { reviewed: true } });
  }
  assert.equal(db.snapshot().tagHistory.length, 20);
  assert.equal(listHistory(db).length, 20);
});
