/**
 * `parameters` 文本块解析（A1111 / SwarmUI 共用格式）。
 *
 * 形如：
 *   <正向提示词>
 *   Negative prompt: <反向提示词>
 *   Steps: 20, Sampler: euler, Schedule type: normal, CFG scale: 7, Seed: 123, Size: 832x1216, Model: xxx
 *
 * SwarmUI 用 ComfyUI 后端时也会写这个块，并额外带 `workflow`（UI 图）。
 */

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 从正向文本里提取 <lora:name:weight> */
export function parseLoras(text) {
  const loras = [];
  const seen = new Set();
  const pattern = /<lora:([^:>]+)(?::([\d.]+))?>/gi;
  let match;
  while ((match = pattern.exec(String(text || '')))) {
    const name = match[1].trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const strength = num(match[2]);
    loras.push({ name, strength: strength ?? 1, clipStrength: strength ?? 1 });
  }
  return loras;
}

/**
 * @returns {{positive:string, negative:string, steps:number|null, sampler:string|null,
 *   scheduler:string|null, cfg:number|null, seed:number|null, width:number|null,
 *   height:number|null, model:string|null, loras:Array}} | null
 */
export function parseParametersText(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const normalized = text.replace(/\r\n/g, '\n');

  const negativeIndex = normalized.search(/\nNegative prompt:\s*/i);
  let positive = negativeIndex >= 0 ? normalized.slice(0, negativeIndex) : normalized;
  let rest = negativeIndex >= 0 ? normalized.slice(negativeIndex).replace(/^\nNegative prompt:\s*/i, '') : '';

  // 最后一段以 Steps: 开头的是参数行，之前的是反向提示词
  let negative = rest;
  let settingsLine = '';
  const lines = rest.split('\n');
  const settingsIndex = lines.findIndex((line) => /^Steps:\s*/i.test(line.trim()));
  if (settingsIndex >= 0) {
    negative = lines.slice(0, settingsIndex).join('\n');
    settingsLine = lines.slice(settingsIndex).join('\n');
  }

  const params = {};
  if (settingsLine) {
    for (const part of settingsLine.split(/,\s*(?=[A-Za-z][A-Za-z0-9 _-]*:)/)) {
      const match = part.match(/^([^:]+):\s*([\s\S]*)$/);
      if (match) params[match[1].trim().toLowerCase()] = match[2].trim();
    }
  }

  let width = null;
  let height = null;
  const size = String(params.size || '').match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  if (size) {
    width = Number(size[1]);
    height = Number(size[2]);
  }

  positive = positive.trim();
  negative = negative.trim();

  return {
    positive,
    negative,
    steps: num(params.steps),
    sampler: params.sampler || null,
    scheduler: params['schedule type'] || params.scheduler || null,
    cfg: num(params['cfg scale'] ?? params.cfg),
    seed: num(params.seed),
    width,
    height,
    model: params.model || null,
    loras: parseLoras(`${positive}\n${negative}`),
  };
}
