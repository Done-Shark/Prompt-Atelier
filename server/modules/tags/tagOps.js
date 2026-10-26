/**
 * Tag 改名 / 合并 / 查找替换。
 *
 * 约束：
 * - Prompt 的 positive 是事实来源，改名只做「按 tag 精确替换」，不重新序列化分块，
 *   因此不会打乱用户手写的 tag 顺序；
 * - 同一次操作里同步 segments、prompt.tags、图片 tags、图片元数据里的正负向；
 * - 旧写法写入 tagAliases，后续再出现时自动归并到新写法。
 */
import { ApiError } from '../../lib/errors.js';
import { nowIso } from '../../lib/ids.js';
import { cleanString, isPlainObject } from '../../lib/validate.js';
import { guessTagCategory, normalizeTagKey } from '../../../shared/tagCategories.js';
import { resolveAlias } from './aliases.js';
import { captureTagState, recordHistory } from './history.js';
import { list as listTags } from './service.js';

const SEPARATORS = new Set([',', '，', '\n', ';']);

/** 按顶层分隔符切分，保留原分隔符与空白 */
export function splitTopLevel(text) {
  const pieces = [];
  let buffer = '';
  let round = 0;
  let square = 0;
  let curly = 0;
  let angle = 0;
  for (const char of String(text ?? '')) {
    if (char === '(') round += 1;
    else if (char === ')') round = Math.max(0, round - 1);
    else if (char === '[') square += 1;
    else if (char === ']') square = Math.max(0, square - 1);
    else if (char === '{') curly += 1;
    else if (char === '}') curly = Math.max(0, curly - 1);
    else if (char === '<') angle += 1;
    else if (char === '>') angle = Math.max(0, angle - 1);

    const atTop = round === 0 && square === 0 && curly === 0 && angle === 0;
    if (SEPARATORS.has(char) && atTop) {
      pieces.push({ raw: buffer, sep: char });
      buffer = '';
      continue;
    }
    buffer += char;
  }
  pieces.push({ raw: buffer, sep: '' });
  return pieces;
}

/**
 * 拆出权重语法：`((long_hair))`、`(long_hair:1.2)`、`{tag}`、`[tag]`。
 * lead/tail 保留原空格，替换时只动 core。
 */
export function splitTag(raw) {
  const text = String(raw ?? '');
  const lead = text.match(/^\s*/)[0];
  const tail = text.match(/\s*$/)[0];
  let body = text.trim();
  if (!body) return null;
  let prefix = '';
  while (body && '([{'.includes(body[0])) {
    prefix += body[0];
    body = body.slice(1);
  }
  let close = '';
  while (body && ')]}'.includes(body[body.length - 1])) {
    close = body[body.length - 1] + close;
    body = body.slice(0, -1);
  }
  let weight = '';
  const match = body.match(/^(.*?)(:\s*-?\d+(?:\.\d+)?)$/);
  if (match) {
    body = match[1];
    weight = match[2];
  }
  return { lead, prefix, core: body, weight, close, tail };
}

function joinTag(parts, core) {
  return `${parts.lead}${parts.prefix}${core}${parts.weight}${parts.close}${parts.tail}`;
}

/** 把文本里等于 fromKey 的 tag 换成 toText，返回替换次数 */
export function replaceTagInText(text, fromKey, toText) {
  if (typeof text !== 'string' || !text) return { text, count: 0 };
  let count = 0;
  const next = splitTopLevel(text)
    .map(({ raw, sep }) => {
      const parts = splitTag(raw);
      if (!parts || normalizeTagKey(parts.core) !== fromKey) return `${raw}${sep}`;
      count += 1;
      return `${joinTag(parts, toText)}${sep}`;
    })
    .join('');
  return { text: next, count };
}

function mergeTagEntries(fromEntry, toEntry, now) {
  const candidates = [toEntry, fromEntry];
  const manualTranslation = candidates.find((entry) => entry.translation && entry.translationSource === 'manual');
  const anyTranslation = candidates.find((entry) => entry.translation);
  const translation = manualTranslation?.translation || anyTranslation?.translation || '';
  const translationSource = manualTranslation
    ? 'manual'
    : anyTranslation
      ? anyTranslation.translationSource
      : 'none';

  const manualCategory = candidates.find((entry) => entry.categorySource === 'manual');
  const categoryEntry = manualCategory || toEntry || fromEntry;
  const reviewed = Boolean(toEntry.reviewed || fromEntry.reviewed);

  toEntry.translation = translation;
  toEntry.translationSource = translationSource;
  toEntry.category = categoryEntry.category || 'unsorted';
  toEntry.categorySource = manualCategory ? 'manual' : categoryEntry.categorySource || 'guess';
  toEntry.reviewed = reviewed;
  toEntry.postCount = Math.max(toEntry.postCount || 0, fromEntry.postCount || 0) || null;
  toEntry.updatedAt = now;
  return { translation, translationSource, category: toEntry.category, categorySource: toEntry.categorySource };
}

/**
 * 在数据草稿上执行改名 / 合并（同步，纯数据操作）。
 * @returns 影响面摘要
 */
export function applyRename(data, fromRaw, toRaw, tracker = null) {
  const fromKey = normalizeTagKey(fromRaw);
  const toKey = normalizeTagKey(toRaw);
  const from = resolveAlias(data, fromKey);
  let to = resolveAlias(data, toKey);
  if (!from || !to) throw ApiError.validation('tag 无效');
  if (from === to && fromKey === toKey) throw ApiError.validation('源 tag 与目标 tag 相同');

  // 目标恰好是源的旧写法：视为「改回去」，撤销这条别名而不是报错
  let undoAlias = false;
  if (to === from && toKey !== fromKey) {
    if (!(data.tagAliases || []).some((entry) => entry.alias === toKey && entry.canonical === from)) {
      throw ApiError.validation('目标 tag 与源 tag 相同');
    }
    data.tagAliases = (data.tagAliases || []).filter(
      (entry) => !(entry.alias === toKey && entry.canonical === from),
    );
    to = toKey;
    undoAlias = true;
  }
  if (from === to) throw ApiError.validation('源 tag 与目标 tag 相同');

  const now = nowIso();
  let prompts = 0;
  let images = 0;
  let segments = 0;
  let positive = 0;
  let negative = 0;

  for (const prompt of data.prompts || []) {
    const beforePrompt = tracker ? structuredClone(prompt) : null;
    let touched = false;
    if (typeof prompt.positive === 'string') {
      const result = replaceTagInText(prompt.positive, from, to);
      if (result.count) {
        prompt.positive = result.text;
        positive += result.count;
        touched = true;
      }
    }
    if (typeof prompt.negative === 'string') {
      const result = replaceTagInText(prompt.negative, from, to);
      if (result.count) {
        prompt.negative = result.text;
        negative += result.count;
        touched = true;
      }
    }
    if (Array.isArray(prompt.segments)) {
      for (const segment of prompt.segments) {
        for (const tag of segment.tags || []) {
          const parts = splitTag(tag.text);
          if (!parts || normalizeTagKey(parts.core) !== from) continue;
          tag.text = joinTag(parts, to);
          segments += 1;
          touched = true;
        }
      }
    }
    if (Array.isArray(prompt.tags)) {
      const next = prompt.tags.map((tag) => (normalizeTagKey(tag) === from ? to : tag));
      if (next.some((tag, index) => tag !== prompt.tags[index])) {
        prompt.tags = next;
        touched = true;
      }
    }
    if (touched) {
      prompt.updatedAt = now;
      prompts += 1;
      tracker?.prompts.set(prompt.id, { key: prompt.id, before: beforePrompt, after: structuredClone(prompt) });
    }
  }

  for (const image of data.images || []) {
    const beforeImage = tracker ? structuredClone(image) : null;
    let touched = false;
    if (Array.isArray(image.tags)) {
      const next = image.tags.map((tag) => (normalizeTagKey(tag) === from ? to : tag));
      if (next.some((tag, index) => tag !== image.tags[index])) {
        image.tags = next;
        touched = true;
      }
    }
    const metadata = image.metadata;
    if (metadata && typeof metadata === 'object') {
      for (const field of ['positive', 'negative']) {
        if (typeof metadata[field] !== 'string') continue;
        const result = replaceTagInText(metadata[field], from, to);
        if (result.count) {
          metadata[field] = result.text;
          touched = true;
        }
      }
    }
    if (touched) {
      images += 1;
      tracker?.images.set(image.id, { key: image.id, before: beforeImage, after: structuredClone(image) });
    }
  }

  const fromEntry = (data.tags || []).find((entry) => entry.tag === from) || null;
  const toEntry = (data.tags || []).find((entry) => entry.tag === to) || null;
  let tagAction = 'alias-only';
  let merged = null;
  if (fromEntry && toEntry) {
    merged = mergeTagEntries(fromEntry, toEntry, now);
    data.tags = data.tags.filter((entry) => entry.tag !== from);
    tagAction = 'merged';
  } else if (fromEntry) {
    fromEntry.tag = to;
    fromEntry.updatedAt = now;
    tagAction = 'renamed';
  }

  const aliases = (data.tagAliases || []).filter((entry) => entry.alias !== from && entry.alias !== to);
  for (const entry of aliases) {
    if (entry.canonical === from) entry.canonical = to;
  }
  aliases.push({ alias: from, canonical: to, createdAt: now });
  data.tagAliases = aliases;

  return {
    from,
    to,
    undoAlias,
    prompts,
    images,
    segments,
    positive,
    negative,
    tagAction,
    translation: merged?.translation ?? toEntry?.translation ?? fromEntry?.translation ?? '',
    category: merged?.category ?? toEntry?.category ?? fromEntry?.category ?? null,
  };
}

function normalizeInput(value, field) {
  const text = cleanString(value, { field, max: 200, allowEmpty: false });
  if (!text) throw ApiError.validation(`${field} 不能为空`);
  return text;
}

/** POST /api/tags/rename */
export async function rename(ctx, body = {}) {
  if (!isPlainObject(body)) throw ApiError.validation('请求体必须是对象');
  const from = normalizeInput(body.from, 'from');
  const to = normalizeInput(body.to, 'to');
  const dryRun = body.dryRun === true;

  if (dryRun) {
    const draft = structuredClone(ctx.db.snapshot());
    return { dryRun: true, ...applyRename(draft, from, to) };
  }
  return ctx.db.mutate((data) => {
    const before = captureTagState(data);
    const tracker = { prompts: new Map(), images: new Map() };
    const result = applyRename(data, from, to, tracker);
    recordHistory(data, `重命名 ${result.from} → ${result.to}`, before, tracker);
    return result;
  });
}

function buildMatcher(pattern, regex, caseSensitive) {
  if (regex) {
    const flags = caseSensitive ? '' : 'i';
    try {
      return new RegExp(pattern, flags);
    } catch (error) {
      throw ApiError.validation(`正则无效：${error.message}`);
    }
  }
  return null;
}

/** POST /api/tags/find-replace：对当前筛选结果里的 tag 批量改名 */
export async function findReplace(ctx, body = {}) {
  if (!isPlainObject(body)) throw ApiError.validation('请求体必须是对象');
  const pattern = cleanString(body.pattern, { field: 'pattern', max: 200, allowEmpty: false });
  if (!pattern) throw ApiError.validation('查找内容不能为空');
  const replacement = typeof body.replacement === 'string' ? body.replacement : '';
  const regex = body.regex === true;
  const caseSensitive = body.caseSensitive === true;
  const dryRun = body.dryRun === true;
  const scope = isPlainObject(body.scope) ? body.scope : {};
  const matcher = buildMatcher(pattern, regex, caseSensitive);

  const candidates = listTags(ctx.db, scope).items;
  const matches = [];
  const skipped = [];
  const seen = new Set();

  for (const item of candidates) {
    const key = item.tag;
    if (seen.has(key)) continue;
    seen.add(key);
    let next;
    if (regex) {
      if (!matcher.test(key)) continue;
      next = key.replace(matcher, replacement);
    } else {
      if (caseSensitive ? !key.includes(pattern) : !key.toLowerCase().includes(pattern.toLowerCase())) continue;
      next = caseSensitive
        ? key.split(pattern).join(replacement)
        : key.replace(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replacement);
    }
    const normalized = normalizeTagKey(next);
    if (!normalized || normalized === key) {
      skipped.push({ from: key, to: next });
      continue;
    }
    matches.push({ from: key, to: normalized, usage: item.usage || 0 });
  }

  if (dryRun) {
    const limit = 200;
    return {
      dryRun: true,
      total: matches.length,
      truncated: matches.length > limit,
      matches: matches.slice(0, limit),
      skipped: skipped.slice(0, 50),
    };
  }

  return ctx.db.mutate((data) => {
    const before = captureTagState(data);
    const tracker = { prompts: new Map(), images: new Map() };
    let prompts = 0;
    let images = 0;
    let renamed = 0;
    for (const match of matches) {
      try {
        const diff = applyRename(data, match.from, match.to, tracker);
        renamed += 1;
        prompts += diff.prompts;
        images += diff.images;
      } catch {
        // 单条失败（例如目标已存在且同名）不影响其余
      }
    }
    if (renamed) {
      recordHistory(data, `查找替换 ${pattern} → ${replacement || '（空）'}`, before, tracker);
    }
    return { renamed, prompts, images, total: matches.length, skipped: skipped.length };
  });
}
