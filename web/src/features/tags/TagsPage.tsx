import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Eraser,
  ExternalLink,
  Languages,
  Link2,
  ListTree,
  Lock,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Replace,
  Search,
  Sparkles,
  Tags as TagsIcon,
  Undo2,
  Unlock,
  Upload,
} from 'lucide-react';
import type { TagCategoryId } from '../../../../shared/tagCategories.js';
import { useStore } from '../../app/store';
import { api, downloadUrl, readJsonFile } from '../../lib/api';
import { copyText } from '../../lib/clipboard';
import { formatNumber } from '../../lib/format';
import type { TagEntry, TagListPayload, TagStats } from '../../lib/types';
import { Button, EmptyState, IconButton, Menu, Segmented, Select, Spinner, TextInput } from '../../components/ui';
import { RenameTagDialog } from './RenameTagDialog';
import { FindReplaceDialog } from './FindReplaceDialog';
import { AliasDialog } from './AliasDialog';
import { CategoryManagerDialog } from './CategoryManagerDialog';
import './tags.css';

type StatusFilter = 'all' | 'translated' | 'pending' | 'reviewed' | 'unused';
type SourceFilter = 'all' | 'none' | 'dictionary' | 'llm' | 'gemini' | 'manual';
type RowAction = 'copy-tag' | 'copy-zh' | 'translate' | 'clear' | 'lock' | 'find' | 'rename';

/** 行高固定，虚拟滚动按它计算偏移；改样式时要同步 */
const ROW_HEIGHT = 52;
const OVERSCAN = 8;

const SOURCE_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: '全部来源' },
  { value: 'manual', label: '人工' },
  { value: 'dictionary', label: '内置词典' },
  { value: 'llm', label: 'OpenAI 兼容' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'none', label: '未翻译' },
];

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待处理' },
  { value: 'translated', label: '已翻译' },
  { value: 'reviewed', label: '已修正' },
  { value: 'unused', label: '未使用' },
];

const TRANSLATION_SOURCE_LABEL: Record<string, string> = {
  none: '未翻译',
  dictionary: '内置词典',
  llm: '本地模型',
  gemini: 'Gemini',
  manual: '人工',
};

const CATEGORY_SOURCE_LABEL: Record<string, string> = {
  guess: '规则',
  danbooru: 'Danbooru',
  llm: '模型',
  manual: '人工',
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败';
}

export function TagsPage() {
  const { toast, settings, setFilters, tagCategories, reloadCategories } = useStore();
  const [payload, setPayload] = useState<TagListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState<'all' | TagCategoryId>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<'usage' | 'tag' | 'updated'>('usage');
  const [source, setSource] = useState<SourceFilter>('all');
  const [renameTag, setRenameTag] = useState<string | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [aliasOpen, setAliasOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const categoryOptions = useMemo(
    () => [
      { value: 'all', label: '全部分类' },
      ...tagCategories.map((category) => ({ value: category.id, label: category.label })),
    ],
    [tagCategories],
  );
  const [history, setHistory] = useState<{ id: string; label: string; createdAt: string }[]>([]);
  const [undoBusy, setUndoBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  const selectRefs = useRef(new Map<string, HTMLSelectElement>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const pendingFocusRef = useRef<{ tag: string; where: 'next' | 'category' } | null>(null);

  const provider = settings?.translation.provider ?? 'dictionary';

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  const queryOf = useCallback(
    (offset = 0) => ({
      q: debounced || undefined,
      category: category === 'all' ? undefined : category,
      status,
      source: source === 'all' ? undefined : source,
      sort,
      limit: 200,
      offset,
    }),
    [debounced, category, status, source, sort],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api.tags.list(queryOf());
      setPayload(next);
      setSelected((current) => {
        const valid = new Set(next.items.map((item) => item.tag));
        return new Set([...current].filter((tag) => valid.has(tag)));
      });
    } catch (cause) {
      toast(messageOf(cause), 'error');
    } finally {
      setLoading(false);
    }
  }, [queryOf, toast]);

  const refreshHistory = useCallback(async () => {
    try {
      const payload = await api.tags.history();
      setHistory(payload.items);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    void load();
    void refreshHistory();
  }, [load, refreshHistory]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => setViewportHeight(element.clientHeight || 600);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setScrollTop(0);
  }, [debounced, category, status, source, sort]);

  const handleChanged = async () => {
    await load();
    await refreshHistory();
  };

  const undo = async () => {
    if (!history.length) return;
    setUndoBusy(true);
    try {
      const result = await api.tags.undo();
      toast(`已撤销：${result.label}`);
      await handleChanged();
    } catch (error) {
      toast(messageOf(error), 'error');
    } finally {
      setUndoBusy(false);
    }
  };

  // 虚拟滚动：只渲染视口附近的行
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    payload?.items.length ?? 0,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );

  const stats: TagStats = payload?.stats ?? {
    total: 0,
    translated: 0,
    pending: 0,
    reviewed: 0,
    byCategory: {},
    builtin: 0,
  };

  const items = payload?.items ?? [];
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.tag));

  const applyLocal = (entry: TagEntry) => {
    setPayload((current) => {
      if (!current) return current;
      const previous = current.items.find((item) => item.tag === entry.tag);
      const items = current.items.map((item) => (item.tag === entry.tag ? { ...item, ...entry } : item));
      let translated = current.stats.translated;
      let pending = current.stats.pending;
      let reviewed = current.stats.reviewed;
      if (previous) {
        if (!previous.translation && entry.translation) {
          translated += 1;
          pending -= 1;
        }
        if (previous.translation && !entry.translation) {
          translated -= 1;
          pending += 1;
        }
        if (!previous.reviewed && entry.reviewed) reviewed += 1;
        if (previous.reviewed && !entry.reviewed) reviewed -= 1;
      }
      return { ...current, items, stats: { ...current.stats, translated, pending, reviewed } };
    });
  };

  const updateTag = async (
    tag: string,
    patch: { translation?: string; category?: TagCategoryId; reviewed?: boolean },
  ) => {
    try {
      const entry = await api.tags.update({ tag, ...patch });
      applyLocal(entry);
    } catch (cause) {
      toast(messageOf(cause), 'error');
      throw cause;
    }
  };

  const runBatch = async (mode: 'translate' | 'sync') => {
    const tags = selected.size ? [...selected] : undefined;
    setBusy(mode);
    try {
      const result =
        mode === 'translate' ? await api.tags.translate({ provider, tags }) : await api.tags.sync({ tags });
      if (result.message) toast(result.message);
      else toast(`已更新 ${result.updated} 条${result.failed ? `，${result.failed} 条未处理` : ''}`);
      setSelected(new Set());
      await load();
    } catch (cause) {
      toast(messageOf(cause), 'error');
    } finally {
      setBusy(null);
    }
  };

  /** 批量改一个字段：一次请求，服务端一个事务 */
  const batchPatch = async (
    patch: { translation?: string; category?: TagCategoryId; reviewed?: boolean },
    label: string,
  ) => {
    if (!selected.size) return;
    setBusy('batch');
    try {
      const result = await api.tags.batchUpdate({ tags: [...selected], patch });
      toast(`${label}：${result.updated} 条${result.skipped ? `，${result.skipped} 条跳过` : ''}`);
      setSelected(new Set());
      await handleChanged();
    } catch (cause) {
      toast(messageOf(cause), 'error');
    } finally {
      setBusy(null);
    }
  };

  const copySelected = async () => {
    if (!selected.size) return;
    try {
      await copyText([...selected].join(', '));
      toast(`已复制 ${selected.size} 个 tag`);
    } catch {
      toast('复制失败', 'error');
    }
  };

  /** Enter 跳到下一条、Tab 跳到分类；用 rAF 等 blur 之后再聚焦 */
  const jumpFrom = (tag: string, where: 'next' | 'category') => {
    const index = items.findIndex((item) => item.tag === tag);
    const targetTag = where === 'category' ? tag : items[index + 1]?.tag;
    if (!targetTag) return;
    const targetIndex = items.findIndex((item) => item.tag === targetTag);
    if (targetIndex < 0) return;

    // 目标行可能还没渲染：先把它滚进视口，再等一帧聚焦
    const element = scrollRef.current;
    if (element) {
      const top = targetIndex * ROW_HEIGHT;
      if (top < element.scrollTop || top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
        element.scrollTo({ top: Math.max(0, top - element.clientHeight / 2) });
        setScrollTop(Math.max(0, top - element.clientHeight / 2));
      }
    }
    pendingFocusRef.current = { tag: targetTag, where };
    window.setTimeout(() => {
      const pending = pendingFocusRef.current;
      if (!pending) return;
      pendingFocusRef.current = null;
      const ref = pending.where === 'category' ? selectRefs.current.get(pending.tag) : inputRefs.current.get(pending.tag);
      ref?.focus();
    }, 60);
  };

  const runRowAction = async (action: RowAction, item: TagEntry) => {
    if (action === 'copy-tag') {
      await copyText(item.tag);
      toast('已复制 tag');
      return;
    }
    if (action === 'copy-zh') {
      await copyText(item.translation);
      toast('已复制译文');
      return;
    }
    if (action === 'find') {
      setFilters({ tag: item.tag, folderId: 'all', favorite: false });
      window.location.hash = '#/prompts';
      return;
    }
    if (action === 'translate') {
      setBusy(`row:${item.tag}`);
      try {
        const result = await api.tags.translate({ provider, tags: [item.tag], force: true });
        if (result.updated) {
          toast('已翻译 1 条');
          await load();
        } else {
          toast(result.message || '没有可更新的内容');
        }
      } catch (cause) {
        toast(messageOf(cause), 'error');
      } finally {
        setBusy(null);
      }
      return;
    }
    if (action === 'clear') {
      await updateTag(item.tag, { translation: '' });
      return;
    }
    if (action === 'lock') {
      await updateTag(item.tag, { reviewed: !item.reviewed });
      return;
    }
    if (action === 'rename') {
      setRenameTag(item.tag);
    }
  };

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    setScrollTop(element.scrollTop);
    if (!payload || loadingMore || payload.items.length >= payload.total) return;
    const nearBottom = element.scrollTop + element.clientHeight > (payload.items.length - 20) * ROW_HEIGHT;
    if (nearBottom) void loadMore();
  };

  const loadMore = async () => {
    if (!payload || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await api.tags.list(queryOf(payload.items.length));
      setPayload((current) =>
        current
          ? { items: [...current.items, ...next.items], total: next.total, stats: next.stats }
          : next,
      );
    } catch (cause) {
      toast(messageOf(cause), 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  const setCategoryForSelected = (nextCategory: TagCategoryId) =>
    batchPatch({ category: nextCategory }, '已更新分类');

  const importFile = async (file: File) => {
    try {
      const data = await readJsonFile(file);
      const result = await api.tags.importPack(data);
      toast(`已导入 ${result.imported} 条`);
      await load();
    } catch (cause) {
      toast(messageOf(cause), 'error');
    }
  };

  const categoryStats = useMemo(() => stats.byCategory, [stats.byCategory]);

  return (
    <div className="tags-page">
      <div className="tags-inner">
        <header className="tags-head">
          <div>
            <h1 className="tags-title">Tag 库</h1>
            <p className="tags-desc">
              自动收录 Prompt 里的 tag，补齐分类与中文翻译。人工修正过的条目会锁定，不再被自动流程覆盖。
            </p>
          </div>
          <div className="tags-head__actions">
            <Button size="sm" variant="ghost" icon={<Upload size={13} />} onClick={() => fileRef.current?.click()}>
              导入
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Download size={13} />}
              onClick={() => {
                downloadUrl(api.tags.exportUrl(), 'tag-library.json');
                toast('已导出 Tag 库');
              }}
            >
              导出
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Undo2 size={13} />}
              loading={undoBusy}
              disabled={!history.length}
              onClick={() => void undo()}
              title={history.length ? `撤销：${history[0].label}` : '没有可撤销的操作'}
            >
              撤销
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<ListTree size={13} />}
              onClick={() => setCategoryOpen(true)}
              title="新增分类、重命名、拖动排序"
            >
              分类
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Link2 size={13} />}
              onClick={() => setAliasOpen(true)}
              title="查看 / 删除改名留下的别名"
            >
              别名
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Replace size={13} />}
              onClick={() => setReplaceOpen(true)}
              title="对当前筛选结果批量查找替换 tag"
            >
              查找替换
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<RefreshCw size={13} />}
              loading={busy === 'sync'}
              onClick={() => void runBatch('sync')}
              title="从 Danbooru 同步分类与热度（已修正条目跳过）"
            >
              同步 Danbooru
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<Languages size={13} />}
              loading={busy === 'translate'}
              onClick={() => void runBatch('translate')}
              title={
                provider === 'dictionary'
                  ? '使用内置词典翻译'
                  : provider === 'gemini'
                    ? '使用 Gemini 翻译'
                    : '使用本地模型翻译'
              }
            >
              {provider === 'dictionary' ? '词典翻译' : provider === 'gemini' ? 'Gemini 翻译' : '模型翻译'}
            </Button>
          </div>
        </header>

        <div className="tag-stats">
          <div className="tag-stat">
            <span className="tag-stat__value">{formatNumber(stats.total)}</span>
            <span className="tag-stat__label">收录 tag</span>
          </div>
          <div className="tag-stat">
            <span className="tag-stat__value">{formatNumber(stats.translated)}</span>
            <span className="tag-stat__label">已翻译</span>
          </div>
          <div className="tag-stat">
            <span className="tag-stat__value">{formatNumber(stats.pending)}</span>
            <span className="tag-stat__label">待处理</span>
          </div>
          <div className="tag-stat">
            <span className="tag-stat__value">{formatNumber(stats.reviewed)}</span>
            <span className="tag-stat__label">已修正</span>
          </div>
          <div className="tag-stat tag-stat--hint">
            <span className="tag-stat__value">{formatNumber(stats.builtin)}</span>
            <span className="tag-stat__label">内置词典</span>
          </div>
        </div>

        <div className="tag-toolbar">
          <div className="tags-search">
            <Search size={14} className="tags-search__icon" />
            <TextInput
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索 tag 或中文翻译"
              aria-label="搜索 tag"
            />
          </div>
          <Select
            value={category}
            options={categoryOptions}
            aria-label="分类筛选"
            onChange={(event) => setCategory(event.target.value as 'all' | TagCategoryId)}
            style={{ width: 132 }}
          />
          <Select
            value={source}
            options={SOURCE_OPTIONS}
            aria-label="翻译来源筛选"
            onChange={(event) => setSource(event.target.value as SourceFilter)}
            style={{ width: 118 }}
          />
          <Segmented label="翻译状态" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          <Select
            value={sort}
            options={[
              { value: 'usage', label: '按使用次数' },
              { value: 'tag', label: '按字母' },
              { value: 'updated', label: '按更新时间' },
            ]}
            aria-label="排序"
            onChange={(event) => setSort(event.target.value as 'usage' | 'tag' | 'updated')}
            style={{ width: 122 }}
          />
        </div>

        {selected.size ? (
          <div className="tag-batch">
            <span>已选 {selected.size} 条</span>
            <Button
              size="sm"
              variant="ghost"
              icon={<Languages size={12} />}
              loading={busy === 'translate'}
              onClick={() => void runBatch('translate')}
            >
              翻译选中
            </Button>
            <Menu
              trigger={
                <Button size="sm" variant="ghost" loading={busy === 'batch'}>
                  设置分类
                </Button>
              }
              items={tagCategories.map((entry) => ({
                label: entry.label,
                onSelect: () => void setCategoryForSelected(entry.id),
              }))}
            />
            <Button
              size="sm"
              variant="ghost"
              icon={<Check size={12} />}
              loading={busy === 'batch'}
              onClick={() => void batchPatch({ reviewed: true }, '已锁定')}
            >
              锁定
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Unlock size={12} />}
              loading={busy === 'batch'}
              onClick={() => void batchPatch({ reviewed: false }, '已取消锁定')}
            >
              取消锁定
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Eraser size={12} />}
              loading={busy === 'batch'}
              onClick={() => void batchPatch({ translation: '' }, '已清空译文')}
            >
              清空译文
            </Button>
            <Button size="sm" variant="ghost" icon={<Copy size={12} />} onClick={() => void copySelected()}>
              复制
            </Button>
            <span className="toolbar__spacer" />
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              取消选择
            </Button>
          </div>
        ) : null}

        {loading && !payload ? (
          <div className="tags-loading">
            <Spinner />
            正在载入 Tag 库…
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<TagsIcon size={26} />}
            title={stats.total ? '没有匹配的 tag' : 'Tag 库还是空的'}
            text={
              stats.total ? '换个关键词或分类试试。' : '保存 Prompt 后，分块里的 tag 会自动收录到这里。'
            }
            action={
              stats.total ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQuery('');
                    setCategory('all');
                    setStatus('all');
                  }}
                >
                  清除筛选
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => (window.location.hash = '#/prompts')}>
                  去提示词库
                </Button>
              )
            }
          />
        ) : (
          <div className="tag-table" role="table" aria-label="Tag 库">
            <div className="tag-table__head" role="row">
              <span className="tag-table__check">
                <input
                  type="checkbox"
                  aria-label="全选已加载"
                  checked={allSelected}
                  onChange={(event) => {
                    setSelected(event.target.checked ? new Set(items.map((item) => item.tag)) : new Set());
                  }}
                />
              </span>
              <span>Tag / 中文翻译</span>
              <span>分类</span>
              <span className="tag-table__source-col">来源</span>
              <span className="tag-table__num">使用</span>
              <span className="tag-table__num">修正</span>
              <span className="tag-table__num" aria-hidden="true" />
            </div>

            <div className="tag-virtual" ref={scrollRef} onScroll={handleScroll}>
              <div className="tag-virtual__spacer" style={{ height: items.length * ROW_HEIGHT }}>
                {items.slice(startIndex, endIndex).map((item, offset) => (
                  <TagRow
                    key={item.tag}
                    item={item}
                    style={{ transform: `translateY(${(startIndex + offset) * ROW_HEIGHT}px)` }}
                    selected={selected.has(item.tag)}
                    busy={busy === `row:${item.tag}`}
                    onSelect={(checked) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (checked) next.add(item.tag);
                        else next.delete(item.tag);
                        return next;
                      })
                    }
                    onUpdate={(patch) => updateTag(item.tag, patch)}
                    onAction={(action) => void runRowAction(action, item)}
                    onJump={(where) => jumpFrom(item.tag, where)}
                    registerInput={(element) => {
                      if (element) inputRefs.current.set(item.tag, element);
                      else inputRefs.current.delete(item.tag);
                    }}
                    registerSelect={(element) => {
                      if (element) selectRefs.current.set(item.tag, element);
                      else selectRefs.current.delete(item.tag);
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {payload && payload.items.length < payload.total ? (
          <div className="tag-more">
            <span className="tag-more__hint">
              已加载 {payload.items.length} / {payload.total} 条，继续向下滚动会自动加载
            </span>
            <Button size="sm" variant="ghost" loading={loadingMore} onClick={() => void loadMore()}>
              加载更多
            </Button>
          </div>
        ) : null}

        {categoryStats && Object.keys(categoryStats).length ? (
          <p className="tag-footnote">
            分类分布：
            {tagCategories
              .filter((entry) => categoryStats[entry.id])
              .map((entry) => `${entry.label} ${categoryStats[entry.id]}`)
              .join(' · ')}
          </p>
        ) : null}
      </div>

      <RenameTagDialog
        open={Boolean(renameTag)}
        tag={renameTag ?? ''}
        onClose={() => setRenameTag(null)}
        onDone={() => void handleChanged()}
        onToast={toast}
      />

      <FindReplaceDialog
        open={replaceOpen}
        scope={{
          q: debounced || undefined,
          category: category === 'all' ? undefined : category,
          status,
          source: source === 'all' ? undefined : source,
        }}
        scopeCount={payload?.total ?? 0}
        onClose={() => setReplaceOpen(false)}
        onDone={() => void handleChanged()}
        onToast={toast}
      />

      <CategoryManagerDialog
        open={categoryOpen}
        categories={tagCategories}
        onClose={() => setCategoryOpen(false)}
        onChanged={async () => {
          await reloadCategories();
          await load();
        }}
        onToast={toast}
      />

      <AliasDialog
        open={aliasOpen}
        onClose={() => setAliasOpen(false)}
        onChanged={() => void handleChanged()}
        onPick={(tag) => {
          setQuery(tag);
          setStatus('all');
          setCategory('all');
          setSource('all');
        }}
        onToast={toast}
      />

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile(file);
          event.target.value = '';
        }}
      />
    </div>
  );
}

interface TagRowProps {
  item: TagEntry;
  style?: React.CSSProperties;
  selected: boolean;
  busy: boolean;
  onSelect: (checked: boolean) => void;
  onUpdate: (patch: { translation?: string; category?: TagCategoryId; reviewed?: boolean }) => Promise<void>;
  onAction: (action: RowAction) => void;
  onJump: (where: 'next' | 'category') => void;
  registerInput: (element: HTMLInputElement | null) => void;
  registerSelect: (element: HTMLSelectElement | null) => void;
}

function TagRow({
  item,
  style,
  selected,
  busy,
  onSelect,
  onUpdate,
  onAction,
  onJump,
  registerInput,
  registerSelect,
}: TagRowProps) {
  const { tagCategories } = useStore();
  const [draft, setDraft] = useState(item.translation);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    setDraft(item.translation);
  }, [item.translation]);

  const commit = async (value: string) => {
    const next = value.trim();
    if (next === item.translation || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await onUpdate({ translation: next });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // 输入停顿后自动保存，避免用户忘记失焦；失焦时立即补一次
  useEffect(() => {
    if (draft.trim() === item.translation) return;
    const timer = window.setTimeout(() => void commit(draft), 700);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, item.translation]);

  return (
    <div className="tag-table__row" role="row" data-reviewed={item.reviewed} data-tag={item.tag} style={style}>
      <span className="tag-table__check">
        <input
          type="checkbox"
          aria-label={`选择 ${item.tag}`}
          checked={selected}
          onChange={(event) => onSelect(event.target.checked)}
        />
      </span>
      <span className="tag-table__tag">
        <button
          type="button"
          className="tag-en mono"
          title="点击复制 tag"
          onClick={() => onAction('copy-tag')}
        >
          {item.tag}
          <Copy size={10} className="tag-copy" />
        </button>
        <input
          ref={registerInput}
          className="tag-input-inline tag-zh"
          value={draft}
          placeholder="待翻译"
          aria-label={`${item.tag} 的中文翻译`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit(draft)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void commit(draft);
              event.currentTarget.blur();
              onJump('next');
            }
            if (event.key === 'Tab' && !event.shiftKey) {
              event.preventDefault();
              void commit(draft);
              event.currentTarget.blur();
              onJump('category');
            }
            if (event.key === 'Escape') {
              setDraft(item.translation);
              event.currentTarget.blur();
            }
          }}
        />
        {saving ? <span className="tag-saving">…</span> : null}
      </span>
      <span ref={(element) => registerSelect(element?.querySelector('select') ?? null)}>
        <Select
          value={item.category}
          options={tagCategories.map((category) => ({ value: category.id, label: category.label }))}
          aria-label={`${item.tag} 的分类`}
          onChange={(event) => void onUpdate({ category: event.target.value as TagCategoryId })}
          className="tag-category-select"
        />
      </span>
      <span className="tag-table__source-col tag-table__source">
        <span className="tag-source" title="翻译来源">
          {TRANSLATION_SOURCE_LABEL[item.translationSource] || item.translationSource}
        </span>
        <span className="tag-source tag-source--muted" title="分类来源">
          {CATEGORY_SOURCE_LABEL[item.categorySource] || item.categorySource}
        </span>
      </span>
      <span className="tag-table__num mono">
        {item.usage ? (
          <button
            type="button"
            className="tag-usage"
            title="在提示词库中查看"
            onClick={() => onAction('find')}
          >
            {item.usage}
          </button>
        ) : (
          '—'
        )}
      </span>
      <span className="tag-table__num">
        <IconButton
          label={item.reviewed ? '取消已修正' : '标记为已修正'}
          size="sm"
          onClick={() => void onUpdate({ reviewed: !item.reviewed })}
        >
          {item.reviewed ? <Lock size={13} color="var(--accent)" /> : <Lock size={13} />}
        </IconButton>
      </span>
      <span className="tag-table__num">
        <Menu
          trigger={
            <IconButton label={`${item.tag} 更多操作`} size="sm">
              <MoreHorizontal size={13} />
            </IconButton>
          }
          items={[
            { label: '复制 Tag', icon: <Copy size={12} />, onSelect: () => onAction('copy-tag') },
            {
              label: '复制译文',
              icon: <Languages size={12} />,
              disabled: !item.translation,
              onSelect: () => onAction('copy-zh'),
            },
            {
              label: busy ? '翻译中…' : '翻译这一条',
              icon: <Sparkles size={12} />,
              disabled: busy,
              onSelect: () => onAction('translate'),
            },
            {
              label: '清空译文',
              icon: <Eraser size={12} />,
              disabled: !item.translation,
              onSelect: () => onAction('clear'),
            },
            {
              label: '重命名 / 合并…',
              icon: <Pencil size={12} />,
              onSelect: () => onAction('rename'),
            },
            {
              label: item.reviewed ? '取消锁定' : '锁定为已修正',
              icon: item.reviewed ? <Unlock size={12} /> : <Lock size={12} />,
              onSelect: () => onAction('lock'),
            },
            {
              label: '在提示词库中查看',
              icon: <ExternalLink size={12} />,
              separatorBefore: true,
              onSelect: () => onAction('find'),
            },
          ]}
        />
      </span>
    </div>
  );
}
