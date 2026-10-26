/**
 * 共享类型契约。后端（server/）用 JSDoc 引用同一份字段定义，改动时同步 docs/API.md。
 * Prompt 的结构化分块类型来自 shared/prompt/doc.js（前后端共用同一实现）。
 */
export type { PromptSegment, PromptTag, SegmentKind, PromptToken, TokenType } from '../../../shared/prompt/doc.js';
export type { TagCategory, TagCategoryId } from '../../../shared/tagCategories.js';
import type { PromptSegment } from '../../../shared/prompt/doc.js';
import type { TagCategory, TagCategoryId } from '../../../shared/tagCategories.js';

export type Target = 'nai' | 'comfyui';
export type TargetFilter = Target | 'all';
export type ThemeMode = 'dark' | 'light' | 'system';
export type SortKey = 'updated' | 'created' | 'title' | 'usage';

/* ------------------------------- Prompt ------------------------------- */

export interface NaiParams {
  model: string;
  sampler: string;
  steps: number;
  scale: number;
  cfgRescale: number;
  seed: number;
  width: number;
  height: number;
  ucPreset: number;
  qualityToggle: boolean;
  variety: boolean;
}

export interface ComfyLora {
  name: string;
  strength: number;
  clipStrength: number;
}

export interface ComfyParams {
  checkpoint: string;
  loras: ComfyLora[];
  sampler: string;
  scheduler: string;
  steps: number;
  cfg: number;
  seed: number;
  width: number;
  height: number;
  batch: number;
  /** ComfyUI API 格式 workflow；保存后可用于回填到 ComfyUI */
  workflow?: Record<string, unknown> | null;
}

export type PromptParams = NaiParams | ComfyParams;

export interface Prompt {
  id: string;
  title: string;
  target: Target;
  positive: string;
  negative: string;
  tags: string[];
  folderId: string | null;
  favorite: boolean;
  notes: string;
  params: PromptParams;
  /** 结构化语义块；positive 始终是它的序列化结果 */
  segments: PromptSegment[];
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  origin: 'manual' | 'image' | 'import';
  imageId: string | null;
  /** 示例图（来自图片库），显示在列表行左侧 */
  exampleImageId?: string | null;
}

export interface PromptInput {
  title?: string;
  target: Target;
  positive: string;
  negative?: string;
  tags?: string[];
  folderId?: string | null;
  favorite?: boolean;
  notes?: string;
  params?: Partial<NaiParams & ComfyParams> | Record<string, unknown>;
  segments?: PromptSegment[];
  origin?: Prompt['origin'];
  imageId?: string | null;
  exampleImageId?: string | null;
}

/* ------------------------------- Folder ------------------------------- */

export type FolderScope = 'prompt' | 'image' | 'rp';

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  /** prompt = 提示词文件夹；image = 图片文件夹（按目标格式隔离） */
  scope: FolderScope;
  target: TargetFilter;
  order: number;
  /** 图片文件夹直属的图片数量（仅 scope=image 时返回） */
  imageCount?: number;
  /** 含子文件夹的图片总数（仅 scope=image 时返回） */
  imageTotal?: number;
  /** Prompt 文件夹直属的 Prompt 数量（仅 scope=prompt 时返回） */
  promptCount?: number;
  /** 含子文件夹的 Prompt 总数（仅 scope=prompt 时返回） */
  promptTotal?: number;
  /** RP 角色卡数量（仅 scope=rp 时返回） */
  characterCount?: number;
  characterTotal?: number;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------- Tag 库 ------------------------------ */

export type TagCategorySource = 'guess' | 'danbooru' | 'llm' | 'manual';
export interface TagAlias {
  alias: string;
  canonical: string;
  createdAt: string | null;
}

export type TagTranslationSource = 'none' | 'dictionary' | 'llm' | 'gemini' | 'manual';

export interface TagEntry {
  tag: string;
  category: TagCategoryId;
  categorySource: TagCategorySource;
  translation: string;
  translationSource: TagTranslationSource;
  /** 人工修正过，自动翻译 / 分类默认跳过 */
  reviewed: boolean;
  postCount: number | null;
  updatedAt: string | null;
  /** 在 Prompt 分块里出现的次数 */
  usage: number;
  targets: Target[];
}

export interface TagStats {
  total: number;
  translated: number;
  pending: number;
  reviewed: number;
  byCategory: Partial<Record<TagCategoryId, number>>;
  builtin: number;
}

export interface TagListPayload {
  items: TagEntry[];
  total: number;
  stats: TagStats;
}

export interface TagLookupItem {
  tag: string;
  category: TagCategoryId;
  translation: string;
  reviewed: boolean;
  known: boolean;
}

export interface TagBatchResult {
  provider: string;
  updated: number;
  skipped: number;
  failed: number;
  message?: string;
  notFound?: number;
}

/* ------------------------------ Character ----------------------------- */

export interface CharacterCard {
  id: string;
  name: string;
  tags: string[];
  /** RP 设定：性格 + 场景 */
  settings: string;
  /** 简介：作者备注或描述摘要 */
  description: string;
  /** 可直接复制到 SillyTavern 的 Prompt */
  prompt: string;
  folderId: string | null;
  imageHash: string | null;
  imageFile: string | null;
  imageExt: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  imageBytes: number | null;
  originalName: string | null;
  source: 'manual' | 'png' | 'json';
  createdAt: string;
  updatedAt: string;
}

export interface BackupManifest {
  app: string;
  format: number;
  version: number;
  exportedAt: string;
  counts: {
    prompts: number;
    images: number;
    characters: number;
    tags: number;
    folders: number;
    albums: number;
  };
  secretsOmitted: string[];
}

export interface CharacterInput {
  name?: string;
  tags?: string[];
  settings?: string;
  description?: string;
  prompt?: string;
  folderId?: string | null;
  /** base64 原图（不带 data: 前缀也可以） */
  image?: string | null;
  originalName?: string | null;
  source?: CharacterCard['source'];
}

/* -------------------------------- Album ------------------------------- */

export interface Album {
  id: string;
  name: string;
  order: number;
  count: number;
  /** 收藏是系统相簿（id = favorites），不能改名或删除 */
  system: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/* -------------------------------- Image ------------------------------- */

export interface ImageMetadata {
  format: 'nai' | 'comfyui' | 'unknown';
  positive: string;
  negative: string;
  model: string | null;
  sampler: string | null;
  scheduler?: string | null;
  seed: number | null;
  steps: number | null;
  cfg: number | null;
  width: number | null;
  height: number | null;
  loras?: ComfyLora[];
  /** 原始元数据，详情页可展开查看 */
  raw?: unknown;
}

export interface LibraryImage {
  id: string;
  target: Target;
  fileName: string;
  ext: string;
  width: number | null;
  height: number | null;
  bytes: number;
  hash: string;
  folderId: string | null;
  /** 所属相簿（多对多，不影响文件夹归属） */
  albumIds: string[];
  tags: string[];
  favorite: boolean;
  metadata: ImageMetadata;
  promptId: string | null;
  importedAt: string;
  sourcePath: string | null;
  /** 手动排序值（同一目标 + 文件夹内递增） */
  order?: number;
}

/* ------------------------------- Settings ----------------------------- */

export interface TranslationSettings {
  provider: 'dictionary' | 'llm' | 'gemini';
  baseUrl: string;
  model: string;
  apiKey: string;
  autoTranslateOnImport: boolean;
  danbooruEnabled: boolean;
}

export interface AppSettings {
  theme: ThemeMode;
  defaultTarget: Target;
  scanPaths: { nai: string[]; comfyui: string[] };
  dataDir: string;
  copyWithParams: boolean;
  autoTagOnImport: boolean;
  reduceMotion: boolean;
  translation: TranslationSettings;
}

/* ------------------------------- API DTO ------------------------------ */

export interface Stats {
  prompts: number;
  naiPrompts: number;
  comfyPrompts: number;
  images: number;
  naiImages: number;
  comfyImages: number;
  favorites: number;
  folders: number;
  albums: number;
  tags: number;
}

export interface BootstrapPayload {
  settings: AppSettings;
  folders: Folder[];
  albums: Album[];
  tags: string[];
  tagCategories: TagCategory[];
  stats: Stats;
  version: string;
  /** 后端适配器提供的默认参数，前端表单以此初始化 */
  formats: Record<Target, PromptParams>;
}

export interface PromptListPayload {
  items: Prompt[];
  total: number;
}

export interface ImageListPayload {
  items: LibraryImage[];
  total: number;
}

export interface ImportJob {
  id: string;
  status: 'running' | 'done' | 'error';
  total: number;
  done: number;
  imported: number;
  skipped: number;
  errors: { path: string; reason: string }[];
  importedItems: LibraryImage[];
  error: string | null;
}

export interface ImportImagesResult {
  imported: LibraryImage[];
  skipped: { path: string; reason: string }[];
  scanned: number;
}

export interface ScanPreviewEntry {
  path: string;
  fileName: string;
  target: Target;
  alreadyImported: boolean;
  reason?: string;
}

export interface CopyPayload {
  text: string;
  format: Target;
}

export interface ApiErrorPayload {
  error: { message: string; code: string };
}
