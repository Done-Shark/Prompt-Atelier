/**
 * PNG 文本块解析：tEXt / zTXt / iTXt。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isPng, readChunks, readSize, readTextChunks } from './png.js';
import { encodePng } from './pngEncode.js';

const SAMPLE = JSON.stringify({ prompt: '1girl, solo', steps: 28, uc: 'lowres' });

function buildPng(textChunks) {
  return encodePng({ width: 8, height: 6, textChunks });
}

test('解析 tEXt / zTXt / iTXt 三种文本块', () => {
  const buffer = buildPng([
    { key: 'Comment', value: SAMPLE, type: 'tEXt' },
    { key: 'parameters', value: 'a cat\nSteps: 20', type: 'zTXt' },
    { key: 'prompt', value: '{"1":{"class_type":"KSampler"}}', type: 'iTXt' },
    { key: 'workflow', value: '{"nodes":[]}', type: 'iTXt', compress: true },
  ]);

  assert.equal(isPng(buffer), true);
  const texts = readTextChunks(buffer);
  assert.equal(texts.Comment, SAMPLE);
  assert.equal(texts.parameters, 'a cat\nSteps: 20');
  assert.equal(texts.prompt, '{"1":{"class_type":"KSampler"}}');
  assert.equal(texts.workflow, '{"nodes":[]}');
});

test('chunk 列表包含 IHDR/IDAT/IEND，尺寸读取正确', () => {
  const buffer = buildPng([{ key: 'Comment', value: 'x' }]);
  const types = readChunks(buffer).map((chunk) => chunk.type);
  assert.deepEqual(types, ['IHDR', 'tEXt', 'IDAT', 'IEND']);
  assert.deepEqual(readSize(buffer), { width: 8, height: 6 });
});

test('非 PNG 与截断数据不抛异常', () => {
  assert.equal(isPng(Buffer.from('not a png')), false);
  assert.deepEqual(readChunks(Buffer.from('nope')), []);
  assert.deepEqual(readTextChunks(Buffer.from('nope')), {});

  const buffer = buildPng([{ key: 'Comment', value: SAMPLE }]);
  const truncated = buffer.subarray(0, 40);
  assert.doesNotThrow(() => readTextChunks(truncated));
});

test('UTF-8 文本正确解码', () => {
  const buffer = buildPng([{ key: 'Comment', value: '{"prompt":"银发少女, 雨夜"}' }]);
  assert.equal(readTextChunks(buffer).Comment, '{"prompt":"银发少女, 雨夜"}');
});
