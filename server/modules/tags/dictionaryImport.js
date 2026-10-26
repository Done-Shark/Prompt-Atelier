/**
 * 外部词典导入：ffdkj 的 tag.sqlite，以及常见 JSON 形态（通用映射、本项目的导出包、
 * Aaalice_NAI_Launcher 的 zh_translations、NovelAIPromptStudio 的 dso-dictionary）。
 *
 * 合并策略（与 Tag 库的既有规则一致）：
 * - 只补空：已有翻译不覆盖，`reviewed` 的条目默认跳过（除非 overwrite）；
 * - 分类只在原分类为空 / 未分类 / 来源为规则推断时才更新，人工分类永远保留；
 * - 默认只处理 Tag 库里已存在的条目（避免把 30 万条词典塞进库里），`all: true` 才新增。
 */
import { guessTagCategory, isTagCategory, normalizeTagKey } from '../../../shared/tagCategories.js';
import { nowIso } from '../../lib/ids.js';

/** Danbooru 分类编号 → 本项目的 Tag 分类 */
const DANBOORU_CATEGORY = { 1: 'artist', 3: 'copyright', 4: 'character', 5: 'meta' };

/** DSO / NPS 的分类名 → 本项目的 Tag 分类 */
const DSO_CATEGORY = {
  artistera: 'artist',
  subject: 'character',
  identity: 'character',
  body: 'appearance',
  clothing: 'clothing',
  action: 'pose',
  environment: 'scene',
  composition: 'composition',
  stylequality: 'style',
  unsorted: null,
};

/** 把来源里的分类归一化为本项目分类；无法识别返回 null */
export function normalizeCategory(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return DANBOORU_CATEGORY[value] ?? null;
  const text = String(value).trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  // 先看来源自己的分类名（DSO 的 Unsorted 表示"无分类"，不能落成 unsorted）
  if (lower in DSO_CATEGORY) return DSO_CATEGORY[lower];
  if (isTagCategory(lower)) return lower;
  return null;
}

function cleanTranslation(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * 解析 JSON 词典文本，自动识别几种常见结构。
 * @returns {{format: string, entries: {tag: string, translation: string, category: string|null}[]}}
 */
export function parseDictionaryJson(text) {
  const data = JSON.parse(text);
  const entries = [];
  const push = (rawTag, rawTranslation, rawCategory) => {
    const tag = normalizeTagKey(rawTag);
    const translation = cleanTranslation(rawTranslation);
    if (!tag || !translation) return;
    entries.push({ tag, translation, category: normalizeCategory(rawCategory) });
  };

  if (Array.isArray(data)) {
    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      push(item.tag ?? item.name, item.translation ?? item.zh ?? item.zhCn ?? item.cn_name, item.category);
    }
    return { format: 'array', entries };
  }

  if (data && Array.isArray(data.tags)) {
    for (const item of data.tags) {
      if (!item || typeof item !== 'object') continue;
      push(item.tag, item.translation, item.category);
    }
    return { format: 'pack', entries };
  }

  if (data && Array.isArray(data.entries)) {
    for (const item of data.entries) {
      if (!item || typeof item !== 'object') continue;
      push(item.tag, item.zhCn ?? item.translation ?? item.zh, item.category);
    }
    return { format: 'entries', entries };
  }

  if (data && data.entries && typeof data.entries === 'object') {
    const categories = Array.isArray(data.categories) ? data.categories : [];
    for (const [tag, value] of Object.entries(data.entries)) {
      if (Array.isArray(value)) push(tag, value[0], typeof value[1] === 'number' ? categories[value[1]] : value[1]);
      else if (typeof value === 'string') push(tag, value, null);
      else if (value && typeof value === 'object') push(tag, value.translation ?? value.zh, value.category);
    }
    return { format: 'dso', entries };
  }

  if (data && typeof data === 'object') {
    for (const [tag, value] of Object.entries(data)) {
      if (typeof value === 'string') push(tag, value, null);
      else if (Array.isArray(value)) push(tag, value[0], value[1]);
      else if (value && typeof value === 'object') push(tag, value.translation ?? value.zh, value.category);
    }
    return { format: 'map', entries };
  }

  throw new Error('无法识别的词典格式');
}

/** ffdkj tag.sqlite 的行 → 词条 */
export function entriesFromFfdkjRows(rows) {
  const out = [];
  for (const row of rows) {
    const tag = normalizeTagKey(row?.name);
    const translation = cleanTranslation(row?.cn_name);
    if (!tag || !translation) continue;
    out.push({ tag, translation, category: normalizeCategory(row?.category) });
  }
  return out;
}

/**
 * 读取 ffdkj 的 tag.sqlite（表 tags：name / category / cn_name / post_count）。
 * 用 node:sqlite 只读打开，不复制、不修改源文件。
 */
export async function readFfdkjSqlite(file) {
  const { DatabaseSync } = await import('node:sqlite');
  const source = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = source
      .prepare(
        "SELECT name, category, cn_name, post_count FROM tags WHERE cn_name IS NOT NULL AND TRIM(cn_name) <> ''",
      )
      .all();
    return entriesFromFfdkjRows(rows);
  } finally {
    source.close();
  }
}

/**
 * 合并词条到 Tag 库。
 * @param {any} db
 * @param {{tag: string, translation: string, category: string|null}[]} entries
 * @param {{overwrite?: boolean, all?: boolean}} options
 */
export async function mergeDictionary(db, entries, options = {}) {
  const overwrite = options.overwrite === true;
  const all = options.all === true;
  return db.mutate((data) => {
    const byTag = new Map((data.tags || []).map((entry) => [entry.tag, entry]));
    const now = nowIso();
    let updated = 0;
    let added = 0;
    let skipped = 0;
    let missing = 0;

    for (const entry of entries) {
      const key = normalizeTagKey(entry.tag);
      const translation = cleanTranslation(entry.translation);
      if (!key || !translation) {
        skipped += 1;
        continue;
      }
      let target = byTag.get(key);
      if (!target) {
        if (!all) {
          missing += 1;
          continue;
        }
        target = {
          tag: key,
          category: entry.category || guessTagCategory(key) || 'unsorted',
          categorySource: entry.category ? 'danbooru' : 'guess',
          translation: '',
          translationSource: 'none',
          reviewed: false,
          postCount: null,
          updatedAt: now,
        };
        data.tags.push(target);
        byTag.set(key, target);
        added += 1;
      }

      if (target.reviewed && !overwrite) {
        skipped += 1;
        continue;
      }
      if (target.translation && !overwrite) {
        skipped += 1;
        continue;
      }

      target.translation = translation;
      target.translationSource = 'dictionary';
      if (entry.category && target.categorySource !== 'manual') {
        if (overwrite || !target.category || target.category === 'unsorted' || target.categorySource === 'guess') {
          target.category = entry.category;
          target.categorySource = 'danbooru';
        }
      }
      target.updatedAt = now;
      updated += 1;
    }

    return { total: entries.length, updated, added, skipped, missing };
  });
}
