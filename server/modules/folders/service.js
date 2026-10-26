/**
 * 文件夹服务：Prompt 文件夹与图片文件夹共用一张表，用 scope 区分。
 * - scope = 'prompt'：target 只是归属提示（all / nai / comfyui）；
 * - scope = 'image'：target 固定为 nai 或 comfyui，文件夹树按目标隔离；
 * - scope = 'rp'：RP 角色卡文件夹，target 固定 all。
 * 同级重名检查、父级环检测、删除时子级上移。
 */
import { ApiError } from '../../lib/errors.js';
import { newId, nowIso } from '../../lib/ids.js';
import { cleanInt, cleanString, isPlainObject, LIMITS } from '../../lib/validate.js';

import { TARGET_IDS } from '../../../shared/targets.js';

const TARGETS = [...TARGET_IDS, 'all'];
const IMAGE_TARGETS = [...TARGET_IDS];
const SCOPES = ['prompt', 'image', 'rp'];

function scopeOf(folder) {
  if (folder.scope === 'image') return 'image';
  if (folder.scope === 'rp') return 'rp';
  return 'prompt';
}

function normalizeName(value) {
  const name = cleanString(value, { field: '文件夹名称', max: LIMITS.folderName, allowEmpty: false });
  if (!name) throw ApiError.validation('文件夹名称不能为空');
  return name;
}

function siblings(data, parentId, scope, target, excludeId = null) {
  return data.folders.filter((folder) => {
    if (folder.parentId !== parentId) return false;
    if (folder.id === excludeId) return false;
    if (scopeOf(folder) !== scope) return false;
    // 根级图片文件夹按 target 隔离；子级沿用父级，无需再比 target
    if (parentId === null && scope === 'image' && folder.target !== target) return false;
    return true;
  });
}

function assertUniqueName(data, name, parentId, scope, target, excludeId = null) {
  const key = name.toLowerCase();
  const clash = siblings(data, parentId, scope, target, excludeId).some(
    (folder) => folder.name.toLowerCase() === key,
  );
  if (clash) throw ApiError.conflict('同级已存在同名文件夹');
}

function requireFolder(data, id) {
  const folder = data.folders.find((item) => item.id === id);
  if (!folder) throw ApiError.notFound('文件夹不存在');
  return folder;
}

function normalizeParent(data, parentId, scope, target) {
  if (parentId === undefined) return undefined;
  if (parentId === null || parentId === '') return null;
  if (typeof parentId !== 'string') throw ApiError.validation('parentId 必须是字符串或 null');
  const parent = requireFolder(data, parentId);
  if (scopeOf(parent) !== scope) throw ApiError.validation('父文件夹的用途不一致');
  if (scope === 'image' && parent.target !== target) throw ApiError.validation('父文件夹的目标格式不一致');
  return parentId;
}

/** 判断 candidate 是否是 folderId 的后代（含自身），用于环检测 */
function isSelfOrDescendant(data, candidateId, folderId) {
  let cursor = candidateId;
  const seen = new Set();
  while (cursor) {
    if (cursor === folderId) return true;
    if (seen.has(cursor)) return true; // 已有脏数据形成环，直接拒绝
    seen.add(cursor);
    const parent = data.folders.find((folder) => folder.id === cursor);
    cursor = parent ? parent.parentId : null;
  }
  return false;
}

function nextOrder(data, parentId, scope, target) {
  const list = siblings(data, parentId, scope, target);
  return list.reduce((max, folder) => Math.max(max, folder.order || 0), -1) + 1;
}

export function list(db, query = {}) {
  const scope = SCOPES.includes(query.scope) ? query.scope : null;
  const target = IMAGE_TARGETS.includes(query.target) ? query.target : null;

  let items = db.snapshot().folders;
  if (scope) items = items.filter((folder) => scopeOf(folder) === scope);
  if (scope === 'image' && target) items = items.filter((folder) => folder.target === target);

  const imageCounts = new Map();
  for (const image of db.snapshot().images) {
    if (!image.folderId) continue;
    imageCounts.set(image.folderId, (imageCounts.get(image.folderId) || 0) + 1);
  }
  // 子文件夹的图片也计入父级，避免父文件夹显示 0 造成误解
  const childMap = new Map();
  for (const folder of items) {
    const key = folder.parentId ?? null;
    childMap.set(key, [...(childMap.get(key) ?? []), folder]);
  }
  const totalCache = new Map();
  const subtreeTotal = (folder) => {
    if (totalCache.has(folder.id)) return totalCache.get(folder.id);
    let total = imageCounts.get(folder.id) || 0;
    for (const child of childMap.get(folder.id) ?? []) total += subtreeTotal(child);
    totalCache.set(folder.id, total);
    return total;
  };
  const promptCounts = new Map();
  for (const prompt of db.snapshot().prompts) {
    if (!prompt.folderId) continue;
    promptCounts.set(prompt.folderId, (promptCounts.get(prompt.folderId) || 0) + 1);
  }
  const characterCounts = new Map();
  for (const card of db.snapshot().characters || []) {
    if (!card.folderId) continue;
    characterCounts.set(card.folderId, (characterCounts.get(card.folderId) || 0) + 1);
  }
  const characterCache = new Map();
  const subtreeCharacters = (folder) => {
    if (characterCache.has(folder.id)) return characterCache.get(folder.id);
    let total = characterCounts.get(folder.id) || 0;
    for (const child of childMap.get(folder.id) ?? []) total += subtreeCharacters(child);
    characterCache.set(folder.id, total);
    return total;
  };

  const promptCache = new Map();
  const subtreePrompts = (folder) => {
    if (promptCache.has(folder.id)) return promptCache.get(folder.id);
    let total = promptCounts.get(folder.id) || 0;
    for (const child of childMap.get(folder.id) ?? []) total += subtreePrompts(child);
    promptCache.set(folder.id, total);
    return total;
  };

  const withCounts = items.map((folder) => {
    if (scopeOf(folder) === 'image') {
      return {
        ...folder,
        imageCount: imageCounts.get(folder.id) || 0,
        imageTotal: subtreeTotal(folder),
      };
    }
    if (scopeOf(folder) === 'rp') {
      return {
        ...folder,
        characterCount: characterCounts.get(folder.id) || 0,
        characterTotal: subtreeCharacters(folder),
      };
    }
    return {
      ...folder,
      promptCount: promptCounts.get(folder.id) || 0,
      promptTotal: subtreePrompts(folder),
    };
  });

  const sorted = withCounts.slice().sort((a, b) => {
    if (a.parentId === b.parentId) {
      const diff = (a.order || 0) - (b.order || 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name, 'zh-Hans');
    }
    return String(a.parentId).localeCompare(String(b.parentId));
  });
  return { items: sorted, total: sorted.length };
}

export async function create(db, input = {}) {
  if (!isPlainObject(input)) throw ApiError.validation('请求体必须是对象');
  return db.mutate((data) => {
    const name = normalizeName(input.name);
    const scope = input.scope === 'image' ? 'image' : input.scope === 'rp' ? 'rp' : 'prompt';
    const target =
      scope === 'image'
        ? IMAGE_TARGETS.includes(input.target)
          ? input.target
          : null
        : TARGETS.includes(input.target)
          ? input.target
          : 'all';
    if (scope === 'image' && !target) {
      throw ApiError.validation('图片文件夹必须指定 nai 或 comfyui');
    }

    const parentId = normalizeParent(data, input.parentId, scope, target) ?? null;
    assertUniqueName(data, name, parentId, scope, target);
    const now = nowIso();
    const folder = {
      id: newId('f'),
      name,
      parentId,
      scope,
      target,
      order: nextOrder(data, parentId, scope, target),
      createdAt: now,
      updatedAt: now,
    };
    data.folders.push(folder);
    return folder;
  });
}

export async function update(db, id, patch = {}) {
  if (!isPlainObject(patch)) throw ApiError.validation('请求体必须是对象');
  return db.mutate((data) => {
    const folder = requireFolder(data, id);
    const scope = scopeOf(folder);
    if ('scope' in patch && patch.scope !== scope) {
      throw ApiError.validation('不能修改文件夹用途');
    }

    let name = folder.name;
    if ('name' in patch) name = normalizeName(patch.name);

    let parentId = folder.parentId;
    if ('parentId' in patch) {
      const nextParent = normalizeParent(data, patch.parentId, scope, folder.target) ?? null;
      if (nextParent && isSelfOrDescendant(data, nextParent, id)) {
        throw ApiError.validation('不能把文件夹移动到自身或其子级下');
      }
      parentId = nextParent;
    }

    if (name !== folder.name || parentId !== folder.parentId) {
      assertUniqueName(data, name, parentId, scope, folder.target, id);
    }

    folder.name = name;
    folder.parentId = parentId;
    if ('target' in patch) {
      if (scope === 'image') {
        throw ApiError.validation('图片文件夹不能切换目标格式');
      }
      if (TARGETS.includes(patch.target)) folder.target = patch.target;
    }
    if ('order' in patch) folder.order = cleanInt(patch.order, { min: 0, max: 100000, fallback: folder.order });
    folder.updatedAt = nowIso();
    return folder;
  });
}

/**
 * 拖动排序 / 拖动改父级。
 * - 只改 parentId、不改顺序：同父级内即为「排序」；
 * - 跨父级即为「移动」（可拖进另一个文件夹成为子级）；
 * - 两个父级的兄弟列表都会重新编号，保证 order 连续。
 */
export async function move(db, id, body = {}) {
  if (!isPlainObject(body)) throw ApiError.validation('请求体必须是对象');
  return db.mutate((data) => {
    const folder = requireFolder(data, id);
    const scope = scopeOf(folder);
    const target = folder.target;
    const oldParentId = folder.parentId;

    const parentId =
      'parentId' in body ? normalizeParent(data, body.parentId, scope, target) ?? null : oldParentId;
    if (parentId && isSelfOrDescendant(data, parentId, id)) {
      throw ApiError.validation('不能把文件夹移动到自身或其子级下');
    }
    if (parentId !== oldParentId) {
      assertUniqueName(data, folder.name, parentId, scope, target, id);
    }

    const beforeId = typeof body.beforeId === 'string' && body.beforeId ? body.beforeId : null;
    folder.parentId = parentId;
    folder.updatedAt = nowIso();

    const ordered = siblings(data, parentId, scope, target)
      .filter((item) => item.id !== id)
      .sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name, 'zh-Hans'));
    let insertAt = ordered.length;
    if (beforeId) {
      const index = ordered.findIndex((item) => item.id === beforeId);
      if (index >= 0) insertAt = index;
    }
    ordered.splice(insertAt, 0, folder);
    ordered.forEach((item, index) => {
      item.order = index;
    });

    if (oldParentId !== parentId) {
      siblings(data, oldParentId, scope, target)
        .filter((item) => item.id !== id)
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .forEach((item, index) => {
          item.order = index;
        });
    }

    return { ok: true, folder: { ...folder } };
  });
}

/** 删除：子文件夹上移一层；所属 Prompt / 图片的 folderId 置 null */
export async function remove(db, id) {
  return db.mutate((data) => {
    const folder = requireFolder(data, id);
    for (const child of data.folders) {
      if (child.parentId === id) {
        child.parentId = folder.parentId;
        child.updatedAt = nowIso();
      }
    }
    let movedPrompts = 0;
    for (const prompt of data.prompts) {
      if (prompt.folderId === id) {
        prompt.folderId = null;
        prompt.updatedAt = nowIso();
        movedPrompts += 1;
      }
    }
    let movedImages = 0;
    for (const image of data.images) {
      if (image.folderId === id) {
        image.folderId = null;
        movedImages += 1;
      }
    }
    let movedCharacters = 0;
    for (const card of data.characters || []) {
      if (card.folderId === id) {
        card.folderId = null;
        card.updatedAt = nowIso();
        movedCharacters += 1;
      }
    }
    data.folders = data.folders.filter((item) => item.id !== id);
    return { ok: true, movedPrompts, movedImages, movedCharacters };
  });
}
