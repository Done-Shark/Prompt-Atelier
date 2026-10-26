/**
 * 相簿服务：与文件夹互补的组织层。
 * - 文件夹是图片的唯一归属；相簿是多对多集合，一张图可以进多个相簿。
 * - 「收藏」是系统相簿（id = favorites），不落库，成员关系用 image.favorite 表示。
 */
import { ApiError } from '../../lib/errors.js';
import { newId, nowIso } from '../../lib/ids.js';
import { cleanInt, cleanString, cleanStringArray, isPlainObject, LIMITS } from '../../lib/validate.js';

export const FAVORITES_ID = 'favorites';

function normalizeName(value) {
  const name = cleanString(value, { field: '相簿名称', max: LIMITS.folderName, allowEmpty: false });
  if (!name) throw ApiError.validation('相簿名称不能为空');
  return name;
}

function requireAlbum(data, id) {
  const album = data.albums.find((item) => item.id === id);
  if (!album) throw ApiError.notFound('相簿不存在');
  return album;
}

function assertUniqueName(data, name, excludeId = null) {
  const key = name.toLowerCase();
  if (data.albums.some((album) => album.id !== excludeId && album.name.toLowerCase() === key)) {
    throw ApiError.conflict('已存在同名相簿');
  }
}

export function list(db) {
  const snap = db.snapshot();
  const counts = new Map();
  let favorites = 0;
  for (const image of snap.images) {
    if (image.favorite) favorites += 1;
    for (const albumId of image.albumIds || []) {
      counts.set(albumId, (counts.get(albumId) || 0) + 1);
    }
  }
  const items = [
    { id: FAVORITES_ID, name: '收藏', system: true, order: -1, count: favorites },
    ...snap.albums
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name, 'zh-Hans'))
      .map((album) => ({ ...album, system: false, count: counts.get(album.id) || 0 })),
  ];
  return { items, total: items.length };
}

export async function create(db, input = {}) {
  if (!isPlainObject(input)) throw ApiError.validation('请求体必须是对象');
  return db.mutate((data) => {
    const name = normalizeName(input.name);
    assertUniqueName(data, name);
    const now = nowIso();
    const album = {
      id: newId('a'),
      name,
      order: data.albums.reduce((max, item) => Math.max(max, item.order || 0), -1) + 1,
      createdAt: now,
      updatedAt: now,
    };
    data.albums.push(album);
    return { ...album, system: false, count: 0 };
  });
}

export async function update(db, id, patch = {}) {
  if (!isPlainObject(patch)) throw ApiError.validation('请求体必须是对象');
  if (id === FAVORITES_ID) throw ApiError.validation('系统相簿不能修改');
  return db.mutate((data) => {
    const album = requireAlbum(data, id);
    if ('name' in patch) {
      const name = normalizeName(patch.name);
      assertUniqueName(data, name, id);
      album.name = name;
    }
    if ('order' in patch) album.order = cleanInt(patch.order, { min: 0, max: 100000, fallback: album.order });
    album.updatedAt = nowIso();
    const count = data.images.filter((image) => (image.albumIds || []).includes(id)).length;
    return { ...album, system: false, count };
  });
}

/**
 * 拖动排序：按传入的 id 顺序重排，未列出的相簿保持在末尾。
 * 只改 order，不动名称与成员关系。
 */
export async function reorder(db, body = {}) {
  if (!isPlainObject(body)) throw ApiError.validation('请求体必须是对象');
  const ids = cleanStringArray(body.ids, { maxItems: 500, maxLen: 80 });
  if (!ids.length) throw ApiError.validation('ids 不能为空');
  return db.mutate((data) => {
    const remaining = new Map(data.albums.map((album) => [album.id, album]));
    let index = 0;
    for (const id of ids) {
      const album = remaining.get(id);
      if (!album) continue;
      album.order = index;
      album.updatedAt = nowIso();
      index += 1;
      remaining.delete(id);
    }
    for (const album of data.albums
      .filter((item) => remaining.has(item.id))
      .sort((a, b) => (a.order || 0) - (b.order || 0))) {
      album.order = index;
      index += 1;
    }
    return { ok: true, updated: data.albums.length };
  });
}

export async function remove(db, id) {
  if (id === FAVORITES_ID) throw ApiError.validation('系统相簿不能删除');
  return db.mutate((data) => {
    requireAlbum(data, id);
    let removed = 0;
    for (const image of data.images) {
      if (!Array.isArray(image.albumIds) || !image.albumIds.includes(id)) continue;
      image.albumIds = image.albumIds.filter((albumId) => albumId !== id);
      removed += 1;
    }
    data.albums = data.albums.filter((album) => album.id !== id);
    return { ok: true, removed };
  });
}

/** 批量加入 / 移出相簿；收藏走 favorite 字段 */
export async function membership(ctx, id, body = {}) {
  if (!isPlainObject(body)) throw ApiError.validation('请求体必须是对象');
  const ids = cleanStringArray(body.ids, { maxItems: 1000, maxLen: 80 });
  if (!ids.length) throw ApiError.validation('ids 不能为空');
  const action = body.action === 'remove' ? 'remove' : 'add';

  return ctx.db.mutate((data) => {
    if (id !== FAVORITES_ID) requireAlbum(data, id);
    const wanted = new Set(ids);
    let updated = 0;
    for (const image of data.images) {
      if (!wanted.has(image.id)) continue;
      if (id === FAVORITES_ID) {
        image.favorite = action === 'add';
        updated += 1;
        continue;
      }
      const current = Array.isArray(image.albumIds) ? image.albumIds : [];
      const next = action === 'add' ? [...new Set([...current, id])] : current.filter((albumId) => albumId !== id);
      if (next.length !== current.length) updated += 1;
      image.albumIds = next;
    }
    return { ok: true, updated, skipped: ids.length - updated };
  });
}
