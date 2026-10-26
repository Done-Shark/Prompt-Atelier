/**
 * Tag 分类：内置分类 + 用户自建分类，order 决定 Tag 库与图片详情的分组顺序。
 */
import { ApiError } from '../../lib/errors.js';
import { newId, nowIso } from '../../lib/ids.js';
import { cleanString, isPlainObject } from '../../lib/validate.js';

const MAX_LABEL = 24;

function requireLabel(value) {
  const label = cleanString(value, { field: '分类名称', max: MAX_LABEL, allowEmpty: false });
  if (!label) throw ApiError.validation('分类名称不能为空');
  return label;
}

function requireCategory(data, id) {
  const category = (data.tagCategories || []).find((item) => item.id === id);
  if (!category) throw ApiError.notFound('分类不存在');
  return category;
}

function assertUniqueLabel(data, label, excludeId = null) {
  const key = label.toLowerCase();
  const clash = (data.tagCategories || []).some(
    (item) => item.id !== excludeId && String(item.label).toLowerCase() === key,
  );
  if (clash) throw ApiError.conflict('已存在同名分类');
}

export function list(db) {
  return db
    .snapshot()
    .tagCategories.slice()
    .sort((a, b) => a.order - b.order);
}

export async function create(ctx, body = {}) {
  if (!isPlainObject(body)) throw ApiError.validation('请求体必须是对象');
  const label = requireLabel(body.label);
  return ctx.db.mutate((data) => {
    assertUniqueLabel(data, label);
    const order = (data.tagCategories || []).reduce((max, item) => Math.max(max, item.order || 0), -1) + 1;
    const category = { id: newId('cat'), label, order, builtin: false, createdAt: nowIso() };
    data.tagCategories = [...(data.tagCategories || []), category];
    return category;
  });
}

export async function update(ctx, id, body = {}) {
  if (!isPlainObject(body)) throw ApiError.validation('请求体必须是对象');
  return ctx.db.mutate((data) => {
    const category = requireCategory(data, id);
    if ('label' in body) {
      const label = requireLabel(body.label);
      assertUniqueLabel(data, label, id);
      category.label = label;
    }
    return category;
  });
}

/** 删除自建分类：标签回到「未分类」；内置分类不允许删除 */
export async function remove(ctx, id) {
  return ctx.db.mutate((data) => {
    const category = requireCategory(data, id);
    if (category.builtin) throw ApiError.validation('内置分类不能删除');
    let moved = 0;
    for (const entry of data.tags || []) {
      if (entry.category !== id) continue;
      entry.category = 'unsorted';
      entry.categorySource = 'manual';
      entry.updatedAt = nowIso();
      moved += 1;
    }
    data.tagCategories = (data.tagCategories || []).filter((item) => item.id !== id);
    return { ok: true, moved };
  });
}

/** 按传入的 id 顺序重排；未列出的分类排在后面 */
export async function reorder(ctx, body = {}) {
  if (!isPlainObject(body) || !Array.isArray(body.ids)) throw ApiError.validation('ids 必须是数组');
  const ids = body.ids.filter((id) => typeof id === 'string' && id);
  return ctx.db.mutate((data) => {
    const known = new Set((data.tagCategories || []).map((item) => item.id));
    const ordered = ids.filter((id, index) => known.has(id) && ids.indexOf(id) === index);
    let order = 0;
    for (const id of ordered) {
      const category = data.tagCategories.find((item) => item.id === id);
      if (category) category.order = order++;
    }
    for (const category of data.tagCategories) {
      if (!ordered.includes(category.id)) category.order = order++;
    }
    return {
      ok: true,
      items: [...data.tagCategories].sort((a, b) => a.order - b.order),
    };
  });
}
