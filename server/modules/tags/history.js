/**
 * Tag 操作日志与撤销。
 *
 * 每次改名 / 查找替换 / 批量修改 / 删除别名，都把「受影响对象的 before / after」记下来，
 * 撤销时按 key 还原；只记录真正变化的条目，不存全库快照。
 */
import { ApiError } from '../../lib/errors.js';
import { newId, nowIso } from '../../lib/ids.js';

const MAX_ENTRIES = 20;

function diffByKey(beforeList, afterList, key) {
  const beforeMap = new Map((beforeList || []).map((item) => [item[key], item]));
  const afterMap = new Map((afterList || []).map((item) => [item[key], item]));
  const upserts = [];
  const removed = [];
  for (const [value, after] of afterMap) {
    const before = beforeMap.get(value);
    if (!before) upserts.push({ key: value, before: null, after });
    else if (JSON.stringify(before) !== JSON.stringify(after)) upserts.push({ key: value, before, after });
  }
  for (const [value, before] of beforeMap) {
    if (!afterMap.has(value)) removed.push({ key: value, before });
  }
  return { upserts, removed };
}

/** 记录 tags / 别名的「修改前」状态，配合 recordHistory 使用 */
export function captureTagState(data) {
  return {
    tags: structuredClone(data.tags || []),
    aliases: structuredClone(data.tagAliases || []),
  };
}

/** 把一次操作写入日志；tracker 收集被改动的 prompt / image */
export function recordHistory(data, label, before, tracker) {
  const changes = {
    tags: diffByKey(before?.tags, data.tags || [], 'tag'),
    aliases: diffByKey(before?.aliases, data.tagAliases || [], 'alias'),
    prompts: { upserts: tracker?.prompts ? [...tracker.prompts.values()] : [], removed: [] },
    images: { upserts: tracker?.images ? [...tracker.images.values()] : [], removed: [] },
  };
  const entry = { id: newId('h'), label, createdAt: nowIso(), changes };
  data.tagHistory = [...(data.tagHistory || []), entry].slice(-MAX_ENTRIES);
  return entry;
}

function applyChange(data, collection, key, change) {
  if (!change) return;
  const current = Array.isArray(data[collection]) ? data[collection] : [];
  const map = new Map(current.map((item) => [item[key], item]));
  for (const item of change.upserts || []) {
    if (item.before) map.set(item.key, structuredClone(item.before));
    else map.delete(item.key);
  }
  for (const item of change.removed || []) {
    map.set(item.key, structuredClone(item.before));
  }
  data[collection] = [...map.values()];
}

/** 撤销最近一次操作 */
export async function undoLast(db) {
  return db.mutate((data) => {
    const history = data.tagHistory || [];
    const entry = history[history.length - 1];
    if (!entry) throw ApiError.validation('没有可撤销的操作');
    applyChange(data, 'tags', 'tag', entry.changes?.tags);
    applyChange(data, 'tagAliases', 'alias', entry.changes?.aliases);
    applyChange(data, 'prompts', 'id', entry.changes?.prompts);
    applyChange(data, 'images', 'id', entry.changes?.images);
    data.tagHistory = history.slice(0, -1);
    return { ok: true, id: entry.id, label: entry.label };
  });
}

/** 最近的操作（新 → 旧），不返回 diff 明细 */
export function listHistory(db, limit = MAX_ENTRIES) {
  return (db.snapshot().tagHistory || [])
    .slice(-Math.max(1, Math.min(MAX_ENTRIES, limit)))
    .reverse()
    .map((entry) => ({ id: entry.id, label: entry.label, createdAt: entry.createdAt }));
}
