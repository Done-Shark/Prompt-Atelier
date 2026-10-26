/**
 * 数据结构定义与迁移。db.json 的结构是唯一真相。
 */
import { TAG_CATEGORIES, TAG_CATEGORY_IDS, guessTagCategory, normalizeTagKey } from '../../shared/tagCategories.js';
import { segmentTagTexts } from '../../shared/prompt/doc.js';

export const SCHEMA_VERSION = 3;

const CATEGORY_SOURCES = ['guess', 'danbooru', 'llm', 'manual'];
const TRANSLATION_SOURCES = ['none', 'dictionary', 'llm', 'gemini', 'manual'];

export function defaultTranslationSettings() {
  return {
    provider: 'dictionary',
    baseUrl: '',
    model: '',
    apiKey: '',
    autoTranslateOnImport: false,
    danbooruEnabled: true,
  };
}

export function defaultSettings(dataDir) {
  return {
    theme: 'dark',
    defaultTarget: 'nai',
    scanPaths: { nai: [], comfyui: [] },
    dataDir,
    copyWithParams: true,
    autoTagOnImport: true,
    reduceMotion: false,
    translation: defaultTranslationSettings(),
  };
}

export function defaultDb(dataDir) {
  return {
    version: SCHEMA_VERSION,
    settings: defaultSettings(dataDir),
    folders: [],
    prompts: [],
    images: [],
    /** 相簿：一张图片可以属于多个相簿；「收藏」是系统相簿（不落库） */
    albums: [],
    /** Tag 库：tag / 分类 / 翻译 / 来源 / 是否已人工修正 */
    tags: [],
    /** Tag 分类：内置 + 用户自建，order 决定展示顺序 */
    tagCategories: TAG_CATEGORIES.map((category, index) => ({
      id: category.id,
      label: category.label,
      order: index,
      builtin: true,
    })),
    /** 别名：改名 / 合并后旧写法 → 规范写法 */
    tagAliases: [],
    /** RP 角色卡：图片 + 标签 / 设定 / 简介 / Prompt */
    characters: [],
    /** Tag 操作日志：用于撤销改名 / 批量修改 / 别名删除 */
    tagHistory: [],
    /** 图片原始元数据（与 images 分表，避免列表把大 JSON 一起读出来） */
    imageRaw: [],
  };
}

/**
 * 容错迁移：补齐缺失字段、丢弃结构不对的集合。
 * 只做向后兼容的最小修补，不做破坏性转换。
 */
export function migrate(raw, dataDir) {
  const base = defaultDb(dataDir);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;

  const settings = { ...base.settings, ...(isObject(raw.settings) ? raw.settings : {}) };
  settings.scanPaths = {
    nai: Array.isArray(raw.settings?.scanPaths?.nai) ? raw.settings.scanPaths.nai.filter((p) => typeof p === 'string') : [],
    comfyui: Array.isArray(raw.settings?.scanPaths?.comfyui)
      ? raw.settings.scanPaths.comfyui.filter((p) => typeof p === 'string')
      : [],
  };
  settings.translation = { ...defaultTranslationSettings(), ...(isObject(raw.settings?.translation) ? raw.settings.translation : {}) };
  settings.dataDir = dataDir;

  const folders = (Array.isArray(raw.folders) ? raw.folders.filter(isObject) : []).map((folder) => ({
    ...folder,
    // v1 只有 Prompt 文件夹；v2 起区分 prompt / image，v5 增加 rp
    scope: folder.scope === 'image' ? 'image' : folder.scope === 'rp' ? 'rp' : 'prompt',
  }));

  const tagAliases = (Array.isArray(raw.tagAliases) ? raw.tagAliases.filter(isObject) : [])
    .map((entry) => ({
      alias: normalizeTagKey(entry.alias),
      canonical: normalizeTagKey(entry.canonical),
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : null,
    }))
    .filter((entry) => entry.alias && entry.canonical && entry.alias !== entry.canonical);

  const tagHistory = (Array.isArray(raw.tagHistory) ? raw.tagHistory.filter(isObject) : []).slice(-20);

  const characters = (Array.isArray(raw.characters) ? raw.characters.filter(isObject) : []).map((card) => ({
    ...card,
    tags: Array.isArray(card.tags) ? card.tags.filter((tag) => typeof tag === 'string') : [],
    settings: typeof card.settings === 'string' ? card.settings : '',
    description: typeof card.description === 'string' ? card.description : '',
    prompt: typeof card.prompt === 'string' ? card.prompt : '',
    folderId: typeof card.folderId === 'string' && card.folderId ? card.folderId : null,
    imageFile: typeof card.imageFile === 'string' ? card.imageFile : null,
    imageHash: typeof card.imageHash === 'string' ? card.imageHash : null,
    imageExt: typeof card.imageExt === 'string' ? card.imageExt : null,
    originalName: typeof card.originalName === 'string' ? card.originalName : null,
    raw: card.raw && typeof card.raw === 'object' ? card.raw : null,
  }));

  const prompts = (Array.isArray(raw.prompts) ? raw.prompts.filter(isObject) : []).map((prompt) => ({
    ...prompt,
    // 每条 Prompt 可以挂一张示例图（来自图片库）
    exampleImageId:
      typeof prompt.exampleImageId === 'string' && prompt.exampleImageId ? prompt.exampleImageId : null,
  }));
  const tagCategories = normalizeCategories(raw.tagCategories);
  const categoryIds = new Set(tagCategories.map((category) => category.id));
  const tags = mergeCatalog(
    Array.isArray(raw.tags) ? raw.tags.map((value) => normalizeEntry(value, categoryIds)).filter(Boolean) : [],
    prompts,
  ).map((entry) => {
    if (entry.categorySource === 'guess' || !categoryIds.has(entry.category)) {
      return { ...entry, category: guessTagCategory(entry.tag) };
    }
    return entry;
  });

  // 原始元数据拆表：老数据里的 metadata.raw 迁到 imageRaw
  const imageRaw = (Array.isArray(raw.imageRaw) ? raw.imageRaw.filter(isObject) : [])
    .map((entry) => ({ id: entry.id, raw: entry.raw ?? null }))
    .filter((entry) => typeof entry.id === 'string' && entry.raw !== null);
  const images = (Array.isArray(raw.images) ? raw.images.filter(isObject) : []).map((image, index) => {
    const next = {
      ...image,
      // 手动排序用；旧数据按原索引补一个稳定值
      order: Number.isFinite(image.order) ? Number(image.order) : index,
      albumIds: Array.isArray(image.albumIds) ? image.albumIds.filter((id) => typeof id === 'string') : [],
    };
    if (next.metadata && typeof next.metadata === 'object' && 'raw' in next.metadata) {
      const { raw: legacyRaw, ...metadata } = next.metadata;
      next.metadata = metadata;
      if (legacyRaw !== null && legacyRaw !== undefined && !imageRaw.some((entry) => entry.id === image.id)) {
        imageRaw.push({ id: image.id, raw: legacyRaw });
      }
    }
    return next;
  });

  return {
    version: SCHEMA_VERSION,
    settings,
    folders,
    prompts,
    images,
    albums: (Array.isArray(raw.albums) ? raw.albums.filter(isObject) : []).map((album, index) => ({
      ...album,
      order: Number.isFinite(album.order) ? Number(album.order) : index,
    })),
    tags,
    tagCategories,
    tagAliases,
    characters,
    tagHistory,
    imageRaw,
  };
}

/** 已有条目优先，缺的从 Prompt 分块补齐（幂等） */
export function mergeCatalog(existing, prompts) {
  const map = new Map();
  for (const entry of existing) {
    if (!map.has(entry.tag)) map.set(entry.tag, entry);
  }
  for (const prompt of prompts) {
    for (const text of segmentTagTexts(prompt.segments)) {
      const key = normalizeTagKey(text);
      if (!key || map.has(key)) continue;
      map.set(key, {
        tag: key,
        category: guessTagCategory(key),
        categorySource: 'guess',
        translation: '',
        translationSource: 'none',
        reviewed: false,
        postCount: null,
        updatedAt: null,
      });
    }
  }
  return [...map.values()];
}

export function normalizeEntry(value, categoryIds = new Set(TAG_CATEGORY_IDS)) {
  if (!isObject(value)) return null;
  const tag = normalizeTagKey(value.tag);
  if (!tag) return null;
  return {
    tag,
    category: categoryIds.has(value.category) ? value.category : guessTagCategory(tag),
    categorySource: CATEGORY_SOURCES.includes(value.categorySource) ? value.categorySource : 'guess',
    translation: typeof value.translation === 'string' ? value.translation.slice(0, 200) : '',
    translationSource: TRANSLATION_SOURCES.includes(value.translationSource) ? value.translationSource : 'none',
    reviewed: value.reviewed === true,
    postCount: Number.isFinite(value.postCount) ? Number(value.postCount) : null,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
  };
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


/**
 * 分类迁移：以内置分类为基线，合并用户自建分类与自定义排序。
 * - 内置分类始终存在（缺了补回来）；
 * - 自建分类保留 id / label / order；
 * - `unsorted` 固定兜底，不允许缺失。
 */
export function normalizeCategories(raw) {
  const map = new Map();
  TAG_CATEGORIES.forEach((category, index) => {
    map.set(category.id, { id: category.id, label: category.label, order: index, builtin: true });
  });
  const list = Array.isArray(raw) ? raw.filter(isObject) : [];
  for (const item of list) {
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id) continue;
    const existing = map.get(id);
    const label = typeof item.label === 'string' && item.label.trim() ? item.label.trim().slice(0, 24) : existing?.label;
    if (!label) continue;
    map.set(id, {
      id,
      label,
      order: Number.isFinite(item.order) ? Number(item.order) : (existing?.order ?? map.size),
      builtin: existing?.builtin === true,
    });
  }
  if (!map.has('unsorted')) {
    map.set('unsorted', { id: 'unsorted', label: '未分类', order: map.size, builtin: true });
  }
  return [...map.values()]
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'zh-Hans'))
    .map((category, index) => ({ ...category, order: index }));
}
