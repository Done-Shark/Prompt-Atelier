/**
 * `parameters` 文本块（A1111 / SwarmUI）：正负向、参数行、Lora 提取。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLoras, parseParametersText } from './parametersMetadata.js';
import { analyzeBuffer } from '../modules/images/service.js';
import { encodePng } from './pngEncode.js';

const TEXT = `@orangeo, score_9, 1girl, solo
<lora:anima-base:0.6> <lora:style:0.7>
Negative prompt: worst quality, lowres, bad anatomy
Steps: 12, Sampler: Euler Normal, CFG scale: 1, Seed: 881174625600749, Size: 1024x1536, Model: anima_baseV10`;

test('parseParametersText：正负向、参数与 Lora', () => {
  const parsed = parseParametersText(TEXT);
  assert.equal(parsed.positive, '@orangeo, score_9, 1girl, solo\n<lora:anima-base:0.6> <lora:style:0.7>');
  assert.equal(parsed.negative, 'worst quality, lowres, bad anatomy');
  assert.equal(parsed.steps, 12);
  assert.equal(parsed.sampler, 'Euler Normal');
  assert.equal(parsed.cfg, 1);
  assert.equal(parsed.seed, 881174625600749);
  assert.equal(parsed.width, 1024);
  assert.equal(parsed.height, 1536);
  assert.equal(parsed.model, 'anima_baseV10');
  assert.deepEqual(parsed.loras, [
    { name: 'anima-base', strength: 0.6, clipStrength: 0.6 },
    { name: 'style', strength: 0.7, clipStrength: 0.7 },
  ]);
});

test('parseLoras：没有权重时默认 1，重复只保留一次', () => {
  assert.deepEqual(parseLoras('<lora:a> <lora:b:0.4> <lora:a:0.9>'), [
    { name: 'a', strength: 1, clipStrength: 1 },
    { name: 'b', strength: 0.4, clipStrength: 0.4 },
  ]);
});

test('analyzeBuffer：只有 parameters 时也能读出正负向', () => {
  const png = encodePng({
    width: 8,
    height: 8,
    textChunks: [{ key: 'parameters', value: TEXT }],
    pixel: () => [10, 20, 30],
  });
  const { metadata } = analyzeBuffer(png);
  assert.equal(metadata.positive, '@orangeo, score_9, 1girl, solo\n<lora:anima-base:0.6> <lora:style:0.7>');
  assert.equal(metadata.negative, 'worst quality, lowres, bad anatomy');
  assert.equal(metadata.steps, 12);
});

test('analyzeBuffer：parameters + workflow 归为 comfyui', () => {
  const png = encodePng({
    width: 8,
    height: 8,
    textChunks: [
      { key: 'parameters', value: TEXT },
      { key: 'workflow', value: JSON.stringify({ nodes: [], links: [] }) },
    ],
    pixel: () => [10, 20, 30],
  });
  const { metadata, raw } = analyzeBuffer(png);
  assert.equal(metadata.format, 'comfyui');
  assert.equal(metadata.negative, 'worst quality, lowres, bad anatomy');
  assert.ok(raw.parameters);
  assert.ok(raw.workflow);
});
