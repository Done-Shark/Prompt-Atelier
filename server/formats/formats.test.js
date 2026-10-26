/**
 * 格式适配层：默认参数、规范化夹紧、copy 文本格式。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { getAdapter, isTarget, normalizeFor } from '../formats/index.js';
import { defaults as naiDefaults, normalize as naiNormalize, serialize as naiSerialize } from '../formats/nai.js';
import { defaults as comfyDefaults, normalize as comfyNormalize, serialize as comfySerialize } from '../formats/comfyui.js';

test('NAI 默认参数与 API.md §6 一致', () => {
  assert.deepEqual(naiDefaults(), {
    model: 'nai-diffusion-4-5-full',
    sampler: 'k_euler_ancestral',
    steps: 28,
    scale: 5,
    cfgRescale: 0,
    seed: 0,
    width: 832,
    height: 1216,
    ucPreset: 0,
    qualityToggle: true,
    variety: false,
  });
});

test('NAI 规范化：类型转换、范围夹紧、未知键丢弃', () => {
  const params = naiNormalize({
    steps: 999,
    scale: 99,
    cfgRescale: 3,
    seed: -5,
    width: 1,
    height: 99999,
    ucPreset: 9,
    qualityToggle: 'false',
    variety: 'true',
    unknownKey: 'x',
  });
  assert.equal(params.steps, 150);
  assert.equal(params.scale, 30);
  assert.equal(params.cfgRescale, 1);
  assert.equal(params.seed, 0);
  assert.equal(params.width, 64);
  assert.equal(params.height, 4096);
  assert.equal(params.ucPreset, 3);
  assert.equal(params.qualityToggle, false);
  assert.equal(params.variety, true);
  assert.equal('unknownKey' in params, false);

  const coerced = naiNormalize({ steps: '30', scale: '6.5', seed: '123456789012' });
  assert.equal(coerced.steps, 30);
  assert.equal(coerced.scale, 6.5);
  assert.equal(coerced.seed, 4294967295);
});

test('NAI 规范化：非法值回落默认', () => {
  const params = naiNormalize({ steps: 'abc', seed: null, model: 42, sampler: '' });
  assert.equal(params.steps, 28);
  assert.equal(params.seed, 0);
  assert.equal(params.model, 'nai-diffusion-4-5-full');
  assert.equal(params.sampler, 'k_euler_ancestral');
});

test('NAI copy 文本：正向 / Negative prompt / 参数行', () => {
  const text = naiSerialize(
    {
      positive: '1girl, solo',
      negative: 'lowres, bad anatomy',
      params: { steps: 28, sampler: 'k_euler_ancestral', scale: 5, seed: 123, width: 832, height: 1216, model: 'nai-diffusion-4-5-full' },
    },
    { withParams: true },
  );
  assert.equal(
    text,
    '1girl, solo\n\nNegative prompt: lowres, bad anatomy\nSteps: 28, Sampler: k_euler_ancestral, CFG scale: 5, Seed: 123, Size: 832x1216, Model: nai-diffusion-4-5-full',
  );
});

test('NAI copy 文本：copyWithParams=false 只保留正向与负向', () => {
  const text = naiSerialize(
    { positive: '1girl, solo', negative: 'lowres', params: {} },
    { withParams: false },
  );
  assert.equal(text, '1girl, solo\n\nNegative prompt: lowres');
  assert.equal(naiSerialize({ positive: 'cat', negative: '', params: {} }, { withParams: false }), 'cat');
});

test('ComfyUI 默认参数与 API.md §6 一致', () => {
  assert.deepEqual(comfyDefaults(), {
    checkpoint: '',
    loras: [],
    sampler: 'euler',
    scheduler: 'normal',
    steps: 20,
    cfg: 7,
    seed: 0,
    width: 1024,
    height: 1024,
    batch: 1,
    workflow: null,
  });
});

test('ComfyUI 规范化：夹紧与 LoRA 清洗', () => {
  const params = comfyNormalize({
    steps: 0,
    cfg: 100,
    seed: 2 ** 40,
    width: 10,
    height: 5000,
    batch: 99,
    loras: [
      { name: 'a.safetensors', strength: 0.8, clipStrength: 0.7 },
      { name: '   ' },
      { name: 'b.safetensors', strength: '1.5' },
      'bad',
    ],
    workflow: { nodes: [] },
    extra: 1,
  });
  assert.equal(params.steps, 1);
  assert.equal(params.cfg, 30);
  assert.equal(params.seed, 4294967295);
  assert.equal(params.width, 64);
  assert.equal(params.height, 4096);
  assert.equal(params.batch, 16);
  assert.deepEqual(params.loras, [
    { name: 'a.safetensors', strength: 0.8, clipStrength: 0.7 },
    { name: 'b.safetensors', strength: 1.5, clipStrength: 1 },
  ]);
  assert.deepEqual(params.workflow, { nodes: [] });
  assert.equal('extra' in params, false);
});

test('ComfyUI copy 文本：LoRA 行追加在正向末尾', () => {
  const text = comfySerialize(
    {
      positive: '1girl, city',
      negative: 'lowres',
      params: {
        loras: [
          { name: 'style.safetensors', strength: 0.8, clipStrength: 0.7 },
          { name: 'char.safetensors', strength: 1, clipStrength: 1 },
        ],
      },
    },
    { withParams: true },
  );
  assert.equal(text, '1girl, city\n<lora:style.safetensors:0.8>\n<lora:char.safetensors:1>\n\nNegative: lowres');
});

test('适配器注册表：未知 target 回落 NAI，normalizeFor 可用', () => {
  assert.equal(isTarget('nai'), true);
  assert.equal(isTarget('midjourney'), false);
  assert.equal(getAdapter('midjourney').target, 'nai');
  assert.equal(normalizeFor('comfyui', { steps: 5 }).steps, 5);
});
