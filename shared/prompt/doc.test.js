/**
 * 共享 Prompt 内核测试：分词、分类、分块、序列化、高亮。
 * 这是前后端共用且最容易回归的部分，改动分类表或分词规则必须跑这里。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bareTag,
  buildSegments,
  classifyTag,
  countTags,
  normalizeSegments,
  parseTags,
  serializeSegments,
  tokenizePrompt,
} from './doc.js';

test('parseTags：顶层逗号、中文逗号与换行都算分隔符', () => {
  assert.deepEqual(parseTags('1girl, solo'), ['1girl', 'solo']);
  assert.deepEqual(parseTags('1girl，solo'), ['1girl', 'solo']);
  assert.deepEqual(parseTags('a\nb;c'), ['a', 'b', 'c']);
  assert.deepEqual(parseTags('  a ,, b , '), ['a', 'b']);
});

test('parseTags：括号与 LoRA 内部的逗号不切分', () => {
  assert.deepEqual(parseTags('{sunset, night}, 1girl'), ['{sunset, night}', '1girl']);
  assert.deepEqual(parseTags('<lora:a,b:0.8>, city'), ['<lora:a,b:0.8>', 'city']);
  assert.deepEqual(parseTags('(smile:1.2), [rain]'), ['(smile:1.2)', '[rain]']);
  assert.deepEqual(parseTags('1.2::x::, y'), ['1.2::x::', 'y']);
});

test('parseTags：完全重复的 tag 只保留一次', () => {
  assert.deepEqual(parseTags('1girl, 1girl, solo'), ['1girl', 'solo']);
});

test('bareTag：去掉权重包裹与尾随权重值', () => {
  assert.equal(bareTag('{sunset}'), 'sunset');
  assert.equal(bareTag('[[rain]]'), 'rain');
  assert.equal(bareTag('(smile:1.2)'), 'smile');
  assert.equal(bareTag('plain'), 'plain');
});

test('classifyTag：常见语义都能落到正确的块', () => {
  assert.equal(classifyTag('artist:ciloranko'), 'artist');
  assert.equal(classifyTag('by wlop'), 'artist');
  assert.equal(classifyTag('1girl'), 'subject');
  assert.equal(classifyTag('genshin impact'), 'subject');
  assert.equal(classifyTag('long hair'), 'appearance');
  assert.equal(classifyTag('school uniform'), 'clothing');
  assert.equal(classifyTag('looking at viewer'), 'pose');
  assert.equal(classifyTag('smile'), 'expression');
  assert.equal(classifyTag('city'), 'scene');
  assert.equal(classifyTag('depth of field'), 'composition');
  assert.equal(classifyTag('masterpiece'), 'style');
  assert.equal(classifyTag('<lora:style_x:0.8>'), 'lora');
  assert.equal(classifyTag('某个完全陌生的词'), 'unsorted');
  assert.equal(classifyTag('{sunset}'), 'scene');
});

test('buildSegments：按语义块默认顺序排列，块内保持原顺序', () => {
  const text = 'masterpiece, 1girl, long hair, smile, city, 1boy';
  const segments = buildSegments(text);
  assert.deepEqual(
    segments.map((segment) => segment.kind),
    ['subject', 'appearance', 'expression', 'scene', 'style'],
  );
  assert.deepEqual(segments[0].tags.map((tag) => tag.text), ['1girl', '1boy']);
  assert.equal(countTags(segments), 6);
});

test('serializeSegments：跳过停用 tag，按块顺序拼接', () => {
  const segments = [
    {
      id: 's1',
      kind: 'scene',
      label: '背景',
      tags: [
        { id: 't1', text: 'sunset', enabled: true },
        { id: 't2', text: 'rain', enabled: false },
      ],
    },
    { id: 's2', kind: 'subject', label: '人物', tags: [{ id: 't3', text: '1girl', enabled: true }] },
  ];
  assert.equal(serializeSegments(segments), 'sunset, 1girl');
  assert.equal(countTags(segments), 2);
});

test('normalizeSegments：上限、非法 kind、字符串 tag、空块保留', () => {
  const manyBlocks = Array.from({ length: 30 }, (_, index) => ({
    kind: 'scene',
    tags: [{ text: `tag${index}` }],
  }));
  assert.equal(normalizeSegments(manyBlocks).length, 24);

  const manyTags = [{ kind: 'scene', tags: Array.from({ length: 400 }, (_, index) => `tag${index}`) }];
  assert.equal(normalizeSegments(manyTags)[0].tags.length, 300);

  const normalized = normalizeSegments([
    { kind: 'nope', label: '', tags: ['sunset'] },
    { kind: 'custom', tags: [] },
    null,
    { kind: 'scene', tags: [{ text: '  ', enabled: true }] },
  ]);
  assert.equal(normalized[0].kind, 'unsorted');
  assert.equal(normalized[0].label, '未分类');
  assert.equal(normalized[0].tags[0].text, 'sunset');
  // 空块保留，编辑器需要存下未填写的块
  assert.equal(normalized[1].kind, 'custom');
  assert.equal(normalized[1].tags.length, 0);
  // 空白 tag 被丢弃
  assert.equal(normalized[2].tags.length, 0);
});

test('tokenizePrompt：切分后拼回必须与原文完全一致', () => {
  const samples = [
    '1girl, {sunset}, [rain], (smile:1.2), <lora:x:0.8>',
    'a|b, c\n第二行，中文逗号',
    '无特殊字符',
    '',
    '{{nested}}, ((deep:1.1))',
  ];
  for (const sample of samples) {
    assert.equal(
      tokenizePrompt(sample)
        .map((token) => token.text)
        .join(''),
      sample,
    );
  }
});

test('tokenizePrompt：识别权重、LoRA 与分隔符类型', () => {
  const types = tokenizePrompt('1girl, {sunset}, [rain], (smile:1.2), <lora:x:0.8>').map((token) => token.type);
  assert.ok(types.includes('weight'));
  assert.ok(types.includes('weight-neg'));
  assert.ok(types.includes('paren'));
  assert.ok(types.includes('lora'));
  assert.ok(types.includes('sep'));
});
