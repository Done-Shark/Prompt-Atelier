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
  Trash2,
} from 'lucide-react';
import type { Folder } from '../../lib/types';
import { Button, ConfirmDialog, IconButton, Menu, Modal, TextInput } from '../../components/ui';
import { useRowDrag, type RowDropZone } from '../../lib/useRowDrag';
import './rp.css';

export type RpFolderFilter = 'all' | 'root' | string;

interface RpFolderTreeProps {
  folders: Folder[];
  selected: RpFolderFilter;
  total: number;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onSelect: (value: RpFolderFilter) => void;
  onCreate: (name: string, parentId: string | null) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onMove: (id: string, target: { parentId: string | null; beforeId: string | null }) => Promise<void>;
  /** 正在被拖到哪个文件夹上（用于高亮） */
  cardOver?: string | null;
}

interface DialogState {
  mode: 'create' | 'rename';
  folderId?: string;
  parentId?: string | null;
  name: string;
}

/** RP 角色卡的文件夹树：固定手动顺序，拖动排序 / 拖进子级 */
export function RpFolderTree({
  folders,
  selected,
  total,
  collapsed,
  onToggleCollapse,
  onCollapseAll,
  onExpandAll,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onMove,
  cardOver = null,
}: RpFolderTreeProps) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Folder | null>(null);

  const tree = useMemo(() => {
    const map = new Map<string | null, Folder[]>();
    for (const folder of folders) {
      map.set(folder.parentId, [...(map.get(folder.parentId) ?? []), folder]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-Hans'));
    }
    return map;
  }, [folders]);

  const byId = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);

  const beforeIdFor = (parentId: string | null, targetId: string, zone: 'before' | 'after', sourceId: string) => {
    const list = (tree.get(parentId) ?? []).filter((item) => item.id !== sourceId);
    const index = list.findIndex((item) => item.id === targetId);
    if (index < 0) return null;
    return zone === 'before' ? list[index].id : (list[index + 1]?.id ?? null);
  };

  const handleDrop = (sourceId: string, targetId: string | null, zone: RowDropZone) => {
    if (!targetId) {
      void onMove(sourceId, { parentId: null, beforeId: null });
      return;
    }
    const folder = byId.get(targetId);
    if (!folder) return;
    if (zone === 'inside') {
      if (collapsed.has(targetId)) onToggleCollapse(targetId);
      void onMove(sourceId, { parentId: targetId, beforeId: null });
      return;
    }
    void onMove(sourceId, {
      parentId: folder.parentId,
      beforeId: beforeIdFor(folder.parentId, targetId, zone, sourceId),
    });
  };

  const { dragId, hint, overRoot, startDrag, shouldIgnoreClick } = useRowDrag({ onDrop: handleDrop });

  const submit = async () => {
    if (!dialog) return;
    const name = dialog.name.trim();
    if (!name) return;
    setSaving(true);
    try {
      if (dialog.mode === 'create') await onCreate(name, dialog.parentId ?? null);
      else if (dialog.folderId) await onRename(dialog.folderId, name);
      setDialog(null);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setSaving(true);
    try {
      await onDelete(pendingDelete.id);
      setPendingDelete(null);
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
          className="ifolder-row"
          data-drag-row={folder.id}
          data-card-target={folder.id}
          data-card-over={cardOver === folder.id}
          data-active={selected === folder.id}
          data-drop-zone={zone ?? undefined}
          data-dragging={dragId === folder.id}
          onPointerDown={(event) => startDrag(event, folder.id)}
        >
          <span className="ifolder-row__grip" aria-hidden="true" title="拖动排序">
            <GripVertical size={11} />
          </span>
          {children.length ? (
            <button
              type="button"
              className="ifolder-row__caret"
              aria-label={isCollapsed ? '展开子文件夹' : '折叠子文件夹'}
              onClick={() => onToggleCollapse(folder.id)}
            >
              {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </button>
          ) : (
            <span className="ifolder-row__caret" aria-hidden="true" />
          )}
          <button
            type="button"
            className="ifolder-row__main"
            onClick={() => {
              if (shouldIgnoreClick()) return;
              onSelect(folder.id);
            }}
            title={folder.name}
          >
            <FolderIcon size={13} className="ifolder-row__icon" />
            <span className="ifolder-row__name">{folder.name}</span>
            {typeof folder.characterTotal === 'number' ? (
              <span className="ifolder-row__count">{folder.characterTotal}</span>
            ) : null}
          </button>
          <Menu
            trigger={
              <IconButton label="文件夹操作" size="sm" className="ifolder-row__more">
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
                onSelect: () => void onMove(folder.id, { parentId: null, beforeId: null }),
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
    <div className="ifolder rp-folders">
      <div className="panel-head">
        <span className="panel-head__title">文件夹</span>
        <IconButton label="全部折叠" size="sm" onClick={onCollapseAll}>
          <ChevronsDownUp size={13} />
        </IconButton>
        <IconButton label="全部展开" size="sm" onClick={onExpandAll}>
          <ChevronsUpDown size={13} />
        </IconButton>
        <IconButton label="新建文件夹" size="sm" onClick={() => setDialog({ mode: 'create', name: '' })}>
          <Plus size={14} />
        </IconButton>
      </div>

      <div className="ifolder__list">
        <button
          type="button"
          className="ifolder-row__main ifolder-row__main--fixed"
          data-active={selected === 'all'}
          onClick={() => onSelect('all')}
        >
          <Layers size={13} className="ifolder-row__icon" />
          <span className="ifolder-row__name">全部角色卡</span>
          <span className="ifolder-row__count">{total}</span>
        </button>
        <button
          type="button"
          className="ifolder-row__main ifolder-row__main--fixed"
          data-active={selected === 'root'}
          data-drag-root="true"
          data-card-target="root"
          data-card-over={cardOver === 'root'}
          onClick={() => onSelect('root')}
        >
          <Inbox size={13} className="ifolder-row__icon" />
          <span className="ifolder-row__name">未归档</span>
        </button>

        <div className="ifolder__divider" />
        {(tree.get(null) ?? []).map((folder) => renderFolder(folder))}
        {folders.length === 0 ? (
          <p className="ifolder__hint">用右上角 + 建一个文件夹，把角色卡按世界观或用途归档。</p>
        ) : null}

        <div
          className="ifolder__rootdrop"
          data-drag-root="true"
          data-card-target="root"
          data-card-over={cardOver === 'root'}
          data-active={overRoot}
          aria-hidden="true"
        >
          {dragId ? '拖到这里移到根级' : ''}
        </div>
      </div>

      <Modal
        open={Boolean(dialog)}
        onClose={() => setDialog(null)}
        title={dialog?.mode === 'rename' ? '重命名文件夹' : dialog?.parentId ? '新建子文件夹' : '新建文件夹'}
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
        message={`「${pendingDelete?.name ?? ''}」将被删除，里面的角色卡会回到未归档，不会被删除。`}
        confirmLabel="删除"
        danger
        loading={saving}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
