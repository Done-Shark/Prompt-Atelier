/**
 * Gemini 接口：请求体结构、响应解析、结果归一化与缺 Key 的报错。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GEMINI_DEFAULT_MODEL,
  buildGeminiRequest,
  geminiEndpoint,
  parseGeminiResponse,
  translateTagsWithGemini,
} from './gemini.js';
import { buildResultMap, parseJsonContent } from './aiShared.js';

test('Gemini 请求：system 指令 + 分类表 + tag 列表，要求 JSON 输出', () => {
  const body = buildGeminiRequest(['long_hair', '1girl']);
  assert.match(body.systemInstruction.parts[0].text, /tag/);
  assert.equal(body.contents.length, 1);
  assert.equal(body.contents[0].role, 'user');
  const payload = JSON.parse(body.contents[0].parts[0].text);
  assert.deepEqual(payload.tags, ['long_hair', '1girl']);
  assert.ok(payload.categories.some((item) => item.id === 'appearance'));
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.temperature, 0);
});

test('Gemini 端点：模型名拼进路径并转义', () => {
  assert.equal(
    geminiEndpoint('https://generativelanguage.googleapis.com/v1beta', 'gemini-2.5-flash'),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  );
  assert.equal(GEMINI_DEFAULT_MODEL, 'gemini-2.5-flash');
});

test('Gemini 响应：多段 text 拼接、容忍代码块包裹、被拦截时报错', () => {
  const payload = {
    candidates: [
      {
        content: {
          parts: [
            { text: '```json\n{"items":[{"tag":"long_hair","translation":"长发",' },
            { text: '"category":"appearance"}]}\n```' },
          ],
        },
      },
    ],
  };
  const parsed = parseGeminiResponse(payload);
  assert.equal(parsed.items[0].translation, '长发');

  assert.throws(
    () => parseGeminiResponse({ promptFeedback: { blockReason: 'SAFETY' } }),
    /Gemini 没有返回内容（SAFETY）/,
  );
});

test('结果归一化：过滤未请求的 tag、非法分类落 unsorted', () => {
  const map = buildResultMap(
    {
      items: [
        { tag: 'Long_Hair', translation: '长发', category: 'appearance' },
        { tag: 'not_requested', translation: '无关', category: 'scene' },
        { tag: 'solo', translation: '单人', category: '不存在' },
        { tag: 'empty', translation: '' },
      ],
    },
    ['long_hair', 'solo', 'empty'],
  );
  assert.equal(map.get('long_hair').translation, '长发');
  assert.equal(map.get('solo').category, 'unsorted');
  assert.equal(map.has('not_requested'), false);
  assert.equal(map.has('empty'), false);
});

test('Gemini 缺少 API Key 时直接报错，不发请求', async () => {
  await assert.rejects(() => translateTagsWithGemini({ apiKey: '' }, ['1girl']), /API Key/);
});

test('JSON 解析：容忍前后说明文字', () => {
  assert.deepEqual(parseJsonContent('结果如下：{"items":[]} 以上'), { items: [] });
});
