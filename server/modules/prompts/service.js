/**
 * Prompt 领域服务：CRUD、筛选排序分页、复制序列化、导入导出。
 * 所有写操作走 db.mutate，校验与规范化集中在 buildPrompt / applyPatch。
 */
import { buildSegments, normalizeSegments, segmentTagTexts, serializeSegments } from '../../../shared/prompt/doc.js';
import { PROMPT_LIMITS, PROMPT_SIMPLE_FIELDS } from '../../../shared/prompt/fields.js';
import { ensureTagEntries } from '../tags/catalog.js';
import { getAdapter, isTarget } from '../../formats/index.js';
import { ApiError } from '../../lib/errors.js';
import { newId, nowIso } from '../../lib/ids.js';
import { cleanBool, cleanPaging, isPlainObject, LIMITS, cleanString, cleanStringArray } from '../../lib/validate.js';

const SORTS = ['updated', 'created', 'title', 'usage'];

/** 分块序列化后的长度兜底：超长直接截断，不报错 */
function clipPositive(value) {
  return value.length > PROMPT_LIMITS.positive ? value.slice(0, PROMPT_LIMITS.positive) : value;
}

/** 按 PROMPT_SIMPLE_FIELDS 的规则清洗单个字段 */
function cleanSimpleField(field, value) {
  if (field.type === 'string') return cleanString(value, { field: field.key, max: field.max }) ?? field.fallback;
  if (field.type === 'stringArray') return cleanStringArray(value);
  if (field.type === 'boolean') return cleanBool(value, field.fallback);
  if (field.type === 'enum') return field.values.includes(value) ? value : field.fallback;
  return field.fallback;
}

function deriveTitle(title, positive) {
  const cleaned = typeof title === 'string' ? title.trim() : '';
  if (cleaned) return cleaned.slice(0, PROMPT_LIMITS.title);
  const snippet = String(positive || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
  return snippet || '未命名 Prompt';
}

/** folderId 指向不存在的文件夹时落回未归档，避免悬空引用 */
function resolveFolderId(data, folderId) {
  if (folderId === undefined) return undefined;
  if (folderId === null || folderId === '') return null;
  if (typeof folderId !== 'string') throw ApiError.validation('folderId 必须是字符串或 null');
  return data.folders.some((folder) => folder.id === folderId) ? folderId : null;
}

/** 示例图：必须是图片库里存在的图片；null 表示不设置 */
function resolveExampleImage(data, value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw ApiError.validation('exampleImageId 必须是字符串或 null');
  if (!data.images.some((image) => image.id === value)) throw ApiError.validation('示例图片不存在');
  return value;
}

function cleanImageId(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw ApiError.validation('imageId 必须是字符串或 null');
  return value;
}

/**
 * 由输入构建完整 Prompt（新增与导入共用）。
 *
 * positive 与 segments 的关系：
 * - 非空 segments：用户显式编辑过分块，positive 由它序列化生成（以分块为准）；
 * - 空 segments：明确表示"不要分块"，positive 原样保留；
 * - 没有 segments：positive 是事实来源，segments 只是自动生成的结构化视图。
 * 自动分块会按语义重排，因此不能在未编辑时反向覆盖 positive。
 *
 * @param {any} data db 草稿
 * @param {any} input PromptInput
 * @param {{ fallbackFolderId?: string|null, existing?: any }} [options]
 */
function buildPrompt(data, input, options = {}) {
  if (!isPlainObject(input)) throw ApiError.validation('条目必须是对象');

  const target = isTarget(input.target) ? input.target : null;
  if (!target) throw ApiError.validation('target 无效（只能是 nai 或 comfyui）');
  if (!('positive' in input) || typeof input.positive !== 'string') {
    throw ApiError.validation('positive 缺失或不是字符串');
  }

  const rawPositive = cleanString(input.positive, { field: 'positive', max: PROMPT_LIMITS.positive }) ?? '';
  const hasSegments = Object.prototype.hasOwnProperty.call(input, 'segments');
  const segments = hasSegments ? normalizeSegments(input.segments) : buildSegments(rawPositive);
  const segmentText = serializeSegments(segments);
  // 只有分块真的产出文本（或原文本身为空）时才以分块为准；全空块保留原文
  const useSegments = hasSegments && (segmentText.length > 0 || rawPositive.length === 0);
  const positive = useSegments ? clipPositive(segmentText) : rawPositive;
  const folderId =
    input.folderId === undefined
      ? options.fallbackFolderId !== undefined
        ? resolveFolderId(data, options.fallbackFolderId) ?? null
        : null
      : resolveFolderId(data, input.folderId);
  const imageId = cleanImageId(input.imageId) ?? null;
  const exampleImageId = resolveExampleImage(data, input.exampleImageId) ?? null;
  const simple = {};
  for (const field of PROMPT_SIMPLE_FIELDS) {
    simple[field.key] = field.key in input ? cleanSimpleField(field, input[field.key]) : field.fallback;
  }
  const adapter = getAdapter(target);
  const now = nowIso();
  // 分块里的 tag 同步进 Tag 库（已存在的条目不动）
  ensureTagEntries(data, segmentTagTexts(segments), {
    autoTranslate: data.settings?.translation?.autoTranslateOnImport === true,
  });

  return {
    id: newId('p'),
    title: deriveTitle(input.title, positive),
    target,
    positive,
    ...simple,
    segments,
    folderId,
    params: adapter.normalize(input.params),
    usageCount: 0,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
    imageId,
    exampleImageId,
  };
}

/** PATCH 语义：只覆盖出现的字段；target 变化时按新目标重新规范化参数 */
function applyPatch(data, current, patch) {
  if (!isPlainObject(patch)) throw ApiError.validation('请求体必须是对象');
  const next = structuredClone(current);

  if ('target' in patch) {
    if (!isTarget(patch.target)) throw ApiError.validation('target 无效（只能是 nai 或 comfyui）');
    next.target = patch.target;
  }

  if ('segments' in patch) {
    const nextSegments = normalizeSegments(patch.segments);
    const segmentText = serializeSegments(nextSegments);
    next.segments = nextSegments;
    if (segmentText.length > 0) {
      // 分块产出文本：以分块为准重算 positive
      next.positive = clipPositive(segmentText);
    }
    // 分块全空/全停用时保留原 positive，避免旧数据被清空
  } else if ('positive' in patch) {
    if (typeof patch.positive !== 'string') throw ApiError.validation('positive 必须是字符串');
    next.positive = cleanString(patch.positive, { field: 'positive', max: PROMPT_LIMITS.positive }) ?? '';
    next.segments = buildSegments(next.positive);
  } else if (!Array.isArray(next.segments)) {
    // 旧数据补一次分块，不改动 positive
    next.segments = buildSegments(next.positive);
  }
  for (const field of PROMPT_SIMPLE_FIELDS) {
    if (field.key in patch) next[field.key] = cleanSimpleField(field, patch[field.key]);
  }
  if ('folderId' in patch) {
    next.folderId = resolveFolderId(data, patch.folderId) ?? null;
  }
  if ('imageId' in patch) {
    next.imageId = cleanImageId(patch.imageId) ?? null;
  }
  if ('exampleImageId' in patch) {
    next.exampleImageId = resolveExampleImage(data, patch.exampleImageId) ?? null;
  }
  const adapter = getAdapter(next.target);
  if (next.target !== current.target) {
    // 换目标格式：旧参数键基本不再适用，用新格式默认值 + 本次提交的参数
    next.params = adapter.normalize(patch.params);
  } else if ('params' in patch) {
    next.params = adapter.normalize({ ...current.params, ...(isPlainObject(patch.params) ? patch.params : {}) });
  }

  if ('title' in patch) {
    next.title = deriveTitle(patch.title, next.positive);
  }

  ensureTagEntries(data, segmentTagTexts(next.segments), {
    autoTranslate: data.settings?.translation?.autoTranslateOnImport === true,
  });
  next.updatedAt = nowIso();
  return next;
}

function findIndex(data, id) {
  const index = data.prompts.findIndex((prompt) => prompt.id === id);
  if (index < 0) throw ApiError.notFound('Prompt 不存在');
  return index;
}

export function list(db, query = {}) {
  const snap = db.snapshot();
  const target = query.target;
  const folderFilter = query.folderId;
  const tag = typeof query.tag === 'string' ? query.tag.trim() : '';
  const favorite = query.favorite === '1' || query.favorite === 'true';
  const keyword = typeof query.q === 'string' ? query.q.trim().toLowerCase() : '';
  const sort = SORTS.includes(query.sort) ? query.sort : 'updated';
  const { limit, offset } = cleanPaging(query, { defaultLimit: 200, maxLimit: 500 });

  let items = snap.prompts;

  if (target === 'nai' || target === 'comfyui') {
    items = items.filter((prompt) => prompt.target === target);
  }
  if (folderFilter === 'root') {
    items = items.filter((prompt) => prompt.folderId === null);
  } else if (typeof folderFilter === 'string' && folderFilter) {
    items = items.filter((prompt) => prompt.folderId === folderFilter);
  }
  if (tag) {
    const needle = tag.toLowerCase();
    items = items.filter((prompt) => prompt.tags.some((item) => item.toLowerCase() === needle));
  }
  if (favorite) {
    items = items.filter((prompt) => prompt.favorite === true);
  }
  if (keyword) {
    items = items.filter((prompt) => {
      if (prompt.title.toLowerCase().includes(keyword)) return true;
      if (prompt.positive.toLowerCase().includes(keyword)) return true;
      if (prompt.negative.toLowerCase().includes(keyword)) return true;
      return prompt.tags.some((item) => item.toLowerCase().includes(keyword));
    });
  }

  const sorted = items.slice().sort((a, b) => compare(a, b, sort));
  return { items: sorted.slice(offset, offset + limit), total: sorted.length };
}

function compare(a, b, sort) {
  if (sort === 'title') return a.title.localeCompare(b.title, 'zh-Hans');
  if (sort === 'created') return b.createdAt.localeCompare(a.createdAt);
  if (sort === 'usage') {
    const diff = (b.usageCount || 0) - (a.usageCount || 0);
    return diff !== 0 ? diff : b.updatedAt.localeCompare(a.updatedAt);
  }
  return b.updatedAt.localeCompare(a.updatedAt);
}

export function get(db, id) {
  const prompt = db.snapshot().prompts.find((item) => item.id === id);
  if (!prompt) throw ApiError.notFound('Prompt 不存在');
  return prompt;
}

/** 在数据草稿上创建（供跨模块编排复用，不单独开事务） */
export function createInData(data, input, options = {}) {
  const prompt = buildPrompt(data, input, options);
  data.prompts.unshift(prompt);
  return prompt;
}

export async function create(db, input) {
  return db.mutate((data) => createInData(data, input));
}

export async function update(db, id, patch) {
  return db.mutate((data) => {
    const index = findIndex(data, id);
    const next = applyPatch(data, data.prompts[index], patch);
    data.prompts[index] = next;
    return next;
  });
}

export async function remove(db, id) {
  return db.mutate((data) => {
    data.prompts = data.prompts.filter((prompt) => prompt.id !== id);
    // 图片只是来源，不回删；把引用置空避免悬空
    for (const image of data.images) {
      if (image.promptId === id) image.promptId = null;
    }
    return { ok: true };
  });
}

export async function duplicate(db, id) {
  return db.mutate((data) => {
    const index = findIndex(data, id);
    const source = data.prompts[index];
    const now = nowIso();
    const copy = {
      ...structuredClone(source),
      id: newId('p'),
      title: `${source.title} 副本`.slice(0, PROMPT_LIMITS.title),
      imageId: null,
      exampleImageId: source.exampleImageId ?? null,
      usageCount: 0,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    data.prompts.unshift(copy);
    return copy;
  });
}

export async function markUsed(db, id) {
  return db.mutate((data) => {
    const index = findIndex(data, id);
    const prompt = data.prompts[index];
    prompt.usageCount = (prompt.usageCount || 0) + 1;
    prompt.lastUsedAt = nowIso();
    return prompt;
  });
}

/** copy 文本：按目标格式序列化；comfyui + mode=workflow 时直接回吐 workflow JSON */
export function copy(db, id, options = {}) {
  const snap = db.snapshot();
  const prompt = snap.prompts.find((item) => item.id === id);
  if (!prompt) throw ApiError.notFound('Prompt 不存在');

  const target = isTarget(options.format) ? options.format : prompt.target;
  if (target === 'comfyui' && options.mode === 'workflow') {
    const workflow = prompt.params?.workflow;
    if (workflow) return { text: JSON.stringify(workflow, null, 2), format: 'comfyui' };
  }

  const adapter = getAdapter(target);
  // positive 是唯一事实来源：分块编辑保存时已由后端重算，停用的 tag 不会进入 positive
  const text = adapter.serialize(
    { ...prompt, params: adapter.normalize(prompt.params) },
    { withParams: snap.settings.copyWithParams !== false },
  );
  return { text, format: target };
}

/** 导出包：受 ids / target / folderId 限制，缺省导出全部 */
export function exportPack(db, query = {}) {
  const snap = db.snapshot();
  let items = snap.prompts;

  const ids = typeof query.ids === 'string' ? query.ids.split(',').map((id) => id.trim()).filter(Boolean) : [];
  if (ids.length) {
    const wanted = new Set(ids);
    items = items.filter((prompt) => wanted.has(prompt.id));
  }
  if (query.target === 'nai' || query.target === 'comfyui') {
    items = items.filter((prompt) => prompt.target === query.target);
  }
  if (query.folderId === 'root') {
    items = items.filter((prompt) => prompt.folderId === null);
  } else if (typeof query.folderId === 'string' && query.folderId) {
    items = items.filter((prompt) => prompt.folderId === query.folderId);
  }

  return {
    version: 1,
    exportedAt: nowIso(),
    app: 'prompt-atelier',
    prompts: structuredClone(items),
  };
}

/**
 * 导入：兼容导出包 / 裸数组 / 单对象，逐条校验，非法条目进 skipped。
 */
export async function importMany(db, { data, folderId } = {}) {
  let entries;
  if (Array.isArray(data)) entries = data;
  else if (isPlainObject(data) && Array.isArray(data.prompts)) entries = data.prompts;
  else if (isPlainObject(data)) entries = [data];
  else throw ApiError.validation('data 必须是导出包、Prompt 数组或对象');

  return db.mutate((draft) => {
    const skipped = [];
    let imported = 0;
    entries.forEach((entry, index) => {
      try {
        // 导入包里的示例图指向另一个图片库，落地时清空避免悬空引用
        const source = isPlainObject(entry) ? { ...entry, exampleImageId: null } : entry;
        const prompt = buildPrompt(draft, source, { fallbackFolderId: folderId ?? null });
        draft.prompts.unshift(prompt);
        imported += 1;
      } catch (err) {
        skipped.push({ index, reason: err instanceof ApiError ? err.message : '条目无效' });
      }
    });
    return { imported, skipped };
  });
}
