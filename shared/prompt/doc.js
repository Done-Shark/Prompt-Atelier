/**
 * Prompt 文档内核：分词、语义分类、分块、序列化、高亮 token。
 *
 * 前后端共用同一份实现：
 *  - 后端用它把一段纯文本变成结构化 segments，并在保存时反序列化出 positive；
 *  - 前端用它做编辑器分块、语法高亮与复制。
 * 只有这里能决定"什么算一个 tag""tag 属于哪一类"，避免两边漂移。
 *
 * 纯 ESM、零依赖，可直接被 Node 与 Vite 消费。
 */

/** 语义块定义。数组顺序即默认排列顺序。 */
export const SEGMENT_KINDS = [
  { kind: 'artist', label: '画师 / 风格来源', short: '画师' },
  { kind: 'subject', label: '人物 / 版权', short: '人物' },
  { kind: 'appearance', label: '外貌特征', short: '外貌' },
  { kind: 'clothing', label: '服装', short: '服装' },
  { kind: 'pose', label: '动作 / 姿势', short: '动作' },
  { kind: 'expression', label: '表情 / 视线', short: '表情' },
  { kind: 'scene', label: '背景 / 环境', short: '背景' },
  { kind: 'composition', label: '构图 / 镜头', short: '构图' },
  { kind: 'style', label: '质量 / 风格', short: '质量' },
  { kind: 'lora', label: 'LoRA / 触发词', short: 'LoRA' },
  { kind: 'custom', label: '自定义', short: '自定义' },
  { kind: 'unsorted', label: '未分类', short: '未分类' },
];

const KIND_ORDER = SEGMENT_KINDS.map((item) => item.kind);
const KIND_LABEL = new Map(SEGMENT_KINDS.map((item) => [item.kind, item.label]));

export function isSegmentKind(kind) {
  return KIND_ORDER.includes(kind);
}

export function kindLabel(kind) {
  return KIND_LABEL.get(kind) || KIND_LABEL.get('unsorted');
}

/* ------------------------------------------------------------------ */
/* 分词                                                                */
/* ------------------------------------------------------------------ */

/**
 * 按顶层逗号 / 换行切分 tag，保留 {} [] () <> 内部的逗号。
 * 结果去空白、去空项、去完全重复项。
 */
export function parseTags(text) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  let buffer = '';
  let round = 0;
  let square = 0;
  let curly = 0;
  let angle = 0;

  const push = () => {
    const tag = buffer.trim().replace(/^[,，]+|[,，]+$/g, '').trim();
    if (tag && !out.includes(tag)) out.push(tag);
    buffer = '';
  };

  for (const char of text) {
    if (char === '(') round += 1;
    else if (char === ')') round = Math.max(0, round - 1);
    else if (char === '[') square += 1;
    else if (char === ']') square = Math.max(0, square - 1);
    else if (char === '{') curly += 1;
    else if (char === '}') curly = Math.max(0, curly - 1);
    else if (char === '<') angle += 1;
    else if (char === '>') angle = Math.max(0, angle - 1);

    const atTop = round === 0 && square === 0 && curly === 0 && angle === 0;
    if ((char === ',' || char === '，' || char === '\n' || char === ';') && atTop) {
      push();
      continue;
    }
    buffer += char;
  }
  push();
  return out;
}

/** 去掉权重包裹，得到用于分类的裸 tag：{sunset} → sunset，(smile:1.2) → smile */
export function bareTag(tag) {
  let value = String(tag || '').trim();
  let guard = 0;
  while (guard < 8) {
    guard += 1;
    const wrapped =
      (value.startsWith('{') && value.endsWith('}')) ||
      (value.startsWith('[') && value.endsWith(']')) ||
      (value.startsWith('(') && value.endsWith(')'));
    if (!wrapped) break;
    value = value.slice(1, -1).trim();
  }
  // (smile:1.2) 已在上一步去掉括号，这里再兜底去掉尾部的 :数字
  value = value.replace(/:\s*-?\d+(\.\d+)?$/, '').trim();
  return value;
}

/* ------------------------------------------------------------------ */
/* 分类                                                                */
/* ------------------------------------------------------------------ */

const KEYWORDS = {
  style: [
    'masterpiece', 'best quality', 'amazing quality', 'great quality', 'normal quality', 'good quality',
    'very aesthetic', 'aesthetic', 'very awa', 'highres', 'absurdres', 'newest', 'recent', 'mid', 'early',
    'official art', 'high quality', 'ultra detailed', 'extremely detailed', 'highly detailed', 'high detail', 'detailed', '8k', '4k', '16-bit', 'hd',
    'realistic', 'photorealistic', 'photo', 'cinematic', 'cinematic lighting', 'studio lighting',
    'anime style', 'anime coloring', 'flat color', 'flat colour', 'cel shading', 'lineart', 'sketch',
    'monochrome', 'greyscale', 'grayscale', 'watercolor', 'oil painting', 'pixel art', 'vector',
    'concept art', 'illustration', 'digital painting', 'year 2023', 'year 2024', 'year 2025', 'year 2026',
  ],
  composition: [
    'from above', 'from below', 'from side', 'from behind', 'from front', 'cowboy shot', 'portrait',
    'upper body', 'lower body', 'full body', 'close-up', 'extreme close-up', 'wide shot', 'dutch angle',
    'perspective', 'foreshortening', 'depth of field', 'blurry background', 'bokeh', 'rule of thirds',
    'centered', 'symmetry', 'profile', 'three-quarter view', 'fisheye', 'panorama', 'letterboxed',
    'wide angle', 'telephoto', 'macro',
  ],
  pose: [
    'standing', 'sitting', 'seiza', 'wariza', 'lying', 'on back', 'on stomach', 'on side', 'kneeling',
    'squatting', 'crouching', 'walking', 'running', 'jumping', 'leaning', 'leaning forward', 'holding',
    'holding hands', 'arms up', 'arms behind back', 'arms at sides', 'crossed arms', 'hand on hip',
    'hand up', 'hand on own chest', 'waving', 'reaching', 'hugging', 'hug', 'kiss', 'dancing', 'sleeping',
    'eating', 'drinking', 'pointing', 'spread arms', 'stretching', 'bowing', 'saluting', 'fighting',
    'looking at viewer', 'looking away', 'looking back', 'looking down', 'looking up', 'looking to the side',
    'eye contact', 'head tilt', 'hand on own face', 'hands on hips', 'peace sign', 'v sign',
  ],
  expression: [
    'smile', 'grin', 'smirk', 'laugh', 'laughing', 'open mouth', 'closed mouth', 'parted lips', 'blush',
    'tears', 'crying', 'angry', 'annoyed', 'sad', 'surprised', 'shocked', 'scared', 'expressionless',
    'serious', 'wink', 'one eye closed', 'tongue out', 'fang', 'drooling', 'pout', 'embarrassed',
    'happy', 'excited', 'sleepy', 'tired', 'confused', 'determined', 'seductive',
  ],
  clothing: [
    'dress', 'skirt', 'shirt', 't-shirt', 'blouse', 'jacket', 'coat', 'hoodie', 'sweater', 'cardigan',
    'vest', 'uniform', 'school uniform', 'suit', 'armor', 'kimono', 'yukata', 'maid', 'apron', 'cape',
    'cloak', 'scarf', 'tie', 'bowtie', 'ribbon', 'belt', 'pantyhose', 'thighhighs', 'stockings', 'socks',
    'gloves', 'hat', 'cap', 'hood', 'boots', 'shoes', 'sandals', 'heels', 'glasses', 'sunglasses', 'mask',
    'earrings', 'necklace', 'choker', 'hairband', 'hair ornament', 'hairclip', 'swimsuit', 'bikini',
    'shorts', 'pants', 'jeans', 'leggings', 'bra', 'panties', 'underwear', 'lingerie', 'nightgown',
    'jewelry', 'bracelet', 'ring', 'headphones', 'backpack', 'bag',
  ],
  appearance: [
    'hair', 'long hair', 'short hair', 'medium hair', 'twintails', 'ponytail', 'braid', 'bangs', 'ahoge',
    'blonde hair', 'black hair', 'white hair', 'silver hair', 'red hair', 'blue hair', 'pink hair',
    'brown hair', 'purple hair', 'green hair', 'orange hair', 'grey hair', 'multicolored hair',
    'streaked hair', 'gradient hair', 'two-tone hair', 'blue eyes', 'red eyes', 'green eyes', 'yellow eyes',
    'purple eyes', 'brown eyes', 'grey eyes', 'heterochromia', 'slit pupils', 'eyelashes', 'freckles',
    'mole', 'mole under eye', 'tan', 'tanlines', 'pale skin', 'dark skin', 'muscular', 'slim', 'tall',
    'short', 'chubby', 'animal ears', 'cat ears', 'fox ears', 'rabbit ears', 'horns', 'tail', 'wings',
    'elf', 'fangs', 'pointy ears', 'breasts', 'large breasts', 'small breasts', 'flat chest', 'navel',
    'collarbone', 'bare shoulders', 'bare legs', 'barefoot', 'makeup', 'lipstick', 'nail polish',
    'tattoo', 'scar', 'eyepatch', 'hair intakes',
  ],
  scene: [
    'background', 'simple background', 'white background', 'black background', 'transparent background',
    'gradient background', 'sky', 'blue sky', 'night', 'night sky', 'starry sky', 'sunset', 'sunrise',
    'clouds', 'rain', 'snow', 'fog', 'forest', 'tree', 'grass', 'flower', 'flowers', 'field', 'garden',
    'ocean', 'sea', 'beach', 'river', 'lake', 'water', 'mountain', 'city', 'cityscape', 'street',
    'building', 'city lights', 'ruins', 'room', 'indoors', 'outdoors', 'classroom', 'bedroom', 'kitchen', 'cafe',
    'library', 'window', 'curtains', 'bed', 'chair', 'table', 'sofa', 'stairs', 'rooftop', 'balcony',
    'space', 'underwater', 'scenery', 'landscape', 'autumn', 'winter', 'spring', 'summer', 'cherry blossoms',
  ],
  subject: [
    '1girl', '1boy', '2girls', '2boys', 'multiple girls', 'multiple boys', 'solo', 'couple', 'group',
    'male focus', 'female', 'male', 'man', 'woman', 'girl', 'boy', 'child', 'loli', 'shota', 'adult',
    'original', 'original character', 'vtuber', 'virtual youtuber',
    'genshin impact', 'honkai', 'star rail', 'fate', 'fate/grand order', 'azur lane', 'blue archive',
    'arknights', 'nikke', 'hololive', 'nijisanji', 'vocaloid', 'hatsune miku', 'touhou', 'kancolle',
    'girls frontline', 'umamusume', 'love live', 'idolmaster', 'nier', 'final fantasy', 'pokemon',
    'zelda', 'overwatch', 'league of legends', 'cyberpunk', 'elden ring', 'dark souls', 'one piece',
    'naruto', 'bleach', 'jujutsu kaisen', 'chainsaw man', 'spy x family', 'demon slayer',
    'my hero academia', 'sword art online', 're:zero', 'konosuba', 'oshi no ko', 'bocchi the rock',
    'lycoris recoil', 'gundam', 'evangelion', 'sailor moon', 'cardcaptor sakura',
  ],
};

/** 短语 → 分类，预展开成一张表，匹配时先长后短 */
const PHRASE_INDEX = (() => {
  const map = new Map();
  for (const [kind, list] of Object.entries(KEYWORDS)) {
    for (const phrase of list) map.set(phrase, kind);
  }
  return map;
})();

const ARTIST_HINTS = /^(artist\s*[::]|by\s+)/i;
const SERIES_SUFFIX = /_\([^)]*\)$/;

/**
 * 判定一个 tag 的语义分类。
 * 优先级：LoRA → 画师前缀 → 质量 → 构图 → 动作 → 表情 → 服装 → 外貌 → 场景 → 人物 → 未分类。
 * 顺序有讲究：`looking at viewer` 应落在动作而不是表情，`full body` 应落在构图而不是外貌。
 */
export function classifyTag(tag) {
  const raw = String(tag || '').trim();
  if (!raw) return 'unsorted';
  if (/^<lora:/i.test(raw)) return 'lora';
  if (ARTIST_HINTS.test(raw)) return 'artist';

  const bare = bareTag(raw).toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (!bare) return 'unsorted';
  if (PHRASE_INDEX.has(bare)) return PHRASE_INDEX.get(bare);

  const tokens = bare.split(/[\s,]+/).filter(Boolean);
  for (const token of tokens) {
    const kind = PHRASE_INDEX.get(token);
    if (kind && kind !== 'subject') return kind;
  }
  if (SERIES_SUFFIX.test(raw)) return 'subject';
  for (const token of tokens) {
    if (PHRASE_INDEX.get(token) === 'subject') return 'subject';
  }
  return 'unsorted';
}

/* ------------------------------------------------------------------ */
/* 分块                                                                */
/* ------------------------------------------------------------------ */

let fallbackSeed = 0;
function defaultId(prefix) {
  fallbackSeed += 1;
  return `${prefix}_${Date.now().toString(36)}${fallbackSeed.toString(36)}`;
}

/**
 * 把一段纯文本转成按语义分类、按默认顺序排列的块。
 * @param {string} text
 * @param {(prefix: string) => string} [idFactory]
 */
export function buildSegments(text, idFactory = (prefix) => defaultId(prefix)) {
  const groups = new Map();
  for (const tag of parseTags(text)) {
    const kind = classifyTag(tag);
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind).push({ id: idFactory('tag'), text: tag, enabled: true });
  }
  const segments = [];
  for (const kind of KIND_ORDER) {
    const tags = groups.get(kind);
    if (!tags || !tags.length) continue;
    segments.push({ id: idFactory('seg'), kind, label: kindLabel(kind), tags });
  }
  return segments;
}

/** 一个块内启用的 tag 拼成的文本 */
export function segmentText(segment) {
  if (!segment || !Array.isArray(segment.tags)) return '';
  return segment.tags
    .filter((tag) => tag && tag.enabled !== false && typeof tag.text === 'string' && tag.text.trim())
    .map((tag) => tag.text.trim())
    .join(', ');
}

/** 按块顺序拼出完整正向 Prompt */
export function serializeSegments(segments) {
  if (!Array.isArray(segments)) return '';
  return segments
    .map((segment) => segmentText(segment))
    .filter(Boolean)
    .join(', ');
}

/** 统计启用的 tag 数 */
export function countTags(segments) {
  if (!Array.isArray(segments)) return 0;
  return segments.reduce(
    (sum, segment) =>
      sum + (segment.tags || []).filter((tag) => tag && tag.enabled !== false && tag.text.trim()).length,
    0,
  );
}

/** 校验并规范化外部传入的 segments（后端保存、导入时使用） */
export function normalizeSegments(input, idFactory = (prefix) => defaultId(prefix)) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const segment of input) {
    if (!segment || typeof segment !== 'object') continue;
    const kind = isSegmentKind(segment.kind) ? segment.kind : 'unsorted';
    const label =
      typeof segment.label === 'string' && segment.label.trim()
        ? segment.label.trim().slice(0, 40)
        : kindLabel(kind);
    const tags = [];
    const list = Array.isArray(segment.tags) ? segment.tags : [];
    for (const tag of list) {
      const text = typeof tag === 'string' ? tag : tag && typeof tag.text === 'string' ? tag.text : '';
      const trimmed = text.trim();
      if (!trimmed) continue;
      tags.push({
        id: tag && typeof tag.id === 'string' && tag.id ? tag.id : idFactory('tag'),
        text: trimmed.slice(0, 500),
        enabled: !(tag && tag.enabled === false),
      });
      if (tags.length >= 300) break;
    }
    // 空块也保留：编辑器里新建的块需要能存下来，序列化时它不产生任何文本
    out.push({
      id: typeof segment.id === 'string' && segment.id ? segment.id : idFactory('seg'),
      kind,
      label,
      tags,
    });
    if (out.length >= 24) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 语法高亮                                                            */
/* ------------------------------------------------------------------ */

/**
 * 把 Prompt 文本切成带类型的片段，供前端着色。
 * 类型：text | weight | weight-neg | lora | sep | paren
 * 只描述外观，不改变文本内容，拼接后与原文完全一致。
 */
export function tokenizePrompt(text) {
  const source = String(text || '');
  const tokens = [];
  let buffer = '';

  const flush = () => {
    if (buffer) {
      tokens.push({ type: 'text', text: buffer });
      buffer = '';
    }
  };

  let i = 0;
  while (i < source.length) {
    const char = source[i];

    if (char === ',' || char === '，' || char === '|') {
      flush();
      tokens.push({ type: 'sep', text: char });
      i += 1;
      continue;
    }

    if (char === '<' && /^<lora:/i.test(source.slice(i))) {
      const end = source.indexOf('>', i);
      if (end > i) {
        flush();
        tokens.push({ type: 'lora', text: source.slice(i, end + 1) });
        i = end + 1;
        continue;
      }
    }

    if (char === '{' || char === '[' || char === '(') {
      const close = char === '{' ? '}' : char === '[' ? ']' : ')';
      let depth = 0;
      let end = -1;
      for (let j = i; j < source.length; j += 1) {
        if (source[j] === char) depth += 1;
        else if (source[j] === close) {
          depth -= 1;
          if (depth === 0) {
            end = j;
            break;
          }
        }
      }
      if (end > i) {
        flush();
        tokens.push({
          type: char === '[' ? 'weight-neg' : char === '(' ? 'paren' : 'weight',
          text: source.slice(i, end + 1),
        });
        i = end + 1;
        continue;
      }
    }

    buffer += char;
    i += 1;
  }
  flush();
  return tokens;
}

/** 取分块里所有启用的原始 tag 文本（Tag 库入库用） */
export function segmentTagTexts(segments) {
  if (!Array.isArray(segments)) return [];
  const out = [];
  for (const segment of segments) {
    for (const tag of segment.tags || []) {
      if (tag && tag.enabled !== false && typeof tag.text === 'string' && tag.text.trim()) {
        out.push(tag.text.trim());
      }
    }
  }
  return out;
}
