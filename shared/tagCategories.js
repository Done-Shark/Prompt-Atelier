/**
 * Tag 库分类。与 Prompt 语义块（segments）是两套视图：
 * - segments 面向"写 Prompt"，人物与版权合并为 subject；
 * - Tag 库面向"查词与翻译"，人物、版权分开，另含 meta。
 * 两者的映射集中在 SEGMENT_TO_TAG_CATEGORY，避免各页面各写一套。
 */
import { classifyTag } from './prompt/doc.js';

export const TAG_CATEGORIES = [
  { id: 'character', label: '人物' },
  { id: 'copyright', label: '版权' },
  { id: 'artist', label: '画师' },
  { id: 'appearance', label: '外貌' },
  { id: 'clothing', label: '服装' },
  { id: 'pose', label: '动作' },
  { id: 'expression', label: '表情' },
  { id: 'scene', label: '背景' },
  { id: 'composition', label: '构图' },
  { id: 'style', label: '质量 / 风格' },
  { id: 'meta', label: '元信息' },
  { id: 'unsorted', label: '未分类' },
];

export const TAG_CATEGORY_IDS = TAG_CATEGORIES.map((category) => category.id);

const LABELS = new Map(TAG_CATEGORIES.map((category) => [category.id, category.label]));

export function isTagCategory(id) {
  return LABELS.has(id);
}

export function tagCategoryLabel(id) {
  return LABELS.get(id) || LABELS.get('unsorted');
}

/** 语义块 → Tag 库分类（subject 默认落到人物，版权由 Danbooru / 手动纠正） */
export const SEGMENT_TO_TAG_CATEGORY = {
  artist: 'artist',
  subject: 'character',
  appearance: 'appearance',
  clothing: 'clothing',
  pose: 'pose',
  expression: 'expression',
  scene: 'scene',
  composition: 'composition',
  style: 'style',
  lora: 'meta',
  custom: 'unsorted',
  unsorted: 'unsorted',
};

/** Danbooru tag 分类编号 → 本项目的 Tag 分类 */
export const DANBOORU_CATEGORY_MAP = {
  1: 'artist',
  3: 'copyright',
  4: 'character',
  5: 'meta',
};

/** 统一 tag 标识：去权重、转小写、空格转下划线；LoRA 与空值返回空串 */
export function normalizeTagKey(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  if (/^<lora:/i.test(value)) return '';
  let guard = 0;
  while (guard < 8) {
    guard += 1;
    const wrapped =
      (value.startsWith('{') && value.endsWith('}')) ||
      (value.startsWith('[') && value.endsWith(']')) ||
      (value.startsWith('(') && value.endsWith(')'));
    if (!wrapped) break;
    value = value.slice(1, -1).trim();
  }
  value = value.replace(/:\s*-?\d+(\.\d+)?$/, '').trim();
  if (!value) return '';
  return value.toLowerCase().replace(/\s+/g, '_');
}

/** 展示用：把下划线还原成空格，但保留 _(series) 这类结构 */
export function displayTag(key) {
  return String(key || '')
    .replace(/_/g, ' ')
    .replace(/\s+\(/g, ' (')
    .trim();
}

/** 根据 tag 文本推断分类（Tag 库自动填充用） */
export function guessTagCategory(raw) {
  const key = normalizeTagKey(raw);
  if (!key) return 'unsorted';
  if (/^artist:/.test(key)) return 'artist';
  return SEGMENT_TO_TAG_CATEGORY[classifyTag(key)] || 'unsorted';
}
