/**
 * 元数据解析：NAI Comment JSON 与 ComfyUI API 图。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeNai, parseNaiComment, parseNaiJson } from './naiMetadata.js';
import { isComfyGraph, parseComfyGraph, parseComfyText } from './comfyMetadata.js';

const NAI_V4 = {
  prompt: '1girl, solo, {sunset}',
  uc: 'lowres, bad anatomy',
  steps: 28,
  scale: 5.5,
  seed: 1234567890,
  sampler: 'k_euler_ancestral',
  noise_schedule: 'karras',
  width: 832,
  height: 1216,
  model: 'nai-diffusion-4-5-full',
  v4_prompt: {
    caption: {
      base_caption: '1girl, solo, {sunset}, {{electric train}}, 1.2::cinematic lighting::',
      char_captions: [
        { char_caption: '1girl, silver hair, blue eyes', centers: [{ x: 0.4, y: 0.3 }] },
        { char_caption: '1girl, twin tails', centers: [{ x: 0.7, y: 0.5 }] },
      ],
    },
    use_coords: true,
    use_order: true,
  },
  v4_negative_prompt: {
    caption: { base_caption: 'lowres, bad hands, extra fingers', char_captions: [] },
  },
};

test('NAI V4：优先 base_caption，参数键完整', () => {
  const meta = parseNaiJson(NAI_V4);
  assert.ok(meta);
  assert.equal(meta.format, 'nai');
  assert.equal(meta.positive, '1girl, solo, {sunset}, {{electric train}}, 1.2::cinematic lighting::');
  assert.equal(meta.negative, 'lowres, bad hands, extra fingers');
  assert.equal(meta.seed, 1234567890);
  assert.equal(meta.steps, 28);
  assert.equal(meta.cfg, 5.5);
  assert.equal(meta.width, 832);
  assert.equal(meta.height, 1216);
  assert.equal(meta.model, 'nai-diffusion-4-5-full');
  assert.equal(meta.sampler, 'k_euler_ancestral');
  assert.equal(meta.scheduler, 'karras');
  // 原始数据保留，角色 caption 可从 raw 里取
  assert.equal(meta.raw.v4_prompt.caption.char_captions.length, 2);
});

test('NAI 旧版：回退 prompt / uc，scale 兼容 cfg_scale', () => {
  const meta = parseNaiJson({
    prompt: 'a cat sitting on a chair',
    uc: 'blurry',
    steps: 20,
    cfg_scale: 7,
    seed: 42,
    width: 512,
    height: 512,
    sampler: 'k_euler',
  });
  assert.equal(meta.positive, 'a cat sitting on a chair');
  assert.equal(meta.negative, 'blurry');
  assert.equal(meta.cfg, 7);
  assert.equal(meta.steps, 20);
});

test('NAI：noise_schedule 兜底 sampler，非 NAI JSON 返回 null', () => {
  const meta = parseNaiJson({ prompt: 'x', uc: '', steps: 10, noise_schedule: 'native' });
  assert.equal(meta.sampler, 'native');

  assert.equal(parseNaiJson({ parameters: 'a cat, Steps: 20' }), null);
  assert.equal(parseNaiJson({ foo: 'bar' }), null);
  assert.equal(parseNaiComment('not json'), null);
  assert.equal(looksLikeNai({ prompt: 'x', uc: '' }), true);
  assert.equal(looksLikeNai({ parameters: 'x' }), false);
});

test('NAI：从 PNG Comment 字符串解析', () => {
  const meta = parseNaiComment(JSON.stringify(NAI_V4));
  assert.equal(meta.positive, NAI_V4.v4_prompt.caption.base_caption);
});

const COMFY_GRAPH = {
  3: {
    class_type: 'KSamplerAdvanced',
    inputs: {
      noise_seed: 777,
      steps: 30,
      cfg: 8,
      sampler_name: 'dpmpp_2m',
      scheduler: 'karras',
      add_noise: 'enable',
      start_at_step: 0,
      end_at_step: 10000,
      return_with_leftover_noise: 'disable',
      model: ['10', 0],
      positive: ['8', 0],
      negative: ['7', 0],
      latent_image: ['5', 0],
    },
  },
  5: { class_type: 'EmptySD3LatentImage', inputs: { width: 832, height: 1216, batch_size: 1 } },
  6: { class_type: 'CLIPTextEncode', inputs: { text: 'masterpiece, 1girl, city at night', clip: ['4', 1] } },
  7: { class_type: 'CLIPTextEncode', inputs: { text: 'lowres, bad hands', clip: ['4', 1] } },
  8: { class_type: 'ControlNetApply', inputs: { conditioning: ['6', 0], control_net: ['9', 0], image: ['11', 0], strength: 0.6 } },
  9: { class_type: 'ControlNetLoader', inputs: { control_net_name: 'canny.safetensors' } },
  10: {
    class_type: 'LoraLoader',
    inputs: { lora_name: 'style.safetensors', strength_model: 0.8, strength_clip: 0.7, model: ['12', 0], clip: ['4', 1] },
  },
  12: {
    class_type: 'LoraLoader',
    inputs: { lora_name: 'char.safetensors', strength_model: 1, strength_clip: 1, model: ['4', 0], clip: ['4', 1] },
  },
  4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'illustrious_v1.safetensors' } },
  11: { class_type: 'LoadImage', inputs: { image: 'input.png' } },
};

test('ComfyUI：沿 positive 链接穿过 ControlNetApply 定位文本', () => {
  const meta = parseComfyGraph(COMFY_GRAPH);
  assert.ok(meta);
  assert.equal(meta.format, 'comfyui');
  assert.equal(meta.positive, 'masterpiece, 1girl, city at night');
  assert.equal(meta.negative, 'lowres, bad hands');
  assert.equal(meta.seed, 777);
  assert.equal(meta.steps, 30);
  assert.equal(meta.cfg, 8);
  assert.equal(meta.sampler, 'dpmpp_2m');
  assert.equal(meta.scheduler, 'karras');
  assert.equal(meta.model, 'illustrious_v1.safetensors');
  assert.equal(meta.width, 832);
  assert.equal(meta.height, 1216);
});

test('ComfyUI：LoRA 链按「checkpoint → 末端」顺序返回', () => {
  const meta = parseComfyGraph(COMFY_GRAPH);
  assert.deepEqual(meta.loras, [
    { name: 'char.safetensors', strength: 1, clipStrength: 1 },
    { name: 'style.safetensors', strength: 0.8, clipStrength: 0.7 },
  ]);
});

test('ComfyUI：无 KSampler 时取最长 CLIPTextEncode 为正向', () => {
  const graph = {
    1: { class_type: 'CLIPTextEncode', inputs: { text: 'short' } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: 'a much longer positive prompt, highly detailed' } },
    3: { class_type: 'VAEDecode', inputs: { samples: ['1', 0] } },
  };
  const meta = parseComfyGraph(graph);
  assert.equal(meta.positive, 'a much longer positive prompt, highly detailed');
  assert.equal(meta.negative, 'short');
  assert.equal(meta.steps, null);
  assert.equal(meta.model, null);
});

test('ComfyUI：非 API 图返回 null，文本入口可用', () => {
  assert.equal(isComfyGraph({ nodes: [], links: [] }), false);
  assert.equal(parseComfyGraph({ nodes: [] }), null);
  assert.equal(parseComfyText('not json'), null);

  const meta = parseComfyText(JSON.stringify(COMFY_GRAPH));
  assert.equal(meta.positive, 'masterpiece, 1girl, city at night');
});

test('ComfyUI：negative 穿过 ControlNetApplyAdvanced 时不会串到 positive', () => {
  const graph = {
    1: {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0],
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
        seed: 1,
        steps: 20,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
      },
    },
    2: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'm.safetensors' } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: 'POS TEXT', clip: ['2', 1] } },
    4: {
      class_type: 'ControlNetApplyAdvanced',
      inputs: {
        positive: ['3', 0],
        negative: ['6', 0],
        control_net: ['7', 0],
        image: ['8', 0],
        strength: 1,
        start_percent: 0,
        end_percent: 1,
      },
    },
    6: { class_type: 'CLIPTextEncode', inputs: { text: 'NEG TEXT', clip: ['2', 1] } },
    7: { class_type: 'ControlNetLoader', inputs: { control_net_name: 'canny.safetensors' } },
    8: { class_type: 'LoadImage', inputs: { image: 'input.png' } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  };
  const meta = parseComfyGraph(graph);
  assert.equal(meta.positive, 'POS TEXT');
  assert.equal(meta.negative, 'NEG TEXT');
});

test('ComfyUI：Flux 的 CLIPTextEncodeFlux 能取到 t5xxl 文本', () => {
  const graph = {
    1: {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0],
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
        seed: 1,
        steps: 20,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'simple',
      },
    },
    2: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'flux.safetensors' } },
    3: {
      class_type: 'CLIPTextEncodeFlux',
      inputs: { clip: ['2', 1], t5xxl: 'FLUX POSITIVE', clip_l: 'flux clip positive' },
    },
    4: { class_type: 'CLIPTextEncode', inputs: { text: 'FLUX NEGATIVE', clip: ['2', 1] } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
  };
  const meta = parseComfyGraph(graph);
  assert.equal(meta.positive, 'FLUX POSITIVE');
  assert.equal(meta.negative, 'FLUX NEGATIVE');
});

test('ComfyUI：正向链路无法识别时，不会把反向文本当成正向', () => {
  const graph = {
    1: {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0],
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
        seed: 1,
        steps: 20,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
      },
    },
    2: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'm.safetensors' } },
    3: { class_type: 'SomeUnknownConditioningNode', inputs: { foo: 'bar' } },
    4: { class_type: 'CLIPTextEncode', inputs: { text: 'ONLY NEGATIVE', clip: ['2', 1] } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  };
  const meta = parseComfyGraph(graph);
  assert.equal(meta.negative, 'ONLY NEGATIVE');
  assert.equal(meta.positive, '');
});

test('ComfyUI：CLIPTextEncode 的 text 是字符串拼接链路时也能解析', () => {
  const graph = {
    1: {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0],
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
        seed: 1,
        steps: 20,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
      },
    },
    2: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'm.safetensors' } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: ['10', 0], clip: ['2', 1] } },
    4: { class_type: 'CLIPTextEncode', inputs: { text: 'NEG', clip: ['2', 1] } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    10: { class_type: 'PreviewAny', inputs: { source: ['11', 0] } },
    11: { class_type: 'StringConcatenate', inputs: { string_a: ['12', 0], string_b: ['13', 0], delimiter: '' } },
    12: { class_type: 'PrimitiveStringMultiline', inputs: { value: 'quality, score_9' } },
    13: { class_type: 'PrimitiveStringMultiline', inputs: { value: '1girl, solo' } },
  };
  const meta = parseComfyGraph(graph);
  assert.equal(meta.positive, 'quality, score_91girl, solo');
  assert.equal(meta.negative, 'NEG');
});

test('ComfyUI：字符串链路里包含 LoraManager 的 <lora:...> 文本', () => {
  const graph = {
    1: {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0],
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
        seed: 1,
        steps: 20,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
      },
    },
    2: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'm.safetensors' } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: ['10', 0], clip: ['2', 1] } },
    4: { class_type: 'CLIPTextEncode', inputs: { text: 'NEG', clip: ['2', 1] } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    10: { class_type: 'StringConcatenate', inputs: { string_a: ['11', 0], string_b: ['12', 0], delimiter: '' } },
    11: { class_type: 'PrimitiveStringMultiline', inputs: { value: 'score_9, 1girl, solo' } },
    12: { class_type: 'Lora Loader (LoraManager)', inputs: { text: '<lora:anima:0.6>' } },
  };
  const meta = parseComfyGraph(graph);
  assert.equal(meta.positive, 'score_9, 1girl, solo<lora:anima:0.6>');
  assert.equal(meta.negative, 'NEG');
});
