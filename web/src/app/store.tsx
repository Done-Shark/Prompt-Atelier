import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError, downloadUrl } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { targetShort } from '../lib/format';
import type {
  AppSettings,
  Album,
  Folder,
  FolderScope,
  Prompt,
  PromptInput,
  PromptParams,
  SortKey,
  Stats,
  Target,
  TargetFilter,
  TagCategory,
} from '../lib/types';
import type { ToastMessage } from '../components/ui';

export type FolderFilter = 'all' | 'root' | string;

export interface PromptFilters {
  q: string;
  target: TargetFilter;
  folderId: FolderFilter;
  tag: string | null;
  favorite: boolean;
  sort: SortKey;
}

export const DEFAULT_FILTERS: PromptFilters = {
  q: '',
  target: 'all',
  folderId: 'all',
  tag: null,
  favorite: false,
  sort: 'updated',
};

/** 单页条数；更多记录通过「加载更多」按 offset 追加 */
const PAGE_SIZE = 120;

interface StoreValue {
  ready: boolean;
  bootError: string | null;
  version: string;
  settings: AppSettings | null;
  formats: Record<Target, PromptParams> | null;
  folders: Folder[];
  albums: Album[];
  tags: string[];
  tagCategories: TagCategory[];
  reloadCategories: () => Promise<void>;
  stats: Stats | null;
  prompts: Prompt[];
  promptTotal: number;
  promptsLoading: boolean;
  filters: PromptFilters;
  selectedId: string | null;
  selected: Prompt | null;
  toasts: ToastMessage[];
  editor: { open: boolean; promptId: string | null };
  openEditor: (promptId?: string | null) => void;
  closeEditor: () => void;
  setFilters: (patch: Partial<PromptFilters>) => void;
  resetFilters: () => void;
  selectPrompt: (id: string | null) => void;
  refresh: () => Promise<void>;
  reloadPrompts: () => Promise<void>;
  loadMorePrompts: () => Promise<void>;
  savePrompt: (input: PromptInput, id?: string) => Promise<Prompt>;
  deletePrompt: (id: string) => Promise<void>;
  duplicatePrompt: (id: string) => Promise<void>;
  toggleFavorite: (prompt: Prompt) => Promise<void>;
  copyPrompt: (prompt: Prompt, format: Target, mode?: 'workflow') => Promise<void>;
  createFolder: (input: {
    name: string;
    parentId?: string | null;
    target?: TargetFilter;
    scope?: FolderScope;
  }) => Promise<Folder>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  /** 拖动排序 / 拖动改父级；beforeId 为空表示放到同级末尾 */
  moveFolder: (id: string, input: { parentId: string | null; beforeId?: string | null }) => Promise<void>;
  /** 设置 Prompt 的示例图；null 表示移除 */
  setPromptExampleImage: (id: string, imageId: string | null) => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  importPrompts: (data: unknown) => Promise<{ imported: number; skipped: number }>;
  exportPrompts: () => void;
  toast: (text: string, tone?: 'ok' | 'error') => void;
  dismissToast: (id: number) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore 必须在 AppProvider 内使用');
  return value;
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return '操作失败';
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [version, setVersion] = useState('');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [formats, setFormats] = useState<Record<Target, PromptParams> | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagCategories, setTagCategories] = useState<TagCategory[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [promptTotal, setPromptTotal] = useState(0);
  const [promptsLoading, setPromptsLoading] = useState(false);
  const [filters, setFiltersState] = useState<PromptFilters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [editor, setEditor] = useState<{ open: boolean; promptId: string | null }>({
    open: false,
    promptId: null,
  });

  const toastId = useRef(0);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const promptsRef = useRef(prompts);
  promptsRef.current = prompts;

  const dismissToast = useCallback((id: number) => {
    setToasts((list) => list.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (text: string, tone: 'ok' | 'error' = 'ok') => {
      toastId.current += 1;
      const id = toastId.current;
      setToasts((list) => [...list.slice(-2), { id, text, tone }]);
      window.setTimeout(() => dismissToast(id), 3600);
    },
    [dismissToast],
  );

  const refreshMeta = useCallback(async () => {
    const payload = await api.bootstrap();
    setSettings(payload.settings);
    setFormats(payload.formats);
    setFolders(payload.folders);
    setAlbums(payload.albums ?? []);
    setTags(payload.tags);
    setTagCategories(payload.tagCategories ?? []);
    setStats(payload.stats);
    setVersion(payload.version);
  }, []);

  const reloadCategories = useCallback(async () => {
    const payload = await api.tagCategories.list();
    setTagCategories(payload.items);
  }, []);

  const loadPrompts = useCallback(async (next: PromptFilters, options: { append?: boolean } = {}) => {
    setPromptsLoading(true);
    const offset = options.append ? promptsRef.current.length : 0;
    try {
      const payload = await api.prompts.list({
        q: next.q.trim() || undefined,
        target: next.target,
        folderId: next.folderId === 'all' ? undefined : next.folderId,
        tag: next.tag ?? undefined,
        favorite: next.favorite || undefined,
        sort: next.sort,
        limit: PAGE_SIZE,
        offset,
      });
      if (options.append) {
        setPrompts((current) => {
          const known = new Set(current.map((item) => item.id));
          return [...current, ...payload.items.filter((item) => !known.has(item.id))];
        });
      } else {
        setPrompts(payload.items);
        setSelectedId((current) => {
          if (current && payload.items.some((item) => item.id === current)) return current;
          return payload.items[0]?.id ?? null;
        });
      }
      setPromptTotal(payload.total);
    } catch (error) {
      toast(messageOf(error), 'error');
    } finally {
      setPromptsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payload = await api.bootstrap();
        if (cancelled) return;
        setSettings(payload.settings);
        setFormats(payload.formats);
        setFolders(payload.folders);
    setAlbums(payload.albums ?? []);
        setTags(payload.tags);
        setTagCategories(payload.tagCategories ?? []);
        setStats(payload.stats);
        setVersion(payload.version);
        setReady(true);
      } catch (error) {
        if (!cancelled) setBootError(messageOf(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 筛选变化后重新拉取；搜索输入做 220ms 防抖
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(
      () => {
        void loadPrompts(filters);
      },
      filters.q ? 220 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [filters, ready, loadPrompts]);

  // 主题：跟随系统时监听系统变化
  useEffect(() => {
    const mode = settings?.theme ?? 'dark';
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    document.documentElement.dataset.reduceMotion = settings?.reduceMotion ? 'true' : 'false';
    if (mode === 'system') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
  }, [settings?.theme, settings?.reduceMotion]);

  const refresh = useCallback(async () => {
    try {
      await refreshMeta();
      await loadPrompts(filtersRef.current);
    } catch (error) {
      toast(messageOf(error), 'error');
    }
  }, [refreshMeta, loadPrompts, toast]);

  const reloadPrompts = useCallback(async () => {
    await loadPrompts(filtersRef.current);
  }, [loadPrompts]);

  const loadMorePrompts = useCallback(async () => {
    await loadPrompts(filtersRef.current, { append: true });
  }, [loadPrompts]);

  const setFilters = useCallback((patch: Partial<PromptFilters>) => {
    setFiltersState((current) => ({ ...current, ...patch }));
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState((current) => ({ ...DEFAULT_FILTERS, target: current.target, sort: current.sort }));
  }, []);

  const selectPrompt = useCallback((id: string | null) => setSelectedId(id), []);

  const openEditor = useCallback((promptId: string | null = null) => {
    setEditor({ open: true, promptId });
  }, []);

  const closeEditor = useCallback(() => {
    setEditor((current) => ({ ...current, open: false }));
  }, []);

  const savePrompt = useCallback(
    async (input: PromptInput, id?: string) => {
      const saved = id ? await api.prompts.update(id, input) : await api.prompts.create(input);
      await loadPrompts(filtersRef.current);
      await refreshMeta();
      setSelectedId(saved.id);
      return saved;
    },
    [loadPrompts, refreshMeta],
  );

  const deletePrompt = useCallback(
    async (id: string) => {
      await api.prompts.remove(id);
      setSelectedId(null);
      await loadPrompts(filtersRef.current);
      await refreshMeta();
    },
    [loadPrompts, refreshMeta],
  );

  const duplicatePrompt = useCallback(
    async (id: string) => {
      const copy = await api.prompts.duplicate(id);
      await loadPrompts(filtersRef.current);
      await refreshMeta();
      setSelectedId(copy.id);
      toast('已创建副本');
    },
    [loadPrompts, refreshMeta, toast],
  );

  const toggleFavorite = useCallback(
    async (prompt: Prompt) => {
      const next = await api.prompts.update(prompt.id, { favorite: !prompt.favorite });
      setPrompts((list) => list.map((item) => (item.id === next.id ? next : item)));
      setStats((current) =>
        current ? { ...current, favorites: current.favorites + (next.favorite ? 1 : -1) } : current,
      );
    },
    [],
  );

  const copyPrompt = useCallback(
    async (prompt: Prompt, format: Target, mode?: 'workflow') => {
      try {
        const payload = await api.prompts.copy(prompt.id, format, mode);
        await copyText(payload.text);
        const used = await api.prompts.markUsed(prompt.id);
        setPrompts((list) => list.map((item) => (item.id === used.id ? used : item)));
        toast(mode === 'workflow' ? '已复制 workflow JSON' : `已复制为 ${targetShort(format)} 文本`);
      } catch (error) {
        toast(messageOf(error), 'error');
      }
    },
    [toast],
  );

  /** 重新拉取文件夹（带 Prompt / 图片计数），避免新增后没有数量 */
  const refreshFolders = useCallback(async () => {
    const payload = await api.folders.list();
    setFolders(payload.items);
  }, []);

  const createFolder = useCallback(
    async (input: { name: string; parentId?: string | null; target?: TargetFilter; scope?: FolderScope }) => {
      const folder = await api.folders.create(input);
      await refreshFolders();
      return folder;
    },
    [refreshFolders],
  );

  const renameFolder = useCallback(
    async (id: string, name: string) => {
      await api.folders.update(id, { name });
      await refreshFolders();
    },
    [refreshFolders],
  );

  const moveFolder = useCallback(
    async (id: string, input: { parentId: string | null; beforeId?: string | null }) => {
      await api.folders.move(id, input);
      const payload = await api.folders.list();
      setFolders(payload.items);
    },
    [],
  );

  const setPromptExampleImage = useCallback(
    async (id: string, imageId: string | null) => {
      await api.prompts.update(id, { exampleImageId: imageId });
      await loadPrompts(filtersRef.current);
    },
    [loadPrompts],
  );

  const deleteFolder = useCallback(
    async (id: string) => {
      await api.folders.remove(id);
      await refreshMeta();
      if (filtersRef.current.folderId === id) setFiltersState((current) => ({ ...current, folderId: 'all' }));
      await loadPrompts(filtersRef.current);
    },
    [loadPrompts, refreshMeta],
  );

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const next = await api.settings.update(patch);
    setSettings(next);
  }, []);

  const importPrompts = useCallback(
    async (data: unknown) => {
      const result = await api.prompts.importMany(data);
      await loadPrompts(filtersRef.current);
      await refreshMeta();
      return { imported: result.imported, skipped: result.skipped.length };
    },
    [loadPrompts, refreshMeta],
  );

  const exportPrompts = useCallback(() => {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    downloadUrl(api.prompts.exportUrl(), `prompt-atelier-${stamp}.json`);
    toast('已导出 Prompt 备份');
  }, [toast]);

  const selected = prompts.find((item) => item.id === selectedId) ?? null;

  const value: StoreValue = {
    ready,
    bootError,
    version,
    settings,
    formats,
    folders,
    albums,
    tags,
    tagCategories,
    reloadCategories,
    stats,
    prompts,
    promptTotal,
    promptsLoading,
    filters,
    selectedId,
    selected,
    toasts,
    editor,
    openEditor,
    closeEditor,
    setFilters,
    resetFilters,
    selectPrompt,
    refresh,
    reloadPrompts,
    loadMorePrompts,
    savePrompt,
    deletePrompt,
    duplicatePrompt,
    toggleFavorite,
    copyPrompt,
    createFolder,
    renameFolder,
    deleteFolder,
    moveFolder,
    setPromptExampleImage,
    updateSettings,
    importPrompts,
    exportPrompts,
    toast,
    dismissToast,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
