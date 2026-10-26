/**
 * OpenAI 兼容接口的批量翻译 / 分类。
 * 面向本地小模型（Ollama、LM Studio、vLLM、llama.cpp server 等），也兼容云端。
 */
import { buildResultMap, categoryPayload, normalizeBaseUrl, parseJsonContent, SYSTEM_PROMPT } from './aiShared.js';

const TIMEOUT_MS = 60000;

/**
 * @param {{baseUrl: string, apiKey: string, model: string}} config
 * @param {string[]} tags
 * @returns {Promise<Map<string, {translation: string, category: string}>>}
 */
export async function translateTagsWithLlm(config, tags) {
  const baseUrl = normalizeBaseUrl(config?.baseUrl);
  const model = String(config?.model || '').trim();
  if (!model) throw new Error('未配置模型名称（设置 → Tag 与翻译）');
  if (!tags.length) return new Map();

  const body = {
    model,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({ categories: categoryPayload(), tags }),
      },
    ],
    response_format: { type: 'json_object' },
  };

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(config?.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`模型接口返回 HTTP ${response.status}${detail ? `：${detail.slice(0, 160)}` : ''}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  return buildResultMap(parseJsonContent(content), tags);
}
