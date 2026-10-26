/**
 * Tag 目录的写入与统计辅助。被 tags 模块与 prompts / images 模块共用。
 */
import { guessTagCategory, normalizeTagKey } from '../../../shared/tagCategories.js';
import { segmentTagTexts } from '../../../shared/prompt/doc.js';
import { lookupBuiltinTag } from '../../../shared/tagTranslations.js';
import { resolveAlias } from './aliases.js';

/** 确保这些 tag 在目录里存在（不改已有条目）。返回新增数量 */
export function ensureTagEntries(data, rawTags, options = {}) {
  if (!Array.isArray(data.tags)) data.tags = [];
  const known = new Set(data.tags.map((entry) => entry.tag));
  const now = new Date().toISOString();
  let added = 0;
  for (const raw of rawTags || []) {
    // 旧写法经别名归并到规范 tag，避免改名后又长出重复条目
    const key = resolveAlias(data, raw);
    if (!key || known.has(key)) continue;
    known.add(key);
    const builtin = options.autoTranslate ? lookupBuiltinTag(key) : null;
    data.tags.push({
      tag: key,
      category: builtin?.category || guessTagCategory(key),
      categorySource: 'guess',
      translation: builtin?.translation || '',
      translationSource: builtin ? 'dictionary' : 'none',
      reviewed: false,
      postCount: null,
      updatedAt: now,
    });
    added += 1;
  }
  return added;
}

/** 统计每个 tag 在 Prompt 分块里的出现次数 */
export function usageIndex(snap) {
  const map = new Map();
  for (const prompt of snap.prompts || []) {
    for (const text of segmentTagTexts(prompt.segments)) {
      const key = normalizeTagKey(text);
      if (!key) continue;
      const item = map.get(key) || { usage: 0, targets: new Set() };
      item.usage += 1;
      item.targets.add(prompt.target);
      map.set(key, item);
    }
  }
  return map;
}

export function withUsage(entry, usage) {
  const stat = usage.get(entry.tag);
  return {
    ...entry,
    usage: stat ? stat.usage : 0,
    targets: stat ? [...stat.targets] : [],
  };
}

/** 列出 Prompt 里出现但目录还没有的 tag（只读视图用） */
export function missingEntries(snap, usage) {
  const known = new Set((snap.tags || []).map((entry) => entry.tag));
  const out = [];
  for (const key of usage.keys()) {
    if (known.has(key)) continue;
    out.push({
      tag: key,
      category: guessTagCategory(key),
      categorySource: 'guess',
      translation: '',
      translationSource: 'none',
      reviewed: false,
      postCount: null,
      updatedAt: null,
    });
  }
  return out;
}
