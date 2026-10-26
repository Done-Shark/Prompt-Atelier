/**
 * NAI PNG Comment JSON → ImageMetadata。
 * 键名兼容 NAI 官方输出与社区工具的多种写法（见 REFERENCE_NOTES §2.3）。
 */

function num(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 判断这段 JSON 是否像 NAI 输出（避免把别的 Comment 当 NAI） */
export function looksLikeNai(raw) {
  if (!isObject(raw)) return false;
  if (isObject(raw.v4_prompt) || isObject(raw.v4_negative_prompt)) return true;
  if (typeof raw.uc === 'string') return true;
  if (raw.sampler !== undefined || raw.noise_schedule !== undefined) return true;
  if (raw.ucPreset !== undefined || raw.sm !== undefined || raw.sm_dyn !== undefined) return true;
  // 只有 prompt + steps 也认（旧版 NAI）
  return typeof raw.prompt === 'string' && (raw.steps !== undefined || raw.seed !== undefined);
}

/** @returns {import('../../web/src/lib/types.ts').ImageMetadata | null} */
export function parseNaiJson(raw) {
  if (!looksLikeNai(raw)) return null;

  const v4 = isObject(raw.v4_prompt) ? raw.v4_prompt : null;
  const v4neg = isObject(raw.v4_negative_prompt) ? raw.v4_negative_prompt : null;
  const positive = text(v4?.caption?.base_caption) || text(raw.prompt) || text(raw.description);
  const negative = text(v4neg?.caption?.base_caption) || text(raw.uc) || text(raw.negative_prompt);

  return {
    format: 'nai',
    positive,
    negative,
    model: text(raw.model) || text(raw.source) || null,
    sampler: text(raw.sampler) || text(raw.noise_schedule) || null,
    scheduler: text(raw.noise_schedule) || null,
    seed: num(raw.seed),
    steps: num(raw.steps),
    cfg: num(raw.scale ?? raw.cfg_scale ?? raw.guidance),
    width: num(raw.width),
    height: num(raw.height),
    loras: [],
    raw,
  };
}

/** 从 Comment 文本解析；非法 JSON 返回 null */
export function parseNaiComment(commentText) {
  if (typeof commentText !== 'string' || !commentText.trim()) return null;
  let raw;
  try {
    raw = JSON.parse(commentText);
  } catch {
    return null;
  }
  return parseNaiJson(raw);
}
