/**
 * AI 翻译 / 分类的公共部分：提示词、JSON 解析、结果归一化。
 * 由 OpenAI 兼容（llm.js）与 Gemini（gemini.js）两个 provider 共用，
 * 保证不同接口返回的条目经过同一套校验与分类兜底。
 */
import { TAG_CATEGORIES, TAG_CATEGORY_IDS, isTagCategory } from '../../../shared/tagCategories.js';

export const SYSTEM_PROMPT = [
  '你是 Danbooru / NovelAI 的 tag 词典编辑。',
  '把每个 tag 翻译成简洁的简体中文（不超过 12 个字），并归入给定分类之一。',
  '画师名保留原名，可加"画师:"前缀；角色名与作品名按通用译名。',
  '只输出 JSON，不要解释。格式：{"items":[{"tag":"原 tag","translation":"中文","category":"分类 id"}]}',
].join('\n');

/** 请求里附带的分类表，让模型只用合法分类 id */
export function categoryPayload() {
  return TAG_CATEGORIES.map((category) => ({ id: category.id, label: category.label }));
}

/** 只允许 HTTPS；本地 localhost 允许 HTTP */
export function normalizeBaseUrl(value, fallback = '') {
  const candidate = String(value || fallback).trim().replace(/\/+$/, '');
  if (!candidate) throw new Error('未配置模型地址（设置 → Tag 与翻译）');
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('模型地址格式无效');
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('模型地址必须使用 HTTPS；本地 localhost 可用 HTTP');
  }
  return candidate;
}

/** 容忍 ```json 包裹与前后说明文字 */
export function parseJsonContent(content) {
  const text = String(content || '').trim();
  const cleaned = text.startsWith('```') ? text.replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim() : text;
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('模型返回的不是合法 JSON');
  }
}

/**
 * 把模型返回的 items 归一化成 Map<tag, {translation, category}>。
 * 未请求的 tag、空翻译会被丢弃；非法分类落到 unsorted。
 */
export function buildResultMap(parsed, tags) {
  const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
  const wanted = new Set(tags);
  const out = new Map();
  for (const item of items) {
    const tag = String(item?.tag || '').trim().toLowerCase();
    const translation = String(item?.translation || '').trim().slice(0, 200);
    if (!tag || !translation || !wanted.has(tag)) continue;
    out.set(tag, {
      translation,
      category: isTagCategory(item?.category) ? item.category : TAG_CATEGORY_IDS[TAG_CATEGORY_IDS.length - 1],
    });
  }
  return out;
}
