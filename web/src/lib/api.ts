/**
 * 唯一的 HTTP 出口。页面与 feature 不直接拼 URL、不直接 fetch。
 * 新增接口时先改 docs/API.md，再在这里加方法。
 */
import type {
  Album,
  AppSettings,
  CharacterCard,
  CharacterInput,
  TagAlias,
  TagCategory,
  BackupManifest,
  BootstrapPayload,
  CopyPayload,
  Folder,
  FolderScope,
  ImageListPayload,
  ImportImagesResult,
  ImportJob,
  LibraryImage,
  Prompt,
  PromptInput,
  PromptListPayload,
  ScanPreviewEntry,
  Stats,
  TagBatchResult,
  TagCategoryId,
  TagEntry,
  TagListPayload,
  TagLookupItem,
  Target,
  TargetFilter,
} from './types';

const BASE = '/api';

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {}),
      },
    });
  } catch {
    throw new ApiError('无法连接到本地服务，请确认后端已启动', 'NETWORK', 0);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = (payload as { error?: { message?: string; code?: string } } | null)?.error;
    throw new ApiError(error?.message || `请求失败（${response.status}）`, error?.code || 'HTTP_ERROR', response.status);
  }

  return payload as T;
}

function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export interface PromptQuery {
  q?: string;
  target?: TargetFilter;
  folderId?: string | null;
  tag?: string;
  favorite?: boolean;
  sort?: string;
  limit?: number;
  offset?: number;
}

export interface ImageQuery {
  target?: TargetFilter;
  q?: string;
  favorite?: boolean;
  folderId?: string | null;
  albumId?: string | null;
  sort?: 'imported' | 'name' | 'manual';
  limit?: number;
  offset?: number;
}

export interface TagQuery {
  q?: string;
  category?: TagCategoryId;
  status?: 'all' | 'translated' | 'pending' | 'reviewed' | 'unused';
  source?: 'none' | 'dictionary' | 'llm' | 'gemini' | 'manual';
  sort?: 'usage' | 'tag' | 'updated';
  limit?: number;
  offset?: number;
}

export const api = {
  health: () => request<{ ok: boolean; version: string; uptime: number }>('/health'),

  bootstrap: () => request<BootstrapPayload>('/bootstrap'),

  stats: () => request<Stats>('/stats'),

  prompts: {
    list: (query: PromptQuery = {}) =>
      request<PromptListPayload>(
        `/prompts${qs({
          q: query.q,
          target: query.target,
          folderId: query.folderId === null ? 'root' : query.folderId,
          tag: query.tag,
          favorite: query.favorite ? 1 : undefined,
          sort: query.sort,
          limit: query.limit,
          offset: query.offset,
        })}`,
      ),
    get: (id: string) => request<Prompt>(`/prompts/${id}`),
    create: (input: PromptInput) =>
      request<Prompt>('/prompts', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, patch: Partial<PromptInput>) =>
      request<Prompt>(`/prompts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    remove: (id: string) => request<{ ok: boolean }>(`/prompts/${id}`, { method: 'DELETE' }),
    duplicate: (id: string) => request<Prompt>(`/prompts/${id}/duplicate`, { method: 'POST' }),
    markUsed: (id: string) => request<Prompt>(`/prompts/${id}/use`, { method: 'POST' }),
    copy: (id: string, format: Target, mode?: 'workflow') =>
      request<CopyPayload>(`/prompts/${id}/copy${qs({ format, mode })}`),
    importMany: (data: unknown, folderId?: string | null) =>
      request<{ imported: number; skipped: { index: number; reason: string }[] }>('/prompts/import', {
        method: 'POST',
        body: JSON.stringify({ data, folderId: folderId ?? null }),
      }),
    exportUrl: (query: { ids?: string[]; target?: TargetFilter; folderId?: string | null } = {}) =>
      `${BASE}/prompts/export${qs({
        ids: query.ids?.join(','),
        target: query.target,
        folderId: query.folderId ?? undefined,
      })}`,
  },

  backup: {
    export: (input: { targetDir: string }) =>
      request<{ path: string; bytes: number; manifest: BackupManifest }>('/backup/export', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    inspect: (input: { sourceDir: string }) =>
      request<{ path: string; manifest: BackupManifest; dataBytes: number }>('/backup/inspect', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    restore: (input: { sourceDir: string }) =>
      request<{ ok: boolean; counts: BackupManifest['counts']; exportedAt: string; safetyPath: string }>(
        '/backup/restore',
        { method: 'POST', body: JSON.stringify(input) },
      ),
  },

  characters: {
    list: (
      query: { q?: string; sort?: 'updated' | 'name'; folderId?: string; limit?: number; offset?: number } = {},
    ) =>
      request<{ items: CharacterCard[]; total: number }>(
        `/characters${qs({ q: query.q, sort: query.sort, folderId: query.folderId, limit: query.limit, offset: query.offset })}`,
      ),
    create: (input: CharacterInput) =>
      request<CharacterCard>('/characters', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, input: CharacterInput) =>
      request<CharacterCard>(`/characters/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    remove: (id: string) => request<{ ok: boolean }>(`/characters/${id}`, { method: 'DELETE' }),
    batchDelete: (ids: string[]) =>
      request<{ ok: boolean; deleted: number }>('/characters/batch-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
    batchMove: (ids: string[], folderId: string | null) =>
      request<{ ok: boolean; moved: number; folderId: string | null }>('/characters/batch-move', {
        method: 'POST',
        body: JSON.stringify({ ids, folderId }),
      }),
    importFiles: (files: { name: string; data: string }[]) =>
      request<{ imported: CharacterCard[]; skipped: { name: string; reason: string }[] }>('/characters/import', {
        method: 'POST',
        body: JSON.stringify({ files }),
      }),
    imageUrl: (id: string) => `${BASE}/characters/${id}/image`,
    thumbUrl: (id: string) => `${BASE}/characters/${id}/thumb`,
    saveThumb: (id: string, data: string) =>
      request<{ ok: boolean; bytes: number }>(`/characters/${id}/thumb`, {
        method: 'POST',
        body: JSON.stringify({ data }),
      }),
  },

  albums: {
    list: () => request<{ items: Album[]; total: number }>('/albums'),
    create: (input: { name: string }) =>
      request<Album>('/albums', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, patch: { name?: string; order?: number }) =>
      request<Album>(`/albums/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    remove: (id: string) =>
      request<{ ok: boolean; removed: number }>(`/albums/${id}`, { method: 'DELETE' }),
    reorder: (ids: string[]) =>
      request<{ ok: boolean; updated: number }>('/albums/reorder', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
    membership: (id: string, input: { ids: string[]; action: 'add' | 'remove' }) =>
      request<{ ok: boolean; updated: number; skipped: number }>(`/albums/${id}/images`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },

  folders: {
    list: (query: { scope?: FolderScope; target?: Target } = {}) =>
      request<{ items: Folder[]; total: number }>(`/folders${qs({ scope: query.scope, target: query.target })}`),
    create: (input: { name: string; parentId?: string | null; target?: TargetFilter; scope?: FolderScope }) =>
      request<Folder>('/folders', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, patch: { name?: string; parentId?: string | null; target?: TargetFilter }) =>
      request<Folder>(`/folders/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    remove: (id: string) =>
      request<{ ok: boolean; movedPrompts: number; movedImages: number }>(`/folders/${id}`, {
        method: 'DELETE',
      }),
    /** 拖动排序 / 拖动改父级；beforeId 为空表示放到同级末尾 */
    move: (id: string, input: { parentId: string | null; beforeId?: string | null }) =>
      request<{ ok: boolean; folder: Folder }>(`/folders/${id}/move`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },

  tagCategories: {
    list: () => request<{ items: TagCategory[] }>('/tag-categories'),
    create: (input: { label: string }) =>
      request<TagCategory>('/tag-categories', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, patch: { label: string }) =>
      request<TagCategory>(`/tag-categories/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    remove: (id: string) =>
      request<{ ok: boolean; moved: number }>(`/tag-categories/${id}`, { method: 'DELETE' }),
    reorder: (ids: string[]) =>
      request<{ ok: boolean; items: TagCategory[] }>('/tag-categories/reorder', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
  },

  tags: {
    list: (query: TagQuery = {}) =>
      request<TagListPayload>(
        `/tags${qs({
          q: query.q,
          category: query.category,
          status: query.status,
          source: query.source,
          sort: query.sort,
          limit: query.limit,
          offset: query.offset,
        })}`,
      ),
    update: (input: { tag: string; translation?: string; category?: TagCategoryId; reviewed?: boolean }) =>
      request<TagEntry>('/tags', { method: 'PATCH', body: JSON.stringify(input) }),
    history: () =>
      request<{ items: { id: string; label: string; createdAt: string }[] }>('/tags/history'),
    undo: () =>
      request<{ ok: boolean; id: string; label: string }>('/tags/undo', {
        method: 'POST',
        body: '{}',
      }),
    aliases: () => request<{ items: TagAlias[] }>('/tags/aliases'),
    deleteAlias: (alias: string) =>
      request<{ ok: boolean }>('/tags/aliases/delete', {
        method: 'POST',
        body: JSON.stringify({ alias }),
      }),
    rename: (input: { from: string; to: string; dryRun?: boolean }) =>
      request<{
        from: string;
        to: string;
        prompts: number;
        images: number;
        segments: number;
        positive: number;
        negative: number;
        tagAction: 'renamed' | 'merged' | 'alias-only';
        translation: string;
        category: string | null;
        dryRun?: boolean;
      }>('/tags/rename', { method: 'POST', body: JSON.stringify(input) }),
    findReplace: (input: {
      pattern: string;
      replacement: string;
      regex?: boolean;
      caseSensitive?: boolean;
      dryRun?: boolean;
      scope?: TagQuery;
    }) =>
      request<{
        dryRun?: boolean;
        total?: number;
        truncated?: boolean;
        matches?: { from: string; to: string; usage: number }[];
        skipped?: { from: string; to: string }[];
        renamed?: number;
        prompts?: number;
        images?: number;
      }>('/tags/find-replace', { method: 'POST', body: JSON.stringify(input) }),
    batchUpdate: (input: {
      tags: string[];
      patch: { translation?: string; category?: TagCategoryId; reviewed?: boolean };
    }) =>
      request<{ ok: boolean; updated: number; skipped: number }>('/tags/batch', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    lookup: (tags: string[]) =>
      request<{ items: TagLookupItem[] }>('/tags/lookup', {
        method: 'POST',
        body: JSON.stringify({ tags }),
      }),
    translate: (input: { provider?: 'dictionary' | 'llm' | 'gemini'; tags?: string[]; force?: boolean } = {}) =>
      request<TagBatchResult>('/tags/translate', { method: 'POST', body: JSON.stringify(input) }),
    sync: (input: { tags?: string[]; force?: boolean } = {}) =>
      request<TagBatchResult>('/tags/sync', { method: 'POST', body: JSON.stringify(input) }),
    syncCatalog: () =>
      request<{ added: number; total: number }>('/tags/sync-catalog', { method: 'POST' }),
    importDictionary: (input: { text: string; overwrite?: boolean }) =>
      request<{ total: number; updated: number; added: number; skipped: number; missing: number; format: string }>(
        '/tags/import-dictionary',
        { method: 'POST', body: JSON.stringify(input) },
      ),
    importPack: (data: unknown) =>
      request<{ imported: number; total: number }>('/tags/import', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    exportUrl: () => `${BASE}/tags/export`,
  },

  jobs: {
    importFolder: (input: {
      target: 'auto' | Target;
      path: string;
      recursive?: boolean;
      fallbackTarget?: Target;
      folderId?: string | null;
    }) =>
      request<ImportJob>('/jobs/import-folder', { method: 'POST', body: JSON.stringify(input) }),
    get: (id: string) => request<ImportJob>(`/jobs/${id}`),
  },

  images: {
    list: (query: ImageQuery = {}) =>
      request<ImageListPayload>(
        `/images${qs({
          target: query.target,
          q: query.q,
          favorite: query.favorite ? 1 : undefined,
          folderId: query.folderId === null ? 'root' : query.folderId,
          albumId: query.albumId ?? undefined,
          sort: query.sort,
          limit: query.limit,
          offset: query.offset,
        })}`,
      ),
    get: (id: string) => request<LibraryImage>(`/images/${id}`),
    fileUrl: (id: string) => `${BASE}/images/${id}/file`,
    thumbUrl: (id: string) => `${BASE}/images/${id}/thumb`,
    saveThumb: (id: string, data: string) =>
      request<{ ok: boolean; bytes: number }>(`/images/${id}/thumb`, {
        method: 'POST',
        body: JSON.stringify({ data }),
      }),
    reparse: (id: string) =>
      request<LibraryImage>(`/images/${id}/reparse`, { method: 'POST', body: '{}' }),
    update: (id: string, patch: { favorite?: boolean; tags?: string[]; folderId?: string | null }) =>
      request<LibraryImage>(`/images/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    remove: (id: string) => request<{ ok: boolean }>(`/images/${id}`, { method: 'DELETE' }),
    batch: (input: {
      ids: string[];
      action: 'move' | 'favorite' | 'delete';
      folderId?: string | null;
      favorite?: boolean;
    }) =>
      request<{ ok: boolean; updated: number; skipped: number; deleted: number }>('/images/batch', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    reorder: (input: {
      target: Target;
      folderId: string | null;
      ids: string[];
      beforeId?: string | null;
    }) =>
      request<{ ok: boolean; updated: number }>('/images/reorder', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    scan: (input: { target: 'auto' | Target; path: string; recursive?: boolean }) =>
      request<{ entries: ScanPreviewEntry[]; total: number }>('/images/scan', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    importFolder: (input: {
      target: 'auto' | Target;
      path: string;
      recursive?: boolean;
      fallbackTarget?: Target;
      folderId?: string | null;
    }) => request<ImportImagesResult>('/images/import', { method: 'POST', body: JSON.stringify(input) }),
    importFiles: (input: {
      target: 'auto' | Target;
      fallbackTarget?: Target;
      folderId?: string | null;
      files: { name: string; data: string }[];
    }) => request<ImportImagesResult>('/images/import', { method: 'POST', body: JSON.stringify(input) }),
    toPrompt: (id: string, body: { folderId?: string | null; tags?: string[] } = {}) =>
      request<Prompt>(`/images/${id}/to-prompt`, { method: 'POST', body: JSON.stringify(body) }),
  },

  settings: {
    get: () => request<AppSettings>('/settings'),
    update: (patch: Partial<AppSettings>) =>
      request<AppSettings>('/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
  },
};

/** 触发浏览器下载（导出 JSON） */
export function downloadUrl(url: string, fallbackName: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fallbackName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('文件不是合法的 JSON', 'VALIDATION', 0);
  }
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new ApiError('读取文件失败', 'INTERNAL', 0));
    reader.readAsDataURL(file);
  });
}
