/**
 * Tag 别名：改名 / 合并后旧写法 → 规范写法。
 * 只做解析，不做存储；存储形态是 db.tagAliases = [{ alias, canonical, createdAt }]。
 */
import { normalizeTagKey } from '../../../shared/tagCategories.js';

const MAX_HOPS = 10;

export function aliasMap(data) {
  const map = new Map();
  for (const entry of data?.tagAliases || []) {
    if (!entry?.alias || !entry?.canonical) continue;
    map.set(entry.alias, entry.canonical);
  }
  return map;
}

/** 沿别名链解析到最终规范 tag；没有别名时返回规范化后的原值 */
export function resolveAlias(data, raw) {
  let key = normalizeTagKey(raw);
  if (!key) return '';
  const map = aliasMap(data);
  for (let hop = 0; hop < MAX_HOPS && map.has(key); hop += 1) {
    const next = map.get(key);
    if (!next || next === key) break;
    key = next;
  }
  return key;
}
