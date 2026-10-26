/**
 * Prompt 字段的唯一来源：长度上限、来源枚举、简单字段清洗规则。
 * 后端 create / patch 与前端表单都从这里取，避免三处白名单各写一份。
 */

export const PROMPT_LIMITS = {
  title: 200,
  positive: 20000,
  negative: 20000,
  notes: 10000,
};

export const PROMPT_ORIGINS = ['manual', 'image', 'import'];

/**
 * 不需要额外上下文（data / adapter）就能清洗的字段。
 * - string：trim + 截断，缺失时用 fallback
 * - stringArray：去重、限长
 * - boolean：强制布尔
 * - enum：不在枚举内时回落 fallback
 */
export const PROMPT_SIMPLE_FIELDS = [
  { key: 'negative', type: 'string', max: PROMPT_LIMITS.negative, fallback: '' },
  { key: 'notes', type: 'string', max: PROMPT_LIMITS.notes, fallback: '' },
  { key: 'tags', type: 'stringArray', fallback: [] },
  { key: 'favorite', type: 'boolean', fallback: false },
  { key: 'origin', type: 'enum', values: PROMPT_ORIGINS, fallback: 'manual' },
];

/** 落库的 Prompt 字段全集（不含 id / 时间戳 / usage 等派生字段） */
export const PROMPT_FIELD_KEYS = [
  'title',
  'target',
  'positive',
  'negative',
  'segments',
  'tags',
  'folderId',
  'favorite',
  'notes',
  'params',
  'origin',
  'imageId',
  'exampleImageId',
];
