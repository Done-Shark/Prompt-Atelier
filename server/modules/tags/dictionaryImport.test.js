/**
 * 外部词典导入：格式识别、分类映射、合并策略、ffdkj sqlite 读取。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { makeTmpDir, openTestDb, rmDir } from '../../testing/helpers.js';
import {
  entriesFromFfdkjRows,
  mergeDictionary,
  normalizeCategory,
  parseDictionaryJson,
  readFfdkjSqlite,
} from './dictionaryImport.js';

test('JSON：通用映射（字符串 / 数组 / 对象值）', () => {
  const parsed = parseDictionaryJson(
    JSON.stringify({
      long_hair: '长发',
      '1girl': ['一个女孩', 'character'],
      solo: { translation: '单人', category: 'composition' },
    }),
  );
  assert.equal(parsed.format, 'map');
  const map = new Map(parsed.entries.map((entry) => [entry.tag, entry]));
  assert.equal(map.get('long_hair').translation, '长发');
  assert.equal(map.get('1girl').category, 'character');
  assert.equal(map.get('solo').category, 'composition');
});

test('JSON：本项目导出包 / NAI Launcher / DSO 三种结构', () => {
  const pack = parseDictionaryJson(
    JSON.stringify({ version: 1, tags: [{ tag: 'city lights', translation: '城市灯光' }] }),
  );
  assert.equal(pack.format, 'pack');
  assert.equal(pack.entries[0].tag, 'city_lights');

  const launcher = parseDictionaryJson(
    JSON.stringify({ entries: [{ tag: '3d_render', zhCn: '3D渲染', category: 'style' }] }),
  );
  assert.equal(launcher.format, 'entries');
  assert.equal(launcher.entries[0].translation, '3D渲染');

  const dso = parseDictionaryJson(
    JSON.stringify({
      categories: ['Unsorted', 'ArtistEra', 'Body'],
      entries: { '39': ['39', 0], long_hair: ['长发', 2], artist_x: ['画师X', 1] },
    }),
  );
  assert.equal(dso.format, 'dso');
  const map = new Map(dso.entries.map((entry) => [entry.tag, entry]));
  assert.equal(map.get('39').category, null);
  assert.equal(map.get('long_hair').category, 'appearance');
  assert.equal(map.get('artist_x').category, 'artist');
});

test('分类归一化：Danbooru 编号与 DSO 名称', () => {
  assert.equal(normalizeCategory(1), 'artist');
  assert.equal(normalizeCategory(3), 'copyright');
  assert.equal(normalizeCategory(4), 'character');
  assert.equal(normalizeCategory(5), 'meta');
  assert.equal(normalizeCategory(0), null);
  assert.equal(normalizeCategory('StyleQuality'), 'style');
  assert.equal(normalizeCategory('unsorted'), null);
  assert.equal(normalizeCategory('乱七八糟'), null);
});

test('ffdkj 行：只保留有中文的行', () => {
  const entries = entriesFromFfdkjRows([
    { name: 'long_hair', category: 0, cn_name: '长发' },
    { name: 'hatsune_miku', category: 4, cn_name: '初音未来' },
    { name: 'no_translation', category: 0, cn_name: '   ' },
  ]);
  assert.equal(entries.length, 2);
  assert.equal(entries[1].category, 'character');
});

test('合并策略：只补空、跳过已修正、--all 才新增', async (t) => {
  const { db } = await openTestDb(t);
  await db.mutate((data) => {
    data.tags.push(
      {
        tag: 'long_hair',
        category: 'appearance',
        categorySource: 'guess',
        translation: '',
        translationSource: 'none',
        reviewed: false,
        postCount: null,
        updatedAt: null,
      },
      {
        tag: '1girl',
        category: 'character',
        categorySource: 'manual',
        translation: '我改过的',
        translationSource: 'manual',
        reviewed: true,
        postCount: null,
        updatedAt: null,
      },
    );
  });

  const entries = [
    { tag: 'long_hair', translation: '长发', category: 'appearance' },
    { tag: '1girl', translation: '一个女孩', category: 'character' },
    { tag: 'not_in_library', translation: '未收录', category: 'scene' },
  ];

  const result = await mergeDictionary(db, entries);
  assert.equal(result.updated, 1);
  assert.equal(result.added, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.missing, 1);

  let snap = db.snapshot();
  assert.equal(snap.tags.find((entry) => entry.tag === 'long_hair').translation, '长发');
  assert.equal(snap.tags.find((entry) => entry.tag === 'long_hair').translationSource, 'dictionary');
  assert.equal(snap.tags.find((entry) => entry.tag === '1girl').translation, '我改过的');

  // --all 才会把词典里的新 tag 写进库
  const withAll = await mergeDictionary(db, entries, { all: true });
  assert.equal(withAll.added, 1);
  snap = db.snapshot();
  const added = snap.tags.find((entry) => entry.tag === 'not_in_library');
  assert.equal(added.translation, '未收录');
  assert.equal(added.category, 'scene');
});

test('ffdkj sqlite：只读读取 name / category / cn_name', async (t) => {
  const dir = await makeTmpDir('pa-dict-');
  t.after(() => rmDir(dir));
  const file = path.join(dir, 'tag.sqlite');
  const source = new DatabaseSync(file);
  source.exec('CREATE TABLE tags (name TEXT PRIMARY KEY, category INTEGER, cn_name TEXT, post_count INTEGER)');
  const insert = source.prepare('INSERT INTO tags (name, category, cn_name, post_count) VALUES (?, ?, ?, ?)');
  insert.run('long_hair', 0, '长发', 100);
  insert.run('hatsune_miku', 4, '初音未来', 50);
  insert.run('no_zh', 0, '', 10);
  source.close();

  const entries = await readFfdkjSqlite(file);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].tag, 'long_hair');
  assert.equal(entries[1].category, 'character');
  // 源文件保持可读、未被改写
  const stat = await fs.stat(file);
  assert.ok(stat.size > 0);
});
