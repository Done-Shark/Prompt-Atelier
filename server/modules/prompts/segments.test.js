/**
 * Prompt 分块（segments）：自动分块、分块优先、PATCH 双向同步、copy、导入导出。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSegments, serializeSegments } from '../../../shared/prompt/doc.js';
import { openTestDb } from '../../testing/helpers.js';
import * as prompts from './service.js';

const POSITIVE = '1girl, solo, looking at viewer, sunset, depth of field, masterpiece';

function segmentedInput(overrides = {}) {
  return {
    target: 'nai',
    positive: 'ignored by segments',
    segments: [
      {
        id: 'seg_artist',
        kind: 'artist',
        label: '画师',
        tags: [
          { id: 'tag_a', text: 'artist:ciloranko', enabled: true },
          { id: 'tag_b', text: 'by wlop', enabled: false },
        ],
      },
      {
        id: 'seg_subject',
        kind: 'subject',
        tags: [{ id: 'tag_c', text: '1girl', enabled: true }],
      },
    ],
    ...overrides,
  };
}

test('创建：只传 positive 时自动分块，序列化可还原', async (t) => {
  const { db } = await openTestDb(t);
  const prompt = await prompts.create(db, { target: 'nai', positive: POSITIVE });

  assert.equal(prompt.positive, POSITIVE);
  assert.ok(prompt.segments.length > 1);
  assert.deepEqual(
    prompt.segments.map((segment) => segment.kind),
    ['subject', 'pose', 'scene', 'composition', 'style'],
  );
  assert.equal(serializeSegments(prompt.segments), prompt.positive);
  assert.deepEqual(
    prompt.segments.map((segment) => segment.tags.map((tag) => tag.text)),
    buildSegments(POSITIVE).map((segment) => segment.tags.map((tag) => tag.text)),
  );
});

test('创建：传 segments 时以分块为准，停用 tag 不进 positive', async (t) => {
  const { db } = await openTestDb(t);
  const prompt = await prompts.create(db, segmentedInput({ title: '画师风格' }));

  assert.equal(prompt.positive, 'artist:ciloranko, 1girl');
  assert.equal(prompt.segments.length, 2);
  assert.equal(prompt.segments[0].tags.length, 2);
  assert.equal(prompt.segments[0].tags[1].enabled, false);
  assert.equal(prompt.segments[1].label, '人物 / 版权');
});

test('创建：全部 tag 停用且原文为空时 positive 为空', async (t) => {
  const { db } = await openTestDb(t);
  const prompt = await prompts.create(db, {
    target: 'nai',
    positive: '',
    segments: [
      {
        kind: 'scene',
        tags: [{ text: 'sunset', enabled: false }],
      },
    ],
  });

  assert.equal(prompt.positive, '');
  assert.equal(prompt.segments.length, 1);
  assert.equal(prompt.title, '未命名 Prompt');
});

test('创建：全部 tag 停用但原文非空时保留原文，不静默清空', async (t) => {
  const { db } = await openTestDb(t);
  const prompt = await prompts.create(db, {
    target: 'nai',
    positive: 'keep me',
    segments: [{ kind: 'scene', tags: [{ text: 'sunset', enabled: false }] }],
  });

  assert.equal(prompt.positive, 'keep me');
  assert.equal(prompt.segments.length, 1);
});

test('创建：segments 为空数组时保留 positive，不自动分块', async (t) => {
  const { db } = await openTestDb(t);
  const prompt = await prompts.create(db, {
    target: 'nai',
    positive: '1girl, sunset',
    segments: [],
  });

  assert.equal(prompt.positive, '1girl, sunset');
  assert.deepEqual(prompt.segments, []);
});

test('PATCH：segments 为空数组时不清空 positive（旧数据安全）', async (t) => {
  const { db } = await openTestDb(t);
  const created = await prompts.create(db, { target: 'nai', positive: '1girl, sunset' });

  const patched = await prompts.update(db, created.id, { segments: [] });
  assert.equal(patched.positive, '1girl, sunset');
  assert.deepEqual(patched.segments, []);
});

test('copy：只传 positive 创建时不重排原文（P0 回归）', async (t) => {
  const { db } = await openTestDb(t);
  // 交错顺序：自动分块会按语义重排，但复制必须保持原文
  const positive = 'masterpiece, 1girl, sunset, smile, 1boy';
  const created = await prompts.create(db, { target: 'nai', positive });

  assert.equal(created.positive, positive);
  const { text } = prompts.copy(db, created.id, { format: 'nai' });
  assert.ok(text.startsWith(`${positive}\n`), `copy 应保持原文顺序，实际：${text.split('\n')[0]}`);
});

test('PATCH：只传 positive 时重建 segments', async (t) => {
  const { db } = await openTestDb(t);
  const created = await prompts.create(db, segmentedInput());

  const patched = await prompts.update(db, created.id, { positive: 'night, city' });
  assert.equal(patched.positive, 'night, city');
  assert.equal(patched.segments.length, 1);
  assert.equal(patched.segments[0].kind, 'scene');
  assert.equal(serializeSegments(patched.segments), patched.positive);
});

test('PATCH：只传 segments 时重算 positive', async (t) => {
  const { db } = await openTestDb(t);
  const created = await prompts.create(db, { target: 'nai', positive: POSITIVE });

  const patched = await prompts.update(db, created.id, {
    segments: [
      { kind: 'scene', tags: [{ text: 'sunset' }, { text: 'rain', enabled: false }] },
      { kind: 'subject', tags: [{ text: '1girl' }] },
    ],
  });
  assert.equal(patched.positive, 'sunset, 1girl');
  assert.equal(patched.segments.length, 2);
});

test('PATCH：同时传 positive 与 segments 时以 segments 为准', async (t) => {
  const { db } = await openTestDb(t);
  const created = await prompts.create(db, { target: 'nai', positive: 'city' });

  const patched = await prompts.update(db, created.id, {
    positive: 'from positive',
    segments: [{ kind: 'scene', tags: [{ text: 'forest' }] }],
  });
  assert.equal(patched.positive, 'forest');
});

test('PATCH：换 target 时 segments 不变', async (t) => {
  const { db } = await openTestDb(t);
  const created = await prompts.create(db, segmentedInput());

  const switched = await prompts.update(db, created.id, { target: 'comfyui' });
  assert.equal(switched.target, 'comfyui');
  assert.deepEqual(switched.segments, created.segments);
});

test('copy：停用的 tag 不进入复制结果', async (t) => {
  const { db } = await openTestDb(t);
  const created = await prompts.create(db, segmentedInput());

  const { text } = prompts.copy(db, created.id, { format: 'nai' });
  assert.match(text, /^artist:ciloranko, 1girl\n/);
  assert.equal(text.includes('by wlop'), false);
});

test('导出 → 导入：segments 数量与顺序一致', async (t) => {
  const { db } = await openTestDb(t);
  const created = await prompts.create(db, segmentedInput({ title: '往返' }));
  const pack = prompts.exportPack(db, { ids: created.id });
  assert.ok(Array.isArray(pack.prompts[0].segments));

  const target = await openTestDb(t);
  const result = await prompts.importMany(target.db, { data: pack });
  assert.equal(result.imported, 1);

  const imported = prompts.list(target.db, {}).items[0];
  assert.equal(imported.positive, created.positive);
  assert.deepEqual(
    imported.segments.map((segment) => [segment.kind, segment.tags.map((tag) => tag.text)]),
    created.segments.map((segment) => [segment.kind, segment.tags.map((tag) => tag.text)]),
  );
});

test('旧数据：没有 segments 字段时 list/get/copy 正常，PATCH 补分块', async (t) => {
  const { db } = await openTestDb(t);
  await db.mutate((data) => {
    data.prompts.push({
      id: 'p_legacy',
      title: '旧数据',
      target: 'nai',
      positive: '1girl, sunset',
      negative: '',
      tags: [],
      folderId: null,
      favorite: false,
      notes: '',
      params: {},
      usageCount: 0,
      lastUsedAt: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      origin: 'manual',
      imageId: null,
    });
  });

  const listed = prompts.list(db, {});
  assert.equal(listed.total, 1);
  assert.equal('segments' in listed.items[0], false);

  const legacy = prompts.get(db, 'p_legacy');
  assert.equal(legacy.positive, '1girl, sunset');
  assert.match(prompts.copy(db, 'p_legacy', { format: 'nai' }).text, /^1girl, sunset\n/);

  const patched = await prompts.update(db, 'p_legacy', { favorite: true });
  assert.equal(patched.positive, '1girl, sunset');
  assert.equal(patched.segments.length, 2);
  assert.equal(serializeSegments(patched.segments), '1girl, sunset');
});

test('示例图：必须是已有图片，图片删除后引用自动清空', async (t) => {
  const { db } = await openTestDb(t);
  await db.mutate((data) => {
    data.images.push({
      id: 'i_example',
      target: 'nai',
      fileName: 'example.png',
      ext: 'png',
      width: 64,
      height: 64,
      bytes: 100,
      hash: 'h_example',
      folderId: null,
      albumIds: [],
      tags: [],
      favorite: false,
      metadata: { format: 'nai', positive: '', negative: '', width: 64, height: 64, loras: [], raw: null },
      promptId: null,
      importedAt: '2026-01-01T00:00:00.000Z',
      sourcePath: null,
      file: 'nai/h_example.png',
      order: 0,
    });
  });

  const prompt = await prompts.create(db, {
    target: 'nai',
    positive: '1girl, solo',
    exampleImageId: 'i_example',
  });
  assert.equal(prompt.exampleImageId, 'i_example');

  const updated = await prompts.update(db, prompt.id, { exampleImageId: 'i_example' });
  assert.equal(updated.exampleImageId, 'i_example');

  await assert.rejects(
    () => prompts.update(db, prompt.id, { exampleImageId: 'i_missing' }),
    /示例图片不存在/,
  );

  // 复制保留示例图
  const copy = await prompts.duplicate(db, prompt.id);
  assert.equal(copy.exampleImageId, 'i_example');

  // 删除图片后引用清空
  const { remove: removeImage } = await import('../images/service.js');
  await removeImage({ db, config: { imagesDir: '.', dataDir: '.' } }, 'i_example');
  const after = db.snapshot().prompts.find((item) => item.id === prompt.id);
  assert.equal(after.exampleImageId, null);
});
