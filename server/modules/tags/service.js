/**
 * Tag 库服务：目录合并、筛选、人工修正、词典/模型翻译、Danbooru 分类同步。
 *
 * 规则：
 * - 已人工修正（reviewed）的条目默认跳过所有自动处理；
 * - 已有翻译的条目默认不再翻译，除非显式 force；
 * - 自动流程只补空，不覆盖人工结果。
 */
import { ApiError } from '../../lib/errors.js';
import { nowIso } from '../../lib/ids.js';
import { cleanBool, cleanInt, cleanPaging, cleanString, cleanStringArray, isPlainObject } from '../../lib/validate.js';
import { guessTagCategory, isTagCategory, normalizeTagKey } from '../../../shared/tagCategories.js';
import { builtinTagCount, lookupBuiltinTag } from '../../../shared/tagTranslations.js';
import { segmentTagTexts } from '../../../shared/prompt/doc.js';
import { ensureTagEntries, missingEntries, usageIndex, withUsage } from './catalog.js';
import { fetchDanbooruTags } from './danbooru.js';
import { mergeDictionary, parseDictionaryJson } from './dictionaryImport.js';
import { resolveAlias } from './aliases.js';
import { captureTagState, recordHistory } from './history.js';
import { translateTagsWithGemini } from './gemini.js';
import { translateTagsWithLlm } from './llm.js';

const STATUSES = ['all', 'translated', 'pending', 'reviewed', 'unused'];
const SORTS = ['usage', 'tag', 'updated'];
const PROVIDERS = ['dictionary', 'llm', 'gemini'];

function requireKey(value) {
  const key = normalizeTagKey(value);
  if (!key) throw ApiError.validation('tag 无效');
  return key;
}

function summarize(items) {
  const byCategory = {};
  let translated = 0;
  let reviewed = 0;
  for (const item of items) {
    if (item.translation) translated += 1;
    if (item.reviewed) reviewed += 1;
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;
  }
  return {
    total: items.length,
    translated,
    pending: items.length - translated,
    reviewed,
    byCategory,
    builtin: builtinTagCount(),
  };
}

export function list(db, query = {}) {
  const snap = db.snapshot();
  const usage = usageIndex(snap);
  const all = [...(snap.tags || []), ...missingEntries(snap, usage)].map((entry) => withUsage(entry, usage));

  const stats = summarize(all);
  const keyword = typeof query.q === 'string' ? query.q.trim().toLowerCase() : '';
  const categoryIds = new Set((snap.tagCategories || []).map((item) => item.id));
  const category = categoryIds.has(query.category) ? query.category : null;
  const status = STATUSES.includes(query.status) ? query.status : 'all';
  const sort = SORTS.includes(query.sort) ? query.sort : 'usage';
  const source = ['none', 'dictionary', 'llm', 'gemini', 'manual'].includes(query.source) ? query.source : null;

  let items = all;
  if (keyword) {
    items = items.filter(
      (item) => item.tag.includes(keyword) || item.translation.toLowerCase().includes(keyword),
    );
  }
  if (category) items = items.filter((item) => item.category === category);
  if (status === 'translated') items = items.filter((item) => Boolean(item.translation));
  if (status === 'pending') items = items.filter((item) => !item.translation);
  if (status === 'reviewed') items = items.filter((item) => item.reviewed);
  if (source) items = items.filter((item) => item.translationSource === source);
  if (status === 'unused') items = items.filter((item) => !item.usage);

  const sorted = items.slice().sort((a, b) => {
    if (sort === 'tag') return a.tag.localeCompare(b.tag, 'en');
    if (sort === 'updated') return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    const diff = (b.usage || 0) - (a.usage || 0);
    return diff !== 0 ? diff : a.tag.localeCompare(b.tag, 'en');
  });

  const { limit, offset } = cleanPaging(query, { defaultLimit: 100, maxLimit: 500 });
  return { items: sorted.slice(offset, offset + limit), total: sorted.length, stats };
}

/** 图片详情用：一次查一批 tag 的分类与翻译 */
export function lookup(db, rawTags = []) {
  const snap = db.snapshot();
  const map = new Map((snap.tags || []).map((entry) => [entry.tag, entry]));
  const items = [];
  const seen = new Set();
  for (const raw of Array.isArray(rawTags) ? rawTags : []) {
    const key = resolveAlias(snap, raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const entry = map.get(key);
    items.push({
      tag: key,
      category: entry?.category || guessTagCategory(key),
      translation: entry?.translation || '',
      reviewed: entry?.reviewed === true,
      known: Boolean(entry),
    });
  }
  return { items };
}

export async function update(db, body = {}) {
  if (!isPlainObject(body)) throw ApiError.validation('请求体必须是对象');
  const requested = requireKey(body.tag);

  return db.mutate((data) => {
    const key = resolveAlias(data, requested);
    let entry = data.tags.find((item) => item.tag === key);
    if (!entry) {
      ensureTagEntries(data, [key]);
      entry = data.tags.find((item) => item.tag === key);
    }

    let touched = false;
    if ('translation' in body) {
      entry.translation = cleanString(body.translation, { field: '翻译', max: 200 }) ?? '';
      entry.translationSource = entry.translation ? 'manual' : 'none';
      touched = true;
    }
    if ('category' in body) {
      if (!(data.tagCategories || []).some((item) => item.id === body.category)) {
        throw ApiError.validation('分类无效');
      }
      entry.category = body.category;
      entry.categorySource = 'manual';
      touched = true;
    }
    if ('reviewed' in body) {
      entry.reviewed = cleanBool(body.reviewed, entry.reviewed);
    } else if (touched) {
      // 人工改过翻译或分类，默认视为已修正，后续自动流程跳过
      entry.reviewed = true;
    }
    entry.updatedAt = nowIso();
    return withUsage(entry, usageIndex(data));
  });
}

/**
 * 批量修改：一次事务里改多条，避免前端逐条 PATCH。
 * 语义与单条 update 一致：改翻译 / 分类会标记 reviewed。
 */
export async function batchUpdate(ctx, body = {}) {
  if (!isPlainObject(body)) throw ApiError.validation('请求体必须是对象');
  const tags = cleanStringArray(body.tags, { maxItems: 2000, maxLen: 200 })
    .map(normalizeTagKey)
    .filter(Boolean);
  if (!tags.length) throw ApiError.validation('tags 不能为空');
  const patch = isPlainObject(body.patch) ? body.patch : {};
  const touchedFields = ['translation', 'category', 'reviewed'].filter((key) => key in patch);
  if (!touchedFields.length) throw ApiError.validation('patch 里没有可更新的字段');
  if ('category' in patch) {
    const known = new Set((ctx.db.snapshot().tagCategories || []).map((item) => item.id));
    if (!known.has(patch.category)) throw ApiError.validation('分类无效');
  }
  const translation =
    'translation' in patch ? cleanString(patch.translation, { field: '翻译', max: 200 }) ?? '' : undefined;
  const reviewed = 'reviewed' in patch ? cleanBool(patch.reviewed, false) : undefined;

  return ctx.db.mutate((data) => {
    const before = captureTagState(data);
    const now = nowIso();
    let updated = 0;
    let skipped = 0;
    for (const key of tags) {
      const entry = data.tags.find((item) => item.tag === key);
      if (!entry) {
        skipped += 1;
        continue;
      }
      let touched = false;
      if (translation !== undefined) {
        entry.translation = translation;
        entry.translationSource = translation ? 'manual' : 'none';
        touched = true;
      }
      if ('category' in patch) {
        entry.category = patch.category;
        entry.categorySource = 'manual';
        touched = true;
      }
      if (reviewed !== undefined) entry.reviewed = reviewed;
      else if (touched) entry.reviewed = true;
      entry.updatedAt = now;
      updated += 1;
    }
    if (updated) {
      const parts = [];
      if (translation !== undefined) parts.push(translation ? '修改译文' : '清空译文');
      if ('category' in patch) parts.push('修改分类');
      if (reviewed !== undefined) parts.push(reviewed ? '锁定' : '取消锁定');
      recordHistory(data, `批量${parts.join(' / ')}（${updated} 条）`, before, null);
    }
    return { ok: true, updated, skipped };
  });
}

/** 别名列表（按 alias 排序） */
export function listAliases(db) {
  return (db.snapshot().tagAliases || [])
    .slice()
    .sort((a, b) => String(a.alias).localeCompare(String(b.alias), 'en'));
}

/** 删除一条别名：之后旧写法可以重新独立存在 */
export async function deleteAlias(ctx, body = {}) {
  if (!isPlainObject(body)) throw ApiError.validation('请求体必须是对象');
  const key = normalizeTagKey(body.alias);
  if (!key) throw ApiError.validation('alias 不能为空');
  return ctx.db.mutate((data) => {
    const before = captureTagState(data);
    const exists = (data.tagAliases || []).some((entry) => entry.alias === key);
    if (!exists) throw ApiError.notFound('别名不存在');
    data.tagAliases = (data.tagAliases || []).filter((entry) => entry.alias !== key);
    recordHistory(data, `删除别名 ${key}`, before, null);
    return { ok: true };
  });
}

/**
 * 批量翻译。默认只处理"没有翻译且未修正"的条目。
 */
export async function translate(ctx, body = {}) {
  if (!isPlainObject(body)) throw ApiError.validation('请求体必须是对象');
  const snap = ctx.db.snapshot();
  const settings = snap.settings.translation || {};
  const provider = PROVIDERS.includes(body.provider) ? body.provider : settings.provider || 'dictionary';
  const force = body.force === true;
  const requested = Array.isArray(body.tags) ? body.tags.map(normalizeTagKey).filter(Boolean) : null;

  const candidates = (snap.tags || []).filter((entry) => {
    if (requested && !requested.includes(entry.tag)) return false;
    if (force) return true;
    return !entry.reviewed && !entry.translation;
  });

  if (!candidates.length) {
    return { provider, updated: 0, skipped: 0, failed: 0, message: '没有需要处理的 tag' };
  }

  let results = new Map();
  if (provider === 'dictionary') {
    for (const entry of candidates) {
      const hit = lookupBuiltinTag(entry.tag);
      if (hit) results.set(entry.tag, hit);
    }
  } else {
    try {
      results =
        provider === 'gemini'
          ? await translateTagsWithGemini(settings, candidates.map((entry) => entry.tag))
          : await translateTagsWithLlm(settings, candidates.map((entry) => entry.tag));
    } catch (error) {
      // 模型接口的失败（未配置 Key、HTTP 错误、返回非 JSON）直接回给前端
      throw ApiError.upstream(error instanceof Error ? error.message : '模型翻译失败');
    }
  }

  return ctx.db.mutate((data) => {
    let updated = 0;
    for (const [key, hit] of results) {
      const entry = data.tags.find((item) => item.tag === key);
      if (!entry) continue;
      if (entry.reviewed && !force) continue;
      entry.translation = hit.translation;
      entry.translationSource = provider;
      if (hit.category && entry.categorySource !== 'manual') {
        entry.category = hit.category;
        entry.categorySource = provider === 'llm' || provider === 'gemini' ? 'llm' : entry.categorySource;
      }
      entry.updatedAt = nowIso();
      updated += 1;
    }
    return {
      provider,
      updated,
      skipped: candidates.length - updated,
      failed: candidates.length - results.size,
    };
  });
}

/**
 * 从 Danbooru 同步分类与热度。只改分类，不动翻译。
 */
export async function sync(ctx, body = {}) {
  if (!isPlainObject(body)) throw ApiError.validation('请求体必须是对象');
  const snap = ctx.db.snapshot();
  if (snap.settings?.translation?.danbooruEnabled === false) {
    throw ApiError.validation('已在设置中关闭 Danbooru 查询');
  }
  const force = body.force === true;
  const requested = Array.isArray(body.tags) ? body.tags.map(normalizeTagKey).filter(Boolean) : null;

  const candidates = (snap.tags || []).filter((entry) => {
    if (requested && !requested.includes(entry.tag)) return false;
    return force || !entry.reviewed;
  });
  if (!candidates.length) {
    return { provider: 'danbooru', updated: 0, skipped: 0, failed: 0, message: '没有需要同步的 tag' };
  }

  const found = await fetchDanbooruTags(candidates.map((entry) => entry.tag));

  return ctx.db.mutate((data) => {
    let updated = 0;
    for (const [key, hit] of found) {
      const entry = data.tags.find((item) => item.tag === key);
      if (!entry) continue;
      if (entry.reviewed && !force) continue;
      let changed = false;
      if (hit.category && entry.categorySource !== 'manual') {
        entry.category = hit.category;
        entry.categorySource = 'danbooru';
        changed = true;
      }
      if (hit.postCount !== null && entry.postCount !== hit.postCount) {
        entry.postCount = hit.postCount;
        changed = true;
      }
      if (changed) {
        entry.updatedAt = nowIso();
        updated += 1;
      }
    }
    return {
      provider: 'danbooru',
      updated,
      skipped: candidates.length - found.size,
      failed: 0,
      notFound: candidates.length - found.size,
    };
  });
}

/** 把当前所有 Prompt 分块里的 tag 补进目录（幂等） */
export async function syncCatalog(db) {
  return db.mutate((data) => {
    const texts = [];
    for (const prompt of data.prompts) texts.push(...segmentTagTexts(prompt.segments));
    const added = ensureTagEntries(data, texts);
    return { added, total: data.tags.length };
  });
}

/**
 * 导入外部词典（JSON）：通用映射、本项目导出包、NAI Launcher、DSO 均可。
 * 只补空、默认只更新已存在的 tag；sqlite（ffdkj）走命令行脚本。
 */
export async function importDictionary(ctx, body = {}) {
  if (!isPlainObject(body)) throw ApiError.validation('请求体必须是对象');
  if (typeof body.text !== 'string' || !body.text.trim()) throw ApiError.validation('词典内容为空');
  let parsed;
  try {
    parsed = parseDictionaryJson(body.text);
  } catch (error) {
    throw ApiError.validation(error instanceof Error ? error.message : '词典格式无法识别');
  }
  if (!parsed.entries.length) throw ApiError.validation('词典里没有可导入的条目');
  const result = await mergeDictionary(ctx.db, parsed.entries, { overwrite: body.overwrite === true });
  return { ...result, format: parsed.format };
}

export function exportPack(db) {
  const snap = db.snapshot();
  return {
    version: 1,
    exportedAt: nowIso(),
    app: 'prompt-atelier-tags',
    tags: snap.tags.map((entry) => ({ ...entry })),
  };
}

export async function importPack(db, body = {}) {
  const entries = Array.isArray(body) ? body : Array.isArray(body?.tags) ? body.tags : [];
  if (!entries.length) throw ApiError.validation('没有可导入的 tag');
  return db.mutate((data) => {
    let imported = 0;
    for (const raw of entries) {
      const key = normalizeTagKey(raw?.tag);
      if (!key) continue;
      const existing = data.tags.find((item) => item.tag === key);
      const translation = cleanString(raw?.translation, { field: '翻译', max: 200 }) ?? '';
      const category = isTagCategory(raw?.category) ? raw.category : null;
      if (existing) {
        if (translation) {
          existing.translation = translation;
          existing.translationSource = 'manual';
          existing.reviewed = true;
        }
        if (category) {
          existing.category = category;
          existing.categorySource = 'manual';
          existing.reviewed = true;
        }
        existing.updatedAt = nowIso();
      } else {
        data.tags.push({
          tag: key,
          category: category || guessTagCategory(key),
          categorySource: category ? 'manual' : 'guess',
          translation,
          translationSource: translation ? 'manual' : 'none',
          reviewed: Boolean(translation || category),
          postCount: cleanInt(raw?.postCount, { min: 0, max: 1e12, fallback: null }),
          updatedAt: nowIso(),
        });
      }
      imported += 1;
    }
    return { imported, total: data.tags.length };
  });
}

/** 兼容旧调用：返回目录里的 tag 名 */
export function tagNames(db) {
  return (db.snapshot().tags || []).map((entry) => entry.tag).sort((a, b) => a.localeCompare(b, 'en'));
}
