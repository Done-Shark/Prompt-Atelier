import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Folder as FolderIcon,
  GripVertical,
  Inbox,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  Star,
  Trash2,
} from 'lucide-react';
import { useStore } from '../../app/store';
import type { Folder } from '../../lib/types';
import { Button, ConfirmDialog, IconButton, Menu, Modal, Select, TextInput } from '../../components/ui';
import { useRowDrag, type RowDropZone } from '../../lib/useRowDrag';

interface FolderDialogState {
  mode: 'create' | 'rename';
  folderId?: string;
  parentId?: string | null;
  name: string;
}

type FolderSortMode = 'order' | 'name' | 'count' | 'created';

const SORT_STORAGE_KEY = 'atelier:prompts:folder-sort';
const COLLAPSE_STORAGE_KEY = 'atelier:prompts:folder-collapsed';

function readCollapsed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function FolderTree() {
  const {
    folders,
    filters,
    setFilters,
    stats,
    createFolder,
    renameFolder,
    deleteFolder,
    moveFolder,
    toast,
  } = useStore();
  const [dialog, setDialog] = useState<FolderDialogState | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Folder | null>(null);
  const [sortMode, setSortMode] = useState<FolderSortMode>(() => {
    const saved = window.localStorage.getItem(SORT_STORAGE_KEY);
    return saved === 'name' || saved === 'count' || saved === 'created' ? saved : 'order';
  });
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);

  const promptFolders = useMemo(
    () => folders.filter((folder) => (folder.scope || 'prompt') === 'prompt'),
    [folders],
  );

  const tree = useMemo(() => {
    const byParent = new Map<string | null, Folder[]>();
    for (const folder of promptFolders) {
      const key = folder.parentId;
      byParent.set(key, [...(byParent.get(key) ?? []), folder]);
    }
    const compare = (a: Folder, b: Folder) => {
      if (sortMode === 'name') return a.name.localeCompare(b.name, 'zh-Hans');
      if (sortMode === 'count') {
        const diff = (b.promptTotal || 0) - (a.promptTotal || 0);
        return diff !== 0 ? diff : a.name.localeCompare(b.name, 'zh-Hans');
      }
      if (sortMode === 'created') return String(b.createdAt).localeCompare(String(a.createdAt));
      return a.order - b.order || a.name.localeCompare(b.name, 'zh-Hans');
    };
    for (const list of byParent.values()) list.sort(compare);
    return byParent;
  }, [promptFolders, sortMode]);

  const byId = useMemo(() => new Map(promptFolders.map((folder) => [folder.id, folder])), [promptFolders]);

  const persistCollapsed = (next: Set<string>) => {
    setCollapsed(next);
    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify([...next]));
  };

  const toggleCollapse = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    persistCollapsed(next);
  };

  const changeSort = (mode: FolderSortMode) => {
    setSortMode(mode);
    window.localStorage.setItem(SORT_STORAGE_KEY, mode);
  };

  const select = (folderId: 'all' | 'root' | string) => {
    setFilters({ folderId, favorite: false, tag: null });
  };

  const beforeIdFor = (parentId: string | null, targetId: string, zone: 'before' | 'after', sourceId: string) => {
    const list = (tree.get(parentId) ?? []).filter((item) => item.id !== sourceId);
    const index = list.findIndex((item) => item.id === targetId);
    if (index < 0) return null;
    return zone === 'before' ? list[index].id : (list[index + 1]?.id ?? null);
  };

  const handleDrop = async (sourceId: string, targetId: string | null, zone: RowDropZone) => {
    if (sortMode !== 'order') changeSort('order');
    let target: { parentId: string | null; beforeId: string | null } = { parentId: null, beforeId: null };
    if (targetId) {
      const folder = byId.get(targetId);
      if (!folder) return;
      if (zone === 'inside') {
        if (collapsed.has(targetId)) {
          const next = new Set(collapsed);
          next.delete(targetId);
          persistCollapsed(next);
        }
        target = { parentId: targetId, beforeId: null };
      } else {
        target = {
          parentId: folder.parentId,
          beforeId: beforeIdFor(folder.parentId, targetId, zone, sourceId),
        };
      }
    }
    try {
      await moveFolder(sourceId, target);
    } catch (error) {
      toast(error instanceof Error ? error.message : '移动失败', 'error');
    }
  };

  const { dragId, hint, overRoot, startDrag, shouldIgnoreClick } = useRowDrag({ onDrop: handleDrop });

  const submit = async () => {
    if (!dialog) return;
    const name = dialog.name.trim();
    if (!name) return;
    setSaving(true);
    try {
      if (dialog.mode === 'create') {
        await createFolder({ name, parentId: dialog.parentId ?? null });
        toast(dialog.parentId ? '已创建子文件夹' : '已创建文件夹');
        if (dialog.parentId) {
          const next = new Set(collapsed);
          next.delete(dialog.parentId);
          persistCollapsed(next);
        }
      } else if (dialog.folderId) {
        await renameFolder(dialog.folderId, name);
        toast('已重命名');
      }
      setDialog(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : '操作失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setSaving(true);
    try {
      await deleteFolder(pendingDelete.id);
      toast('已删除文件夹，其中的 Prompt 回到未归档');
      setPendingDelete(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : '删除失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const renderFolder = (folder: Folder) => {
    const children = tree.get(folder.id) ?? [];
    const isCollapsed = collapsed.has(folder.id);
    const zone = hint?.targetId === folder.id ? hint.zone : null;
    return (
      <div key={folder.id}>
        <div
          className="folder-row"
          data-drag-row={folder.id}
          data-active={filters.folderId === folder.id && !filters.favorite}
          data-drop-zone={zone ?? undefined}
          data-dragging={dragId === folder.id}
          onPointerDown={(event) => startDrag(event, folder.id)}
        >
          <span className="folder-row__grip" aria-hidden="true" title="拖动排序">
            <GripVertical size={11} />
          </span>
          {children.length ? (
            <button
              type="button"
              className="folder-row__caret"
              aria-label={isCollapsed ? '展开子文件夹' : '折叠子文件夹'}
              onClick={() => toggleCollapse(folder.id)}
            >
              {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </button>
          ) : (
            <span className="folder-row__caret" aria-hidden="true" />
          )}
          <button
            type="button"
            className="folder-row__main"
            onClick={() => {
              if (shouldIgnoreClick()) return;
              select(folder.id);
            }}
            title={folder.name}
          >
            <FolderIcon size={13} className="folder-row__icon" />
            <span className="folder-row__name">{folder.name}</span>
            {typeof folder.promptTotal === 'number' ? (
              <span className="folder-row__count">{folder.promptTotal}</span>
            ) : null}
          </button>
          <Menu
            trigger={
              <IconButton label="文件夹操作" size="sm" className="folder-row__more">
                <MoreHorizontal size={13} />
              </IconButton>
            }
            items={[
              {
                label: '新建子文件夹',
                icon: <Plus size={12} />,
                onSelect: () => setDialog({ mode: 'create', parentId: folder.id, name: '' }),
              },
              {
                label: '重命名',
                icon: <Pencil size={12} />,
                onSelect: () => setDialog({ mode: 'rename', folderId: folder.id, name: folder.name }),
              },
              {
                label: '移到根级',
                icon: <Layers size={12} />,
                disabled: folder.parentId === null,
                onSelect: () => void moveFolder(folder.id, { parentId: null, beforeId: null }),
              },
              {
                label: '删除',
                icon: <Trash2 size={12} />,
                danger: true,
                separatorBefore: true,
                onSelect: () => setPendingDelete(folder),
              },
            ]}
          />
        </div>
        {!isCollapsed ? children.map((child) => renderFolder(child)) : null}
      </div>
    );
  };

  return (
    <div className="folder-tree">
      <div className="panel-head">
        <span className="panel-head__title">文件夹</span>
        <IconButton
          label="全部折叠"
          size="sm"
          onClick={() => persistCollapsed(new Set(promptFolders.map((folder) => folder.id)))}
        >
          <ChevronsDownUp size={13} />
        </IconButton>
        <IconButton label="全部展开" size="sm" onClick={() => persistCollapsed(new Set())}>
          <ChevronsUpDown size={13} />
        </IconButton>
        <IconButton label="新建文件夹" size="sm" onClick={() => setDialog({ mode: 'create', name: '' })}>
          <Plus size={14} />
        </IconButton>
      </div>

      <div className="folder-tree__sort">
        <Select
          value={sortMode}
          aria-label="文件夹排序"
          options={[
            { value: 'order', label: '手动顺序（可拖动）' },
            { value: 'name', label: '按名称' },
            { value: 'count', label: '按数量' },
            { value: 'created', label: '按创建时间' },
          ]}
          onChange={(event) => changeSort(event.target.value as FolderSortMode)}
        />
      </div>

      <div className="folder-tree__list">
        <button
          type="button"
          className="folder-row__main folder-row__main--fixed"
          data-active={filters.folderId === 'all' && !filters.favorite}
          onClick={() => select('all')}
        >
          <Layers size={13} className="folder-row__icon" />
          <span className="folder-row__name">全部 Prompt</span>
          <span className="folder-row__count">{stats?.prompts ?? 0}</span>
        </button>
        <button
          type="button"
          className="folder-row__main folder-row__main--fixed"
          data-active={filters.favorite}
          onClick={() => setFilters({ favorite: true, folderId: 'all', tag: null })}
        >
          <Star size={13} className="folder-row__icon" />
          <span className="folder-row__name">收藏</span>
          <span className="folder-row__count">{stats?.favorites ?? 0}</span>
        </button>
        <button
          type="button"
          className="folder-row__main folder-row__main--fixed"
          data-active={filters.folderId === 'root' && !filters.favorite}
          data-drag-root="true"
          onClick={() => select('root')}
        >
          <Inbox size={13} className="folder-row__icon" />
          <span className="folder-row__name">未归档</span>
        </button>

        <div className="folder-tree__divider" />
        {(tree.get(null) ?? []).map((folder) => renderFolder(folder))}
        {promptFolders.length === 0 ? (
          <p className="folder-tree__hint">用右上角 + 建一个文件夹，把 Prompt 按用途归类。</p>
        ) : null}

        <div className="folder-tree__rootdrop" data-drag-root="true" data-active={overRoot} aria-hidden="true">
          {dragId ? '拖到这里移到根级' : ''}
        </div>
      </div>

      <Modal
        open={Boolean(dialog)}
        onClose={() => setDialog(null)}
        title={
          dialog?.mode === 'rename' ? '重命名文件夹' : dialog?.parentId ? '新建子文件夹' : '新建文件夹'
        }
        size="sm"
        dismissable={!saving}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)} disabled={saving}>
              取消
            </Button>
            <Button variant="primary" onClick={submit} loading={saving} disabled={!dialog?.name.trim()}>
              保存
            </Button>
          </>
        }
      >
        <TextInput
          autoFocus
          value={dialog?.name ?? ''}
          placeholder="文件夹名称"
          aria-label="文件夹名称"
          onChange={(event) => setDialog((current) => (current ? { ...current, name: event.target.value } : current))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
          }}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除文件夹"
        message={`「${pendingDelete?.name ?? ''}」将被删除，里面的 Prompt 会回到未归档，不会被删除。`}
        confirmLabel="删除"
        danger
        loading={saving}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
