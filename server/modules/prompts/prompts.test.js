/**
 * Prompt 服务：CRUD、筛选排序分页、copy、导入导出往返。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../../testing/helpers.js';
import * as prompts from './service.js';
import * as folders from '../folders/service.js';
import * as settings from '../settings/service.js';
import { ApiError } from '../../lib/errors.js';

function baseInput(overrides = {}) {
  return {
    target: 'nai',
    positive: '1girl, solo, {sunset}',
    negative: 'lowres',
    tags: ['场景', '黄昏'],
    ...overrides,
  };
}

test('创建：标题回退、参数规范化、默认字段', async (t) => {
  const { db } = await openTestDb(t);
  const prompt = await prompts.create(db, baseInput({ title: '  ' }));

  assert.equal(prompt.title, '1girl, solo, {sunset}');
  assert.equal(prompt.target, 'nai');
  assert.equal(prompt.usageCount, 0);
  assert.equal(prompt.lastUsedAt, null);
  assert.equal(prompt.favorite, false);
  assert.equal(prompt.origin, 'manual');
  assert.equal(prompt.params.steps, 28);
  assert.equal(prompt.params.width, 832);
  assert.deepEqual(prompt.tags, ['场景', '黄昏']);

  const untitled = await prompts.create(db, { target: 'nai', positive: '   ' });
  assert.equal(untitled.title, '未命名 Prompt');
});

test('创建：target 与 positive 必填校验', async (t) => {
  const { db } = await openTestDb(t);
  await assert.rejects(
    () => prompts.create(db, { target: 'midjourney', positive: 'x' }),
    (err) => err instanceof ApiError && err.code === 'VALIDATION',
  );
  await assert.rejects(
    () => prompts.create(db, { target: 'nai' }),
    (err) => err instanceof ApiError && err.code === 'VALIDATION',
  );
});

test('更新：局部字段、target 切换后重新规范化参数', async (t) => {
  const { db } = await openTestDb(t);
  const created = await prompts.create(db, baseInput());

  const renamed = await prompts.update(db, created.id, { title: '黄昏电车', favorite: true, notes: '备注' });
  assert.equal(renamed.title, '黄昏电车');
  assert.equal(renamed.favorite, true);
  assert.equal(renamed.notes, '备注');
  assert.equal(renamed.positive, created.positive);

  const switched = await prompts.update(db, created.id, {
    target: 'comfyui',
    params: { checkpoint: 'sd_xl_base_1.0.safetensors', steps: 40 },
  });
  assert.equal(switched.target, 'comfyui');
  assert.equal(switched.params.checkpoint, 'sd_xl_base_1.0.safetensors');
  assert.equal(switched.params.steps, 40);
  assert.equal(switched.params.cfg, 7);
  assert.deepEqual(switched.params.loras, []);
  assert.equal('scale' in switched.params, false);
});

test('更新/删除：不存在时 NOT_FOUND，删除幂等', async (t) => {
  const { db } = await openTestDb(t);
  await assert.rejects(
    () => prompts.update(db, 'p_missing', { title: 'x' }),
    (err) => err instanceof ApiError && err.code === 'NOT_FOUND',
  );
  const created = await prompts.create(db, baseInput());
  assert.deepEqual(await prompts.remove(db, created.id), { ok: true });
  assert.deepEqual(await prompts.remove(db, created.id), { ok: true });
  assert.throws(() => prompts.get(db, created.id), (err) => err.code === 'NOT_FOUND');
});

test('列表：关键字 / target / 文件夹 / 标签 / 收藏 / 分页', async (t) => {
  const { db } = await openTestDb(t);
  const folder = await folders.create(db, { name: '场景' });

  const a = await prompts.create(db, baseInput({ title: '黄昏电车', favorite: true, folderId: folder.id }));
  const b = await prompts.create(db, baseInput({ title: '雨夜霓虹', tags: ['赛博'], negative: 'watermark' }));
  await prompts.create(db, { target: 'comfyui', title: '街景', positive: 'city', tags: ['赛博'] });

  assert.equal(prompts.list(db, { q: '黄昏' }).total, 1);
  assert.equal(prompts.list(db, { q: 'WATERMARK' }).items[0].id, b.id);
  assert.equal(prompts.list(db, { q: '赛博' }).total, 2);
  assert.equal(prompts.list(db, { target: 'comfyui' }).total, 1);
  assert.equal(prompts.list(db, { folderId: folder.id }).items[0].id, a.id);
  assert.equal(prompts.list(db, { folderId: 'root' }).total, 2);
  assert.equal(prompts.list(db, { tag: '赛博' }).total, 2);
  assert.equal(prompts.list(db, { favorite: '1' }).total, 1);

  const page = prompts.list(db, { limit: 2, offset: 1 });
  assert.equal(page.items.length, 2);
  assert.equal(page.total, 3);
});

test('排序：title / usage / created', async (t) => {
  const { db } = await openTestDb(t);
  const alpha = await prompts.create(db, baseInput({ title: 'A 作品' }));
  const beta = await prompts.create(db, baseInput({ title: 'B 作品' }));
  await prompts.create(db, baseInput({ title: 'C 作品' }));

  const byTitle = prompts.list(db, { sort: 'title' }).items.map((item) => item.title);
  assert.deepEqual(byTitle, ['A 作品', 'B 作品', 'C 作品']);

  await prompts.markUsed(db, beta.id);
  await prompts.markUsed(db, beta.id);
  await prompts.markUsed(db, alpha.id);
  const byUsage = prompts.list(db, { sort: 'usage' }).items;
  assert.equal(byUsage[0].id, beta.id);
  assert.equal(byUsage[0].usageCount, 2);

  const byCreated = prompts.list(db, { sort: 'created' }).items;
  assert.equal(byCreated.length, 3);
  for (let i = 1; i < byCreated.length; i += 1) {
    assert.ok(byCreated[i - 1].createdAt >= byCreated[i].createdAt);
  }
});

test('复制与使用计数', async (t) => {
  const { db } = await openTestDb(t);
  const created = await prompts.create(db, baseInput({ title: '黄昏电车' }));
  await prompts.markUsed(db, created.id);
  const used = prompts.get(db, created.id);
  assert.equal(used.usageCount, 1);
  assert.ok(used.lastUsedAt);

  const dup = await prompts.duplicate(db, created.id);
  assert.notEqual(dup.id, created.id);
  assert.equal(dup.title, '黄昏电车 副本');
  assert.equal(dup.usageCount, 0);
  assert.equal(prompts.list(db, {}).total, 2);
});

test('copy：NAI / ComfyUI / copyWithParams=false', async (t) => {
  const { db, dir } = await openTestDb(t);
  const nai = await prompts.create(db, baseInput({ title: 'NAI' }));
  const copyNai = prompts.copy(db, nai.id, { format: 'nai' });
  assert.equal(copyNai.format, 'nai');
  assert.match(copyNai.text, /^1girl, solo, \{sunset\}\n\nNegative prompt: lowres\nSteps: 28/);

  const comfy = await prompts.create(db, {
    target: 'comfyui',
    title: 'Comfy',
    positive: 'city',
    negative: 'blurry',
    params: { loras: [{ name: 'style.safetensors', strength: 0.8, clipStrength: 0.7 }] },
  });
  const copyComfy = prompts.copy(db, comfy.id, { format: 'comfyui' });
  assert.equal(copyComfy.text, 'city\n<lora:style.safetensors:0.8>\n\nNegative: blurry');

  // 跨格式复制也能出文本
  const cross = prompts.copy(db, nai.id, { format: 'comfyui' });
  assert.equal(cross.format, 'comfyui');

  await settings.update(db, dir, { copyWithParams: false });
  const plain = prompts.copy(db, nai.id, { format: 'nai' });
  assert.equal(plain.text, '1girl, solo, {sunset}\n\nNegative prompt: lowres');
});

test('导出 / 导入往返，非法条目进 skipped', async (t) => {
  const { db } = await openTestDb(t);
  const first = await prompts.create(db, baseInput({ title: '导出 A' }));
  await prompts.create(db, { target: 'comfyui', title: '导出 B', positive: 'city' });

  const pack = prompts.exportPack(db, {});
  assert.equal(pack.version, 1);
  assert.equal(pack.app, 'prompt-atelier');
  assert.equal(pack.prompts.length, 2);
  assert.ok(pack.exportedAt);

  const onlyOne = prompts.exportPack(db, { ids: first.id });
  assert.equal(onlyOne.prompts.length, 1);

  const target = await openTestDb(t);
  const result = await prompts.importMany(target.db, {
    data: {
      ...pack,
      prompts: [...pack.prompts, { target: 'midjourney', positive: 'x' }, { target: 'nai' }],
    },
  });
  assert.equal(result.imported, 2);
  assert.equal(result.skipped.length, 2);
  assert.equal(result.skipped[0].index, 2);
  assert.match(result.skipped[0].reason, /target/);

  const list = prompts.list(target.db, { sort: 'title' });
  assert.deepEqual(list.items.map((item) => item.title), ['导出 A', '导出 B']);
});

test('导入：裸数组与单对象都支持，folderId 作为默认归档', async (t) => {
  const { db } = await openTestDb(t);
  const folder = await folders.create(db, { name: '导入区' });

  const single = await prompts.importMany(db, { data: { target: 'nai', positive: 'single', title: '单个' } });
  assert.equal(single.imported, 1);

  const array = await prompts.importMany(db, {
    data: [{ target: 'nai', positive: 'a' }, { target: 'comfyui', positive: 'b' }],
    folderId: folder.id,
  });
  assert.equal(array.imported, 2);
  const items = prompts.list(db, { folderId: folder.id }).items;
  assert.equal(items.length, 2);
  assert.ok(items.every((item) => item.folderId === folder.id));

  await assert.rejects(() => prompts.importMany(db, { data: 'nope' }), (err) => err.code === 'VALIDATION');
});
