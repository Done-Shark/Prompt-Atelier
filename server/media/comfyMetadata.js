/**
 * ComfyUI API 格式图（PNG `prompt` 键）→ ImageMetadata。
 *
 * 定位策略（见 ARCHITECTURE.md §5）：
 * 1. 找 KSampler 系列节点，读 seed/steps/cfg/sampler_name/scheduler；
 * 2. 沿 positive/negative 链接回溯 CLIPTextEncode（可穿 ControlNetApply、
 *    ConditioningCombine 等中间节点，最多 8 跳）；
 * 3. 沿 model 链回溯 checkpoint 与 LoRA；
 * 4. 沿 latent 链接读尺寸；
 * 5. 找不到 KSampler 时退化为「最长 CLIPTextEncode 文本为正向」。
 */

const MAX_DEPTH = 8;
const SAMPLER_PRIORITY = ['KSampler', 'KSamplerAdvanced', 'SamplerCustom', 'SamplerCustomAdvanced'];

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 连线值固定是 [nodeId, slot] */
function isLink(value) {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    (typeof value[0] === 'string' || typeof value[0] === 'number') &&
    typeof value[1] === 'number'
  );
}

function num(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value) {
  return typeof value === 'string' ? value : '';
}

/** 任一节点含 class_type 即认为是 ComfyUI API 图 */
export function isComfyGraph(value) {
  if (!isObject(value)) return false;
  return Object.values(value).some((node) => isObject(node) && typeof node.class_type === 'string');
}

function nodeAt(graph, id) {
  return graph[String(id)] || null;
}

function findSampler(graph) {
  const entries = Object.entries(graph).filter(([, node]) => isObject(node));
  for (const className of SAMPLER_PRIORITY) {
    const hit = entries.find(([, node]) => node.class_type === className);
    if (hit) return { id: hit[0], node: hit[1] };
  }
  const loose = entries.find(([, node]) => typeof node.class_type === 'string' && node.class_type.includes('Sampler'));
  return loose ? { id: loose[0], node: loose[1] } : null;
}

/** 从 CLIPTextEncode 系列节点里取文本：text / prompt / Flux(t5xxl, clip_l) / SDXL(text_g, text_l) */
function encoderText(inputs) {
  const direct = str(inputs.text) || str(inputs.prompt);
  if (direct) return direct;
  const t5 = str(inputs.t5xxl);
  if (t5) return t5;
  const pair = [str(inputs.text_g), str(inputs.text_l)].filter(Boolean);
  if (pair.length) return [...new Set(pair)].join(', ');
  return str(inputs.clip_l);
}

/**
 * 解析字符串链路：PrimitiveString / StringConcatenate / PreviewAny 等。
 * 有些工作流把正向提示词先拼成一串再接进 CLIPTextEncode，必须能追过去。
 */
function resolveStringValue(graph, value, depth = 0, seen = new Set()) {
  if (typeof value === 'string') return value;
  if (!isLink(value) || depth > 12) return '';
  const id = String(value[0]);
  if (seen.has(id)) return '';
  const nextSeen = new Set(seen).add(id);
  const node = nodeAt(graph, id);
  if (!node) return '';
  const inputs = isObject(node.inputs) ? node.inputs : {};
  const className = typeof node.class_type === 'string' ? node.class_type : '';

  if (className.startsWith('PrimitiveString')) {
    return str(inputs.value) || str(inputs.string) || str(inputs.text);
  }
  if (className.includes('StringConcatenate')) {
    const parts = ['string_a', 'string_b', 'string_c'].map((key) =>
      resolveStringValue(graph, inputs[key], depth + 1, nextSeen),
    );
    return parts.filter(Boolean).join(str(inputs.delimiter));
  }
  if (className.includes('PreviewAny')) {
    return resolveStringValue(graph, inputs.source ?? inputs.value ?? inputs.text, depth + 1, nextSeen);
  }
  if (className.includes('CLIPTextEncode')) {
    return encoderText(inputs) || resolveStringValue(graph, inputs.text, depth + 1, nextSeen);
  }
  // LoraManager 之类的自定义节点：text 字段就是 <lora:...> 串
  if (className.includes('Lora') && str(inputs.text)) return str(inputs.text);
  // 其它字符串类节点：优先常见字段，避免把文件名之类的输入拼进来
  if (className.includes('String') || className.includes('Text') || className.includes('Primitive')) {
    for (const key of ['text', 'value', 'string', 'prompt']) {
      if (!(key in inputs)) continue;
      const found = resolveStringValue(graph, inputs[key], depth + 1, nextSeen);
      if (found) return found;
    }
  }
  return '';
}

/**
 * 从连线回溯到文本编码节点。
 * polarity 决定优先走哪个条件口：正向只认 positive，反向只认 negative，
 * 避免穿过 ControlNetApplyAdvanced 这类同时带正负输入的节点时串极性。
 */
function traceText(graph, link, depth = 0, seen = new Set(), polarity = 'positive') {
  if (depth > MAX_DEPTH) return null;
  if (typeof link === 'string') return link;
  if (!isLink(link)) return null;
  const id = String(link[0]);
  if (seen.has(id)) return null;
  const nextSeen = new Set(seen).add(id);
  const node = nodeAt(graph, id);
  if (!node) return null;

  const inputs = isObject(node.inputs) ? node.inputs : {};
  if (typeof node.class_type === 'string' && node.class_type.includes('CLIPTextEncode')) {
    const value = encoderText(inputs);
    if (value) return value;
    // text 也可能是一条字符串链路（PrimitiveString → StringConcatenate → CLIPTextEncode）
    const resolved = resolveStringValue(graph, inputs.text, depth + 1, nextSeen);
    if (resolved) return resolved;
  }

  const preferred = [
    'conditioning',
    'conditioning_1',
    'conditioning_2',
    'conditioning_to',
    'conditioning_from',
    polarity === 'negative' ? 'negative' : 'positive',
    'text',
    'clip',
  ];
  for (const key of preferred) {
    if (!isLink(inputs[key])) continue;
    const found = traceText(graph, inputs[key], depth + 1, nextSeen, polarity);
    if (found !== null) return found;
  }
  for (const [key, value] of Object.entries(inputs)) {
    if (preferred.includes(key) || !isLink(value)) continue;
    // 其它未知输入口可以兜底，但不跨正负极性
    if (key === 'positive' || key === 'negative') continue;
    const found = traceText(graph, value, depth + 1, nextSeen, polarity);
    if (found !== null) return found;
  }
  return null;
}

/** 收集条件链接：SamplerCustomAdvanced 把正负向放在 guider 节点里 */
function conditioningLinks(graph, samplerNode) {
  const inputs = isObject(samplerNode.inputs) ? samplerNode.inputs : {};
  let positive = inputs.positive;
  let negative = inputs.negative;
  let model = inputs.model;
  if ((!positive || !negative) && isLink(inputs.guider)) {
    const guider = nodeAt(graph, inputs.guider[0]);
    if (guider && isObject(guider.inputs)) {
      positive = positive ?? guider.inputs.positive;
      negative = negative ?? guider.inputs.negative;
      model = model ?? guider.inputs.model;
    }
  }
  return { positive, negative, model };
}

/** 沿 model 链回溯，收集 LoRA（近采样器的在前，最后反转成基础→末端） */
function walkModelChain(graph, link, acc, depth = 0, seen = new Set()) {
  if (!isLink(link) || depth > 12) return;
  const id = String(link[0]);
  if (seen.has(id)) return;
  seen.add(id);
  const node = nodeAt(graph, id);
  if (!node) return;
  const inputs = isObject(node.inputs) ? node.inputs : {};
  const className = typeof node.class_type === 'string' ? node.class_type : '';

  if (className.includes('LoraLoader')) {
    const name = str(inputs.lora_name);
    if (name) {
      acc.loras.push({
        name,
        strength: num(inputs.strength_model) ?? 1,
        clipStrength: num(inputs.strength_clip) ?? 1,
      });
    }
  }
  if (className.includes('CheckpointLoader')) {
    acc.checkpoint = str(inputs.ckpt_name) || acc.checkpoint;
    return;
  }
  if (isLink(inputs.model)) walkModelChain(graph, inputs.model, acc, depth + 1, seen);
}

/** 沿 latent 链接找宽高 */
function traceLatent(graph, link, depth = 0, seen = new Set()) {
  if (!isLink(link) || depth > MAX_DEPTH) return null;
  const id = String(link[0]);
  if (seen.has(id)) return null;
  seen.add(id);
  const node = nodeAt(graph, id);
  if (!node) return null;
  const inputs = isObject(node.inputs) ? node.inputs : {};
  const width = num(inputs.width);
  const height = num(inputs.height);
  if (width && height) return { width, height };
  for (const key of ['latent_image', 'samples', 'latent']) {
    if (isLink(inputs[key])) {
      const found = traceLatent(graph, inputs[key], depth + 1, seen);
      if (found) return found;
    }
  }
  return null;
}

function collectEncoders(graph) {
  const out = [];
  for (const node of Object.values(graph)) {
    if (!isObject(node) || typeof node.class_type !== 'string') continue;
    if (!node.class_type.includes('CLIPTextEncode')) continue;
    const inputs = isObject(node.inputs) ? node.inputs : {};
    const value = encoderText(inputs) || resolveStringValue(graph, inputs.text);
    if (value) out.push({ id: node, text: value });
  }
  return out;
}

/** @returns {import('../../web/src/lib/types.ts').ImageMetadata | null} */
export function parseComfyGraph(graph) {
  if (!isComfyGraph(graph)) return null;

  const sampler = findSampler(graph);
  let positive = '';
  let negative = '';
  let checkpoint = '';
  let loras = [];
  let size = null;
  let seed = null;
  let steps = null;
  let cfg = null;
  let samplerName = null;
  let scheduler = null;

  if (sampler) {
    const inputs = isObject(sampler.node.inputs) ? sampler.node.inputs : {};
    const links = conditioningLinks(graph, sampler.node);

    positive = traceText(graph, links.positive, 0, new Set(), 'positive') ?? '';
    negative = traceText(graph, links.negative, 0, new Set(), 'negative') ?? '';

    seed = num(inputs.seed) ?? num(inputs.noise_seed);
    steps = num(inputs.steps);
    cfg = num(inputs.cfg);
    samplerName = str(inputs.sampler_name) || null;
    scheduler = str(inputs.scheduler) || null;

    const acc = { checkpoint: '', loras: [] };
    if (isLink(links.model)) walkModelChain(graph, links.model, acc);
    checkpoint = acc.checkpoint;
    loras = acc.loras.reverse();

    size = traceLatent(graph, inputs.latent_image ?? inputs.latent);
  }

  // 退化：没有采样器或没追到文本时，按长度猜，但绝不把已知的反向文本当成正向
  const encoders = collectEncoders(graph);
  const longestFirst = (list) => list.slice().sort((a, b) => b.text.length - a.text.length);
  if (!positive) {
    const candidates = longestFirst(encoders.filter((item) => item.text.trim() !== negative.trim()));
    if (candidates.length) positive = candidates[0].text;
  }
  if (!negative) {
    const candidates = longestFirst(encoders.filter((item) => item.text.trim() !== positive.trim()));
    if (candidates.length) negative = candidates[0].text;
  }

  if (!checkpoint || !loras.length) {
    for (const node of Object.values(graph)) {
      if (!isObject(node) || typeof node.class_type !== 'string') continue;
      const inputs = isObject(node.inputs) ? node.inputs : {};
      if (!checkpoint && node.class_type.includes('CheckpointLoader')) {
        checkpoint = str(inputs.ckpt_name);
      }
      if (!loras.length && node.class_type.includes('LoraLoader')) {
        // 图里没有采样器链接时的兜底：按节点声明顺序收集
        const name = str(inputs.lora_name);
        if (name) {
          loras.push({
            name,
            strength: num(inputs.strength_model) ?? 1,
            clipStrength: num(inputs.strength_clip) ?? 1,
          });
        }
      }
    }
  }

  const seenNames = new Set();
  loras = loras.filter((lora) => {
    if (seenNames.has(lora.name)) return false;
    seenNames.add(lora.name);
    return true;
  });

  return {
    format: 'comfyui',
    positive,
    negative,
    model: checkpoint || null,
    sampler: samplerName,
    scheduler,
    seed,
    steps,
    cfg,
    width: size?.width ?? null,
    height: size?.height ?? null,
    loras,
    raw: { prompt: graph },
  };
}

/** 从 PNG `prompt` 文本解析 */
export function parseComfyText(textValue) {
  if (typeof textValue !== 'string' || !textValue.trim()) return null;
  let graph;
  try {
    graph = JSON.parse(textValue);
  } catch {
    return null;
  }
  return parseComfyGraph(graph);
}
