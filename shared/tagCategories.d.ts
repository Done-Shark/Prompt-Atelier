export type BuiltinTagCategoryId =
  | 'character'
  | 'copyright'
  | 'artist'
  | 'appearance'
  | 'clothing'
  | 'pose'
  | 'expression'
  | 'scene'
  | 'composition'
  | 'style'
  | 'meta'
  | 'unsorted';

/** 内置分类 + 用户自建分类（自建 id 形如 cat_xxx） */
export type TagCategoryId = BuiltinTagCategoryId | (string & {});

export interface TagCategory {
  id: TagCategoryId;
  label: string;
  order: number;
  builtin: boolean;
}

export const TAG_CATEGORIES: ReadonlyArray<{ id: BuiltinTagCategoryId; label: string }>;
export const TAG_CATEGORY_IDS: TagCategoryId[];
export function isTagCategory(id: unknown): id is TagCategoryId;
export function tagCategoryLabel(id: TagCategoryId): string;
export const SEGMENT_TO_TAG_CATEGORY: Record<string, TagCategoryId>;
export const DANBOORU_CATEGORY_MAP: Record<number, TagCategoryId>;
export function normalizeTagKey(raw: string): string;
export function displayTag(key: string): string;
export function guessTagCategory(raw: string): TagCategoryId;
