/**
 * SillyTavern 角色卡解析。
 * - PNG：`chara` / `ccv3` 文本块里是 base64 的 JSON（V2 / V3 规范）
 * - JSON：整份文件就是卡片对象（可能是 { spec, data } 或扁平结构）
 */
import { readTextChunks } from './png.js';

const LIMITS = { name: 120, settings: 20000, description: 4000, prompt: 20000, tags: 50 };

function text(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

/** 文本块可能是 base64，也可能直接是 JSON；两种都试 */
export function decodeCardPayload(raw) {
  const source = String(raw || '').trim();
  if (!source) return null;
  const candidates = [() => Buffer.from(source, 'base64').toString('utf8'), () => source];
  for (const read of candidates) {
    try {
      const parsed = JSON.parse(read());
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // 试下一种
    }
  }
  return null;
}

/**
 * 卡片字段 → 我们的四个展示字段：
 * - 简介：作者备注，没有就取角色描述前 300 字
 * - RP 设定：性格 + 场景
 * - Prompt：角色描述全文（可直接粘贴到 SillyTavern）
 */
export function cardToFields(card) {
  if (!card || typeof card !== 'object') return null;
  const data = card.data && typeof card.data === 'object' ? card.data : card;
  if (!data || typeof data !== 'object') return null;

  const name = text(data.name, LIMITS.name) || '未命名角色';
  const tags = Array.isArray(data.tags)
    ? data.tags
        .map((tag) => String(tag).trim())
        .filter(Boolean)
        .slice(0, LIMITS.tags)
    : [];
  const personality = text(data.personality, 8000);
  const scenario = text(data.scenario, 8000);
  const settings = [personality, scenario ? `场景：${scenario}` : '']
    .filter(Boolean)
    .join('\n\n')
    .slice(0, LIMITS.settings);
  const description = text(data.description, LIMITS.prompt);
  const creatorNotes = text(data.creator_notes, LIMITS.description);

  return {
    name,
    tags,
    settings,
    description: creatorNotes || description.slice(0, 300),
    prompt: description || settings,
    raw: card,
  };
}

/**
 * 解析上传的角色卡文件。
 * @param {Buffer} buffer
 * @returns {{name,tags,settings,description,prompt,raw,source:'png'|'json'}|null}
 */
export function parseRpCard(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;

  const isPng = buffer[0] === 0x89 && buffer.toString('latin1', 1, 4) === 'PNG';
  if (isPng) {
    const texts = readTextChunks(buffer);
    const payload = texts.ccv3 || texts.chara || texts.Chara || texts.CHARA;
    const card = decodeCardPayload(payload);
    const fields = cardToFields(card);
    return fields ? { ...fields, source: 'png' } : null;
  }

  try {
    const json = JSON.parse(buffer.toString('utf8'));
    const fields = cardToFields(json);
    return fields ? { ...fields, source: 'json' } : null;
  } catch {
    return null;
  }
}
