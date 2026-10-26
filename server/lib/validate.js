/**
 * 输入清洗：所有写操作都必须经过这里。
 * 约定：字段缺失返回 undefined / fallback，类型错误抛 VALIDATION。
 */
import { ApiError } from './errors.js';

/** 长度上限（见 ARCHITECTURE.md §7） */
import { PROMPT_LIMITS } from '../../shared/prompt/fields.js';

export const LIMITS = {
  title: PROMPT_LIMITS.title,
  positive: PROMPT_LIMITS.positive,
  negative: PROMPT_LIMITS.negative,
  notes: PROMPT_LIMITS.notes,
  tag: 64,
  tags: 50,
  folderName: 100,
  path: 1000,
  scanPaths: 50,
};

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 清洗字符串：trim + 长度上限。
 * lenient=true 用于参数规范化：类型不对或超长时静默回落/截断，而不是报错。
 * @returns {string|undefined} 缺失时返回 undefined（由调用方决定默认值）
 */
export function cleanString(value, options = {}) {
  const { field = '字段', max = 1000, allowEmpty = true, required = false, lenient = false } = options;
  if (value === undefined || value === null) {
    if (required) throw ApiError.validation(`${field}不能为空`);
    return undefined;
  }
  if (typeof value !== 'string') {
    if (lenient) return undefined;
    throw ApiError.validation(`${field}必须是字符串`);
  }
  const trimmed = value.trim();
  if (!allowEmpty && trimmed === '') {
    if (lenient) return undefined;
    throw ApiError.validation(`${field}不能为空`);
  }
  if (trimmed.length > max) {
    if (lenient) return trimmed.slice(0, max);
    throw ApiError.validation(`${field}长度不能超过 ${max}`);
  }
  return trimmed;
}

/** 数字：非有限值回落默认值，其余夹紧到区间 */
export function cleanNumber(value, options = {}) {
  const { min = -Infinity, max = Infinity, fallback = 0 } = options;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

export function cleanInt(value, options = {}) {
  return Math.round(cleanNumber(value, options));
}

/** 布尔：接受 true/false/1/0/"true"/"false"，其余回落 */
export function cleanBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return fallback;
}

export function cleanEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/** 标签数组：去空白、去空项、去重、限量 */
export function cleanStringArray(value, options = {}) {
  const { maxItems = LIMITS.tags, maxLen = LIMITS.tag } = options;
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const tag = item.trim();
    if (!tag || tag.length > maxLen) continue;
    if (!out.includes(tag)) out.push(tag);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** 可空字符串 id */
export function cleanNullableId(value, field = 'folderId') {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw ApiError.validation(`${field}必须是字符串或 null`);
  return value;
}

/** 分页参数 */
export function cleanPaging(query, { defaultLimit = 200, maxLimit = 500 } = {}) {
  const limit = cleanInt(query.limit, { min: 1, max: maxLimit, fallback: defaultLimit });
  const offset = cleanInt(query.offset, { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
  return { limit, offset };
}
