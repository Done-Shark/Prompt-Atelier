/**
 * Tag 改名 / 合并 / 查找替换：positive 顺序与权重保留、别名归并、合并优先级、dryRun。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../../testing/helpers.js';
import * as prompts from '../prompts/service.js';
import * as tags from './service.js';
import { applyRename, findReplace, rename, splitTag, replaceTagInText } from './tagOps.js';

test('splitTag：保留括号、权重与空格', () => {
  assert.deepEqual(splitTag('((long_hair))'), {
    lead: '',
    prefix: '((',
    core: 'long_hair',
    weight: '',
    close: '))',
    tail: '',
  });
  assert.equal(splitTag('(long_hair:1.2)').core, 'long_hair');
  assert.equal(splitTag('(long_hair:1.2)').weight, ':1.2');
  assert.equal(splitTag(' {tag} ').lead, ' ');
  assert.equal(splitTag(' {tag} ').tail, ' ');
});

test('replaceTagInText：只替换完整 tag，保留分隔与权重', () => {
  const result = replaceTagInText('masterpiece, (long_hair:1.2), long_hair, long_hair_style', 'long_hair', 'very_long_hair');
  assert.equal(result.count, 2);
  assert.equal(result.text, 'masterpiece, (very_long_hair:1.2), very_long_hair, long_hair_style');
});

test('改名：positive / segments / tags 同步，顺序不变，dryRun 不落库', async (t) => {
  const { db } = await openTestDb(t);
  const prompt = await prompts.create(db, {
    target: 'nai',
    positive: 'masterpiece, long_hair, (long hair:1.2), city lights',
    tags: ['long_hair'],
  });

  const preview = await rename({ db }, { from: 'long_hair', to: 'very_long_hair', dryRun: true });
  assert.equal(preview.dryRun, true);
  assert.equal(preview.prompts, 1);
  assert.equal(preview.positive, 2);
  assert.equal(db.snapshot().prompts[0].positive, prompt.positive);

  const diff = await rename({ db }, { from: 'long_hair', to: 'very_long_hair' });
  assert.equal(diff.tagAction, 'renamed');

  const snap = db.snapshot();
  const next = snap.prompts.find((item) => item.id === prompt.id);
  assert.equal(next.positive, 'masterpiece, very_long_hair, (very_long_hair:1.2), city lights');
  assert.deepEqual(next.tags, ['very_long_hair']);
  const segmentTexts = next.segments.flatMap((segment) => segment.tags.map((tag) => tag.text));
  assert.ok(segmentTexts.includes('very_long_hair'));
  assert.ok(segmentTexts.some((text) => text.includes('very_long_hair:1.2')));
  assert.ok(snap.tags.some((entry) => entry.tag === 'very_long_hair'));
  assert.ok(!snap.tags.some((entry) => entry.tag === 'long_hair'));
  assert.deepEqual(snap.tagAliases, [
    { alias: 'long_hair', canonical: 'very_long_hair', createdAt: snap.tagAliases[0].createdAt },
  ]);

  // 旧写法再进来不会长出新条目；lookup 也会归并
  await prompts.create(db, { target: 'nai', positive: 'long_hair, solo' });
  assert.ok(!db.snapshot().tags.some((entry) => entry.tag === 'long_hair'));
  const looked = tags.lookup(db, ['long_hair']);
  assert.equal(looked.items[0].tag, 'very_long_hair');
});

test('合并：人工译文与人工分类优先，旧条目被移除', async (t) => {
  const { db } = await openTestDb(t);
  await db.mutate((data) => {
    data.tags.push(
      {
        tag: 'long_hair',
        category: 'appearance',
        categorySource: 'manual',
        translation: '长发（人工）',
        translationSource: 'manual',
        reviewed: true,
        postCount: 10,
        updatedAt: null,
      },
      {
        tag: 'very_long_hair',
        category: 'unsorted',
        categorySource: 'guess',
        translation: '超长发',
        translationSource: 'dictionary',
        reviewed: false,
        postCount: 30,
        updatedAt: null,
      },
    );
  });

  const diff = applyRename(db.snapshot(), 'long_hair', 'very_long_hair');
  assert.equal(diff.tagAction, 'merged');

  await db.mutate((data) => {
    applyRename(data, 'long_hair', 'very_long_hair');
  });
  const snap = db.snapshot();
  const merged = snap.tags.find((entry) => entry.tag === 'very_long_hair');
  assert.equal(merged.translation, '长发（人工）');
  assert.equal(merged.translationSource, 'manual');
  assert.equal(merged.category, 'appearance');
  assert.equal(merged.categorySource, 'manual');
  assert.equal(merged.reviewed, true);
  assert.equal(merged.postCount, 30);
  assert.ok(!snap.tags.some((entry) => entry.tag === 'long_hair'));
});

test('查找替换：正则预览与批量应用', async (t) => {
  const { db } = await openTestDb(t);
  await db.mutate((data) => {
    for (const tag of ['artist:foo', 'artist:bar', 'general:tag']) {
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

  const preview = await findReplace(
    { db },
    { pattern: '^artist:', replacement: '', regex: true, dryRun: true },
  );
  assert.equal(preview.total, 2);
  assert.deepEqual(preview.matches.map((item) => item.to).sort(), ['bar', 'foo']);

  const result = await findReplace({ db }, { pattern: '^artist:', replacement: '', regex: true });
  assert.equal(result.renamed, 2);

  const names = db.snapshot().tags.map((entry) => entry.tag).sort();
  assert.deepEqual(names, ['bar', 'foo', 'general:tag']);
  assert.equal(db.snapshot().tagAliases.length, 2);
});

test('改回去：目标是旧别名时撤销别名而不是报错', async (t) => {
  const { db } = await openTestDb(t);
  const prompt = await prompts.create(db, { target: 'nai', positive: 'long_hair, solo' });

  await rename({ db }, { from: 'long_hair', to: 'longhair' });
  assert.equal(db.snapshot().prompts[0].positive, 'longhair, solo');

  await rename({ db }, { from: 'longhair', to: 'long_hair' });
  const snap = db.snapshot();
  assert.equal(snap.prompts.find((item) => item.id === prompt.id).positive, 'long_hair, solo');
  assert.ok(snap.tags.some((entry) => entry.tag === 'long_hair'));
  assert.ok(!snap.tags.some((entry) => entry.tag === 'longhair'));
  assert.ok(!snap.tagAliases.some((entry) => entry.alias === 'long_hair' && entry.canonical === 'longhair'));
  assert.ok(snap.tagAliases.some((entry) => entry.alias === 'longhair' && entry.canonical === 'long_hair'));
});
