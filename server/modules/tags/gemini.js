/**
 * Google Gemini（generativelanguage.googleapis.com）原生 generateContent 接口。
 *
 * 与 OpenAI 兼容接口的差异：
 * - 路径是 /models/<model>:generateContent，鉴权用 x-goog-api-key 头；
 * - 消息放在 contents[].parts[].text，system 单独走 systemInstruction；
 * - 结构化输出用 generationConfig.responseMimeType = application/json。
 */
import { buildResultMap, categoryPayload, normalizeBaseUrl, parseJsonContent, SYSTEM_PROMPT } from './aiShared.js';

const TIMEOUT_MS = 60000;
export const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';

export function geminiEndpoint(baseUrl, model) {
  return `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`;
}

/** 请求体：分类表 + tag 列表放在一条 user message 里 */
export function buildGeminiRequest(tags) {
  return {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: 'user',
        parts: [{ text: JSON.stringify({ categories: categoryPayload(), tags }) }],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      maxOutputTokens: 8192,
    },
  };
}

/** 从 generateContent 响应里取出文本；被安全策略拦截时给出可读错误 */
export function parseGeminiResponse(payload) {
  const candidate = payload?.candidates?.[0];
  const parts = candidate?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((part) => part?.text ?? '').join('') : '';
  if (!text.trim()) {
    const blocked = payload?.promptFeedback?.blockReason || candidate?.finishReason;
    throw new Error(`Gemini 没有返回内容${blocked ? `（${blocked}）` : ''}`);
  }
  return parseJsonContent(text);
}

/**
 * @param {{baseUrl?: string, apiKey?: string, model?: string}} config
 * @param {string[]} tags
 * @returns {Promise<Map<string, {translation: string, category: string}>>}
 */
export async function translateTagsWithGemini(config, tags) {
  const baseUrl = normalizeBaseUrl(config?.baseUrl, GEMINI_DEFAULT_BASE_URL);
  const model = String(config?.model || '').trim() || GEMINI_DEFAULT_MODEL;
  const apiKey = String(config?.apiKey || '').trim();
  if (!apiKey) throw new Error('Gemini 需要 API Key（设置 → Tag 与翻译）');
  if (!tags.length) return new Map();

  const response = await fetch(geminiEndpoint(baseUrl, model), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(buildGeminiRequest(tags)),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Gemini 接口返回 HTTP ${response.status}${detail ? `：${detail.slice(0, 160)}` : ''}`);
  }

  return buildResultMap(parseGeminiResponse(await response.json()), tags);
}
