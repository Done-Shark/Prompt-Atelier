import { useCallback, useEffect, useRef, useState } from 'react';
import { Bookmark, FolderInput, ImageOff, PanelLeft, Search, Star, Trash2, Upload } from 'lucide-react';
import { useStore } from '../../app/store';
import { api, fileToBase64 } from '../../lib/api';
import { targetLabel } from '../../lib/format';
import type { Folder, LibraryImage, Target } from '../../lib/types';
import { Button, ConfirmDialog, EmptyState, IconButton, Segmented, Spinner, TextInput } from '../../components/ui';
import { ImportDialog } from '../../components/ImportDialog';
import { ImageGrid, type Density } from './ImageGrid';
import { ImageFolderTree, type ImageFolderFilter } from './ImageFolderTree';
import { ImageAlbumList } from './ImageAlbumList';
import { AddToAlbumDialog } from './AddToAlbumDialog';
import { ImageViewer } from './ImageViewer';
import { CardContextMenu } from './CardContextMenu';
import { MoveToFolderDialog } from './MoveToFolderDialog';
import { hasFileDragData } from '../../lib/dnd';
import './gallery.css';

const PAGE_SIZE = 120;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return '操作失败';
}

interface GalleryPageProps {
  target: Target;
}

/**
 * 图片库单分区。NAI 与 ComfyUI 各自是独立模块：独立路由、独立文件夹树、独立筛选状态。
 */
export function GalleryPage({ target }: GalleryPageProps) {
  const { toast, refresh, albums } = useStore();

  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderFilter, setFolderFilter] = useState<ImageFolderFilter>('all');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sort, setSort] = useState<'imported' | 'name' | 'manual'>(() => {
    const saved = window.localStorage.getItem(`atelier:gallery:${target}:sort`);
    return saved === 'name' || saved === 'manual' ? saved : 'imported';
  });
  const [density, setDensity] = useState<Density>(() => {
    const saved = window.localStorage.getItem(`atelier:gallery:${target}:density`);
    return saved === 'compact' || saved === 'wide' ? saved : 'normal';
  });

  const [items, setItems] = useState<LibraryImage[]>([]);
  const [total, setTotal] = useState(0);
  const [allTotal, setAllTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LibraryImage | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [creatingId, setCreatingId] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchorRef = useRef<number | null>(null);
  const draggingRef = useRef<string[]>([]);
  const [ctxMenu, setCtxMenu] = useState<{ image: LibraryImage; x: number; y: number } | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [externalOver, setExternalOver] = useState(false);
  const [dropImporting, setDropImporting] = useState(false);
  const [albumFilter, setAlbumFilter] = useState<string | null>(null);
  const [albumDialogOpen, setAlbumDialogOpen] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [sidebarHidden, setSidebarHidden] = useState(
    () => window.localStorage.getItem(`atelier:gallery:${target}:sidebar`) === 'hidden',
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    window.localStorage.setItem(`atelier:gallery:${target}:sort`, sort);
  }, [target, sort]);

  useEffect(() => {
    window.localStorage.setItem(`atelier:gallery:${target}:density`, density);
  }, [target, density]);

  useEffect(() => {
    window.localStorage.setItem(`atelier:gallery:${target}:sidebar`, sidebarHidden ? 'hidden' : 'shown');
  }, [target, sidebarHidden]);

  const loadFolders = useCallback(async () => {
    try {
      const payload = await api.folders.list({ scope: 'image', target });
      setFolders(payload.items);
    } catch (cause) {
      toast(messageOf(cause), 'error');
    }
  }, [target, toast]);

  useEffect(() => {
    setFolders([]);
    setFolderFilter('all');
    setAlbumFilter(null);
    setQuery('');
    setDebouncedQuery('');
    setViewerIndex(null);
    setSelected(new Set());
    anchorRef.current = null;
    void loadFolders();
  }, [target, loadFolders]);

  const buildQuery = useCallback(
    (offset = 0) => ({
      target,
      q: debouncedQuery || undefined,
      albumId: albumFilter ?? undefined,
      folderId: folderFilter === 'all' ? undefined : folderFilter,
      sort,
      limit: PAGE_SIZE,
      offset,
    }),
    [target, debouncedQuery, albumFilter, folderFilter, sort],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.images
      .list(buildQuery())
      .then((payload) => {
        if (cancelled) return;
        setItems(payload.items);
        setTotal(payload.total);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageOf(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    api.images
      .list({ target, limit: 1 })
      .then((payload) => {
        if (!cancelled) setAllTotal(payload.total);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [buildQuery, target, reloadKey]);

  useEffect(() => {
    setViewerIndex(null);
    setSelected(new Set());
    anchorRef.current = null;
  }, [folderFilter, albumFilter, debouncedQuery, sort, reloadKey]);

  const reload = () => setReloadKey((value) => value + 1);

  /* ------------------------------ 多选 ------------------------------ */

  const toggleSelected = (id: string, checked?: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      const shouldAdd = checked ?? !next.has(id);
      if (shouldAdd) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectRange = (from: number, to: number) => {
    const start = Math.max(0, Math.min(from, to));
    const end = Math.min(items.length - 1, Math.max(from, to));
    setSelected((current) => {
      const next = new Set(current);
      for (let index = start; index <= end; index += 1) next.add(items[index].id);
      return next;
    });
  };

  const handleCardClick = (image: LibraryImage, index: number, event: React.MouseEvent) => {
    if (event.shiftKey) {
      event.preventDefault();
      selectRange(anchorRef.current ?? index, index);
      anchorRef.current = index;
      return;
    }
    if (event.ctrlKey || event.metaKey || selected.size > 0) {
      event.preventDefault();
      toggleSelected(image.id);
      anchorRef.current = index;
      return;
    }
    setViewerIndex(index);
  };

  const handleCheck = (image: LibraryImage, index: number, checked: boolean) => {
    toggleSelected(image.id, checked);
    anchorRef.current = index;
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null;
      const tag = element?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element?.isContentEditable) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && viewerIndex === null) {
        event.preventDefault();
        setSelected(new Set(items.map((item) => item.id)));
        return;
      }
      if (event.key === 'Escape' && selected.size) {
        setSelected(new Set());
        anchorRef.current = null;
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected.size && viewerIndex === null) {
        event.preventDefault();
        setBatchDeleteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [items, selected, viewerIndex]);

  /* ------------------------------ 批量操作 ------------------------------ */

  const runBatch = async (input: {
    ids: string[];
    action: 'move' | 'favorite' | 'delete';
    folderId?: string | null;
    favorite?: boolean;
  }) => {
    if (!input.ids.length) return;
    setBatchBusy(true);
    try {
      const result = await api.images.batch(input);
      if (input.action === 'delete') toast(`已删除 ${result.deleted} 张图片`);
      else if (input.action === 'move') {
        toast(
          result.skipped
            ? `已移动 ${result.updated} 张，${result.skipped} 张不在当前分区被跳过`
            : `已移动 ${result.updated} 张图片`,
        );
      } else {
        toast(input.favorite ? `已收藏 ${result.updated} 张` : `已取消收藏 ${result.updated} 张`);
      }
      setSelected(new Set());
      anchorRef.current = null;
      setMoveOpen(false);
      setBatchDeleteOpen(false);
      reload();
      await loadFolders();
      await refresh();
    } catch (cause) {
      toast(messageOf(cause), 'error');
    } finally {
      setBatchBusy(false);
    }
  };

  const moveImages = async (ids: string[], folderId: string | null) => {
    await runBatch({ ids, action: 'move', folderId });
  };

  const handleDropOnFolder = (folderId: string | null, ids: string[]) => {
    if (!ids.length) return;
    void moveImages(ids, folderId);
  };

  /** 从系统拖入图片：直接导入到目标文件夹（目标格式固定为当前模块） */
  const importDroppedFiles = async (folderId: string | null, files: File[]) => {
    const images = files.filter((file) => /\.(png|jpe?g|webp)$/i.test(file.name));
    if (!images.length) {
      toast('只支持 PNG / JPG / WebP 图片', 'error');
      return;
    }
    setDropImporting(true);
    try {
      const payloads = await Promise.all(
        images.map(async (file) => ({ name: file.name, data: await fileToBase64(file) })),
      );
      const result = await api.images.importFiles({
        target,
        fallbackTarget: target,
        folderId,
        files: payloads,
      });
      toast(
        `已导入 ${result.imported.length} 张${result.skipped.length ? `，跳过 ${result.skipped.length} 张` : ''}`,
      );
      await loadFolders();
      reload();
      await refresh();
    } catch (cause) {
      toast(messageOf(cause), 'error');
    } finally {
      setDropImporting(false);
    }
  };

  /* ------------------------------ 拖拽排序 ------------------------------ */

  const handleDropOnCard = async (targetId: string, after: boolean) => {
    const ids = draggingRef.current.filter((id) => id !== targetId);
    draggingRef.current = [];
    if (!ids.length) return;
    if (folderFilter === 'all') {
      toast('先进入一个文件夹，再拖动调整顺序', 'error');
      return;
    }
    const folderId = folderFilter === 'root' ? null : folderFilter;
    let beforeId: string | null = targetId;
    if (after) {
      const index = items.findIndex((item) => item.id === targetId);
      beforeId = null;
      for (let next = index + 1; next < items.length; next += 1) {
        if (!ids.includes(items[next].id)) {
          beforeId = items[next].id;
          break;
        }
      }
    }
    try {
      await api.images.reorder({ target, folderId, ids, beforeId });
      setSort('manual');
      toast(`已调整 ${ids.length} 张图片的位置`);
      reload();
    } catch (cause) {
      toast(messageOf(cause), 'error');
    }
  };

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const payload = await api.images.list(buildQuery(items.length));
      setItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...payload.items.filter((item) => !known.has(item.id))];
      });
      setTotal(payload.total);
    } catch (cause) {
      toast(messageOf(cause), 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  const clearFilters = () => {
    setQuery('');
    setDebouncedQuery('');
    setAlbumFilter(null);
    setFolderFilter('all');
  };

  const selectFolder = (value: ImageFolderFilter) => {
    setAlbumFilter(null);
    setFolderFilter(value);
  };

  const selectAlbum = (albumId: string | null) => {
    setAlbumFilter(albumId);
    setFolderFilter('all');
  };

  const createAlbum = async (name: string) => {
    try {
      await api.albums.create({ name });
      await refresh();
      toast('已创建相簿');
    } catch (cause) {
      toast(messageOf(cause), 'error');
      throw cause;
    }
  };

  const renameAlbum = async (id: string, name: string) => {
    try {
      await api.albums.update(id, { name });
      await refresh();
      toast('已重命名相簿');
    } catch (cause) {
      toast(messageOf(cause), 'error');
      throw cause;
    }
  };

  const deleteAlbum = async (id: string) => {
    try {
      await api.albums.remove(id);
      if (albumFilter === id) setAlbumFilter(null);
      await refresh();
      reload();
      toast('已删除相簿，图片仍在原文件夹');
    } catch (cause) {
      toast(messageOf(cause), 'error');
      throw cause;
    }
  };

  const changeAlbumMembership = async (albumId: string, action: 'add' | 'remove') => {
    if (!selected.size) return;
    try {
      const result = await api.albums.membership(albumId, { ids: [...selected], action });
      toast(action === 'add' ? `已加入相簿（${result.updated} 张）` : `已移出相簿（${result.updated} 张）`);
      setAlbumDialogOpen(false);
      setSelected(new Set());
      await refresh();
      if (albumFilter) reload();
    } catch (cause) {
      toast(messageOf(cause), 'error');
    }
  };

  const createFolder = async (name: string, parentId: string | null) => {
    try {
      await api.folders.create({ name, parentId, target, scope: 'image' });
      await loadFolders();
      toast('已创建文件夹');
    } catch (cause) {
      toast(messageOf(cause), 'error');
      throw cause;
    }
  };

  const renameFolder = async (id: string, name: string) => {
    try {
      await api.folders.update(id, { name });
      await loadFolders();
      toast('已重命名');
    } catch (cause) {
      toast(messageOf(cause), 'error');
      throw cause;
    }
  };

  const deleteFolder = async (id: string) => {
    try {
      await api.folders.remove(id);
      if (folderFilter === id) setFolderFilter('all');
      await loadFolders();
      reload();
      toast('已删除文件夹，图片回到未归档');
    } catch (cause) {
      toast(messageOf(cause), 'error');
      throw cause;
    }
  };

  /** 文件夹拖动：同父级内排序，或拖进另一个文件夹成为子级 */
  const moveFolder = async (id: string, moveTo: { parentId: string | null; beforeId: string | null }) => {
    try {
      await api.folders.move(id, moveTo);
      await loadFolders();
    } catch (cause) {
      toast(messageOf(cause), 'error');
    }
  };

  const reorderAlbums = async (ids: string[]) => {
    try {
      await api.albums.reorder(ids);
      await refresh();
    } catch (cause) {
      toast(messageOf(cause), 'error');
    }
  };

  const handleToggleFavorite = async (image: LibraryImage) => {    try {
      const next = await api.images.update(image.id, { favorite: !image.favorite });
      setItems((current) => current.map((item) => (item.id === next.id ? next : item)));
      void refresh();
    } catch (cause) {
      toast(messageOf(cause), 'error');
    }
  };

  const handleReparse = async (image: LibraryImage) => {
    const next = await api.images.reparse(image.id);
    setItems((current) => current.map((item) => (item.id === next.id ? next : item)));
    toast('已按当前解析器重新读取元数据');
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.images.remove(deleteTarget.id);
      toast('已删除图片');
      setDeleteTarget(null);
      setViewerIndex(null);
      reload();
      await loadFolders();
      await refresh();
    } catch (cause) {
      toast(messageOf(cause), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleCreatePrompt = async (image: LibraryImage) => {
    if (creatingId) return;
    setCreatingId(image.id);
    try {
      await api.images.toPrompt(image.id);
      toast('已从图片创建 Prompt');
      await refresh();
      setViewerIndex(null);
      window.location.hash = '#/prompts';
    } catch (cause) {
      toast(messageOf(cause), 'error');
    } finally {
      setCreatingId(null);
    }
  };

  const toggleCollapse = (id: string) => {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = folderFilter !== 'all' || Boolean(debouncedQuery) || Boolean(albumFilter);
  const label = targetLabel(target);
  const targetFolder = folderFilter !== 'all' && folderFilter !== 'root' ? folderFilter : null;

  return (
    <div className="workspace" data-sidebar={sidebarHidden ? 'hidden' : 'shown'}>
      <aside className="workspace__panel gallery-panel">
        <ImageFolderTree
          target={target}
          folders={folders}
          selected={folderFilter}
          total={allTotal}
          collapsed={collapsedFolders}
          onToggleCollapse={toggleCollapse}
          onCollapseAll={() => setCollapsedFolders(new Set(folders.map((folder) => folder.id)))}
          onExpandAll={() => setCollapsedFolders(new Set())}
          onSelect={selectFolder}
          onCreate={createFolder}
          onRename={renameFolder}
          onDelete={deleteFolder}
          onMoveFolder={(id, moveTo) => void moveFolder(id, moveTo)}
          onDropImages={handleDropOnFolder}
          onDropFiles={(folderId, files) => void importDroppedFiles(folderId, files)}
        />
        <ImageAlbumList
          albums={albums}
          selected={albumFilter}
          onSelect={selectAlbum}
          onCreate={createAlbum}
          onRename={renameAlbum}
          onDelete={deleteAlbum}
          onReorder={(ids) => void reorderAlbums(ids)}
        />
      </aside>

      <section className="workspace__main">
        <div className="gallery-toolbar">
          <IconButton
            label={sidebarHidden ? '显示侧栏' : '隐藏侧栏'}
            size="sm"
            aria-pressed={!sidebarHidden}
            onClick={() => setSidebarHidden((value) => !value)}
          >
            <PanelLeft size={14} />
          </IconButton>
          <span className="gallery-module">
            <span className={`gallery-module__dot gallery-module__dot--${target}`} aria-hidden="true" />
            {label}
          </span>
          {albumFilter ? (
            <span className="gallery-breadcrumb">
              <Bookmark size={12} />
              {albums.find((album) => album.id === albumFilter)?.name ?? '相簿'}
            </span>
          ) : null}

          <div className="gallery-search">
            <Search size={13} className="gallery-search__icon" />
            <TextInput
              type="search"
              className="gallery-search__input"
              placeholder={`搜索 ${label} 图片、正向或模型`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="搜索图片"
            />
          </div>

          <span className="toolbar__spacer" />
          <span className="toolbar__count">{total} 张</span>

          <Segmented
            label="图片排序"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'imported', label: '最近导入' },
              { value: 'name', label: '文件名' },
              { value: 'manual', label: '自定义' },
            ]}
          />

          <Segmented
            label="网格密度"
            value={density}
            onChange={setDensity}
            options={[
              { value: 'compact', label: '小' },
              { value: 'normal', label: '中' },
              { value: 'wide', label: '大' },
            ]}
          />

          <Button variant="primary" icon={<Upload size={13} />} onClick={() => setImportOpen(true)}>
            导入图片
          </Button>
        </div>

        {selected.size ? (
          <div className="gallery-batch">
            <span className="gallery-batch__count">已选 {selected.size} 张</span>
            <Button size="sm" variant="ghost" icon={<Star size={12} />} onClick={() => void runBatch({ ids: [...selected], action: 'favorite', favorite: true })}>
              收藏
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void runBatch({ ids: [...selected], action: 'favorite', favorite: false })}>
              取消收藏
            </Button>
            <Button size="sm" variant="ghost" icon={<FolderInput size={12} />} onClick={() => setMoveOpen(true)}>
              移动到…
            </Button>
            <Button size="sm" variant="ghost" icon={<Bookmark size={12} />} onClick={() => setAlbumDialogOpen(true)}>
              加入相簿…
            </Button>
            <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={() => setBatchDeleteOpen(true)}>
              删除
            </Button>
            <span className="toolbar__spacer" />
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              取消选择
            </Button>
          </div>
        ) : null}

        <div
          className="gallery-scroll"
          onDragOver={(event) => {
            if (!hasFileDragData(event.dataTransfer)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            setExternalOver(true);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            setExternalOver(false);
          }}
          onDrop={(event) => {
            if (!hasFileDragData(event.dataTransfer)) return;
            event.preventDefault();
            setExternalOver(false);
            const files = [...event.dataTransfer.files];
            if (files.length) void importDroppedFiles(targetFolder, files);
          }}
        >
          {externalOver || dropImporting ? (
            <div className="gallery-drop">
              <Upload size={22} />
              <span>
                {dropImporting
                  ? '正在导入…'
                  : `松手导入到「${folders.find((folder) => folder.id === targetFolder)?.name ?? '未归档'}」`}
              </span>
            </div>
          ) : null}
          {loading ? (
            <div className="gallery-loading">
              <Spinner />
              正在载入图片…
            </div>
          ) : error ? (
            <EmptyState
              icon={<ImageOff size={26} />}
              title="无法载入图片"
              text={error}
              action={
                <Button variant="secondary" onClick={reload}>
                  重试
                </Button>
              }
            />
          ) : items.length === 0 ? (
            filtered ? (
              <EmptyState
                icon={<Search size={26} />}
                title="没有匹配的图片"
                text="换个关键词，或清除当前筛选后再看。"
                action={
                  <Button variant="secondary" onClick={clearFilters}>
                    清除筛选
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<ImageOff size={26} />}
                title={`${label} 图库还是空的`}
                text={`从 ${label} 的输出目录导入，图片会按元数据自动归入这个分区；也可以先建一个文件夹再导入。`}
                action={
                  <Button variant="primary" icon={<Upload size={13} />} onClick={() => setImportOpen(true)}>
                    导入图片
                  </Button>
                }
              />
            )
          ) : (
            <>
              <ImageGrid
                items={items}
                density={density}
                groupByDate={sort === 'imported'}
                creatingId={creatingId}
                selected={selected}
                onToggleFavorite={handleToggleFavorite}
                onDelete={setDeleteTarget}
                onToPrompt={handleCreatePrompt}
                onCardClick={handleCardClick}
                onCheck={handleCheck}
                onContextMenu={(image, x, y) => setCtxMenu({ image, x, y })}
                onDragStart={(ids) => {
                  draggingRef.current = ids;
                }}
                onDragEnd={() => {
                  draggingRef.current = [];
                }}
                onDropOnCard={(targetId, after) => void handleDropOnCard(targetId, after)}
              />
              {items.length < total ? (
                <div className="gallery-more">
                  <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>
                    加载更多
                  </Button>
                  <span className="gallery-more__hint">还有 {total - items.length} 张</span>
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>

      {viewerIndex !== null && items[viewerIndex] ? (
        <ImageViewer
          items={items}
          index={viewerIndex}
          creating={creatingId === items[viewerIndex].id}
          onClose={() => setViewerIndex(null)}
          onIndexChange={setViewerIndex}
          onToggleFavorite={handleToggleFavorite}
          onCreatePrompt={handleCreatePrompt}
          onReparse={handleReparse}
        />
      ) : null}

      <AddToAlbumDialog
        open={albumDialogOpen}
        count={selected.size}
        albums={albums}
        currentAlbumId={albumFilter}
        onClose={() => setAlbumDialogOpen(false)}
        onAdd={(albumId) => void changeAlbumMembership(albumId, 'add')}
        onRemove={(albumId) => void changeAlbumMembership(albumId, 'remove')}
      />

      <MoveToFolderDialog
        open={moveOpen}
        count={selected.size}
        folders={folders}
        onClose={() => setMoveOpen(false)}
        onSelect={(folderId) => void moveImages([...selected], folderId)}
      />

      {ctxMenu ? (
        <CardContextMenu
          image={ctxMenu.image}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onOpen={() => {
            const index = items.findIndex((item) => item.id === ctxMenu.image.id);
            if (index >= 0) setViewerIndex(index);
          }}
          onToggleFavorite={() => void handleToggleFavorite(ctxMenu.image)}
          onMove={() => {
            setSelected(new Set([ctxMenu.image.id]));
            setMoveOpen(true);
          }}
          onAddToAlbum={() => {
            setSelected(new Set([ctxMenu.image.id]));
            setAlbumDialogOpen(true);
          }}
          onToPrompt={() => void handleCreatePrompt(ctxMenu.image)}
          onDelete={() => setDeleteTarget(ctxMenu.image)}
        />
      ) : null}

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        initialTarget={target}
        initialFolderId={targetFolder}
        initialFolderName={folders.find((folder) => folder.id === targetFolder)?.name ?? null}
        onImported={() => {
          reload();
          void loadFolders();
          void refresh();
        }}
      />

      <ConfirmDialog
        open={batchDeleteOpen}
        title={`删除 ${selected.size} 张图片`}
        message="图片会从图库移除，源目录中的文件不会被删除。"
        confirmLabel="删除"
        danger
        loading={batchBusy}
        onCancel={() => setBatchDeleteOpen(false)}
        onConfirm={() => void runBatch({ ids: [...selected], action: 'delete' })}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除图片"
        message={
          deleteTarget ? `「${deleteTarget.fileName}」将从图片库移除，源目录中的文件不会被删除。` : ''
        }
        confirmLabel="删除"
        danger
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
