import type { TagCategoryId } from './tagCategories.js';

export function lookupBuiltinTag(
  raw: string,
): { tag: string; translation: string; category: TagCategoryId } | null;

export function builtinTagCount(): number;

export function builtinTagKeys(): string[];
