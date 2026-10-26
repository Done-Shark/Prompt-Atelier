/**
 * Danbooru 分类查询。只取分类与热度，不取翻译。
 * 文档：https://danbooru.donmai.us/wiki_pages/help:api
 */
import { DANBOORU_CATEGORY_MAP } from '../../../shared/tagCategories.js';

const DANBOORU_URL = 'https://danbooru.donmai.us/tags.json';
const BATCH_SIZE = 50;
const TIMEOUT_MS = 12000;

function responseItems(body) {
  if (Array.isArray(body)) return body;
  return body && typeof body === 'object' ? [body] : [];
}

async function fetchBatch(keys, fetchImpl) {
  const url = new URL(DANBOORU_URL);
  url.searchParams.set('limit', String(keys.length));
  for (const key of keys) url.searchParams.append('search[name][]', key);

  const response = await fetchImpl(url.toString(), {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'PromptAtelier/0.1 (local tag category lookup)',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Danbooru 查询失败（HTTP ${response.status}）`);
  return responseItems(await response.json());
}

/**
 * 批量查询分类。
 * @param {string[]} keys 规范化后的 tag
 * @returns {Promise<Map<string, {category: string|null, postCount: number|null}>>}
 */
export async function fetchDanbooruTags(keys, fetchImpl = globalThis.fetch) {
  const unique = [...new Set((keys || []).filter(Boolean))];
  const found = new Map();
  for (let offset = 0; offset < unique.length; offset += BATCH_SIZE) {
    const batch = unique.slice(offset, offset + BATCH_SIZE);
    const items = await fetchBatch(batch, fetchImpl);
    for (const item of items) {
      const name = String(item?.name || '').toLowerCase();
      if (!name) continue;
      found.set(name, {
        category: DANBOORU_CATEGORY_MAP[Number(item.category)] || null,
        postCount: Number.isFinite(item.post_count) ? Number(item.post_count) : null,
      });
    }
  }
  return found;
}
