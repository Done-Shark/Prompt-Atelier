/**
 * NovelAI 适配器：默认参数、规范化、copy 文本。
 * 参数键与 NAI 官方 PNG Comment JSON 对齐（steps/scale/seed/sampler/...）。
 */
import { cleanBool, cleanInt, cleanNumber, cleanString, isPlainObject } from '../lib/validate.js';

const TARGET = 'nai';

const DEFAULTS = {
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
};

export function defaults() {
  return { ...DEFAULTS };
}

/** 白名单 + 类型转换 + 范围夹紧；未知键丢弃 */
export function normalize(params) {
  const src = isPlainObject(params) ? params : {};
  const out = defaults();
  out.model = cleanString(src.model, { field: 'model', max: 200, lenient: true }) || DEFAULTS.model;
  out.sampler = cleanString(src.sampler, { field: 'sampler', max: 100, lenient: true }) || DEFAULTS.sampler;
  out.steps = cleanInt(src.steps, { min: 1, max: 150, fallback: DEFAULTS.steps });
  out.scale = cleanNumber(src.scale, { min: 0, max: 30, fallback: DEFAULTS.scale });
  out.cfgRescale = cleanNumber(src.cfgRescale, { min: 0, max: 1, fallback: DEFAULTS.cfgRescale });
  out.seed = cleanInt(src.seed, { min: 0, max: 4294967295, fallback: DEFAULTS.seed });
  out.width = cleanInt(src.width, { min: 64, max: 4096, fallback: DEFAULTS.width });
  out.height = cleanInt(src.height, { min: 64, max: 4096, fallback: DEFAULTS.height });
  out.ucPreset = cleanInt(src.ucPreset, { min: 0, max: 3, fallback: DEFAULTS.ucPreset });
  out.qualityToggle = cleanBool(src.qualityToggle, DEFAULTS.qualityToggle);
  out.variety = cleanBool(src.variety, DEFAULTS.variety);
  return out;
}

export function isValidParams(params) {
  if (!isPlainObject(params)) return false;
  return typeof params.model === 'string' && Number.isFinite(params.steps) && Number.isFinite(params.scale);
}

/**
 * copy 文本：正向 → 空行 → Negative prompt → 参数行。
 * withParams=false 时只保留正向与负向。
 */
export function serialize(prompt, options = {}) {
  const { withParams = true } = options;
  const params = normalize(prompt.params);
  const positive = typeof prompt.positive === 'string' ? prompt.positive.trim() : '';
  const negative = typeof prompt.negative === 'string' ? prompt.negative.trim() : '';

  let text = positive;
  if (negative) text += `\n\nNegative prompt: ${negative}`;
  if (withParams) {
    const line = [
      `Steps: ${params.steps}`,
      `Sampler: ${params.sampler}`,
      `CFG scale: ${params.scale}`,
      `Seed: ${params.seed}`,
      `Size: ${params.width}x${params.height}`,
      `Model: ${params.model}`,
    ].join(', ');
    text += `\n${line}`;
  }
  return text;
}

export const naiAdapter = { target: TARGET, defaults, normalize, serialize, isValidParams };
