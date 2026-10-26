/**
 * ComfyUI 适配器：参数更接近 API 图里的节点值。
 * loras 保留 name/strength/clipStrength 三元组，copy 时转成 <lora:...> 提示行。
 */
import { cleanBool, cleanInt, cleanNumber, cleanString, isPlainObject } from '../lib/validate.js';

const TARGET = 'comfyui';

const DEFAULTS = {
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
};

export function defaults() {
  return { ...DEFAULTS, loras: [] };
}

function normalizeLoras(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const name = cleanString(item.name, { field: 'lora.name', max: 300, lenient: true });
    if (!name) continue;
    out.push({
      name,
      strength: cleanNumber(item.strength, { min: -100, max: 100, fallback: 1 }),
      clipStrength: cleanNumber(item.clipStrength, { min: -100, max: 100, fallback: 1 }),
    });
    if (out.length >= 50) break;
  }
  return out;
}

export function normalize(params) {
  const src = isPlainObject(params) ? params : {};
  const out = defaults();
  out.checkpoint = cleanString(src.checkpoint, { field: 'checkpoint', max: 300, lenient: true }) ?? DEFAULTS.checkpoint;
  out.loras = normalizeLoras(src.loras);
  out.sampler = cleanString(src.sampler, { field: 'sampler', max: 100, lenient: true }) || DEFAULTS.sampler;
  out.scheduler = cleanString(src.scheduler, { field: 'scheduler', max: 100, lenient: true }) || DEFAULTS.scheduler;
  out.steps = cleanInt(src.steps, { min: 1, max: 150, fallback: DEFAULTS.steps });
  out.cfg = cleanNumber(src.cfg, { min: 0, max: 30, fallback: DEFAULTS.cfg });
  out.seed = cleanInt(src.seed, { min: 0, max: 4294967295, fallback: DEFAULTS.seed });
  out.width = cleanInt(src.width, { min: 64, max: 4096, fallback: DEFAULTS.width });
  out.height = cleanInt(src.height, { min: 64, max: 4096, fallback: DEFAULTS.height });
  out.batch = cleanInt(src.batch, { min: 1, max: 16, fallback: DEFAULTS.batch });
  out.workflow = isPlainObject(src.workflow) ? src.workflow : null;
  return out;
}

export function isValidParams(params) {
  if (!isPlainObject(params)) return false;
  return Array.isArray(params.loras) && Number.isFinite(params.steps) && Number.isFinite(params.cfg);
}

/**
 * copy 文本：正向 + LoRA 提示行（末尾追加） + 负向。
 * mode=workflow 时由 service 直接返回 workflow JSON，不走这里。
 */
export function serialize(prompt, options = {}) {
  const { withParams = true } = options;
  const params = normalize(prompt.params);
  const positive = typeof prompt.positive === 'string' ? prompt.positive.trim() : '';
  const negative = typeof prompt.negative === 'string' ? prompt.negative.trim() : '';

  const lines = [positive];
  if (withParams) {
    for (const lora of params.loras) {
      const weight = formatWeight(lora.strength);
      lines.push(`<lora:${lora.name}:${weight}>`);
    }
  }
  let text = lines.filter((line, index) => line !== '' || index === 0).join('\n');
  if (negative) text += `\n\nNegative: ${negative}`;
  return text;
}

function formatWeight(value) {
  const num = Number.isFinite(value) ? value : 1;
  return String(Number(num.toFixed(2)));
}

export const comfyAdapter = { target: TARGET, defaults, normalize, serialize, isValidParams };
