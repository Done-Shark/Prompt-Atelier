import { useState } from 'react';
import { Bookmark, GripVertical, MoreHorizontal, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import type { Album } from '../../lib/types';
import { Button, ConfirmDialog, IconButton, Menu, Modal, TextInput } from '../../components/ui';
import { useRowDrag, type RowDropZone } from '../../lib/useRowDrag';

interface ImageAlbumListProps {
  albums: Album[];
  selected: string | null;
  onSelect: (albumId: string | null) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReorder: (ids: string[]) => void;
}

interface DialogState {
  mode: 'create' | 'rename';
  id?: string;
  name: string;
}

/** 相簿列表：与文件夹互补，一张图可属于多个相簿；用户相簿可拖动排序 */
export function ImageAlbumList({
  albums,
  selected,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onReorder,
}: ImageAlbumListProps) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Album | null>(null);

  const moveAlbum = (sourceId: string, targetId: string | null, zone: RowDropZone) => {
    if (!targetId || sourceId === targetId) return;
    const ids = albums.filter((album) => !album.system).map((album) => album.id);
    const rest = ids.filter((id) => id !== sourceId);
    const index = rest.indexOf(targetId);
    if (index < 0) return;
    rest.splice(zone === 'before' ? index : index + 1, 0, sourceId);
    onReorder(rest);
  };

  const { dragId, hint, startDrag, shouldIgnoreClick } = useRowDrag({
    zones: ['before', 'after'],
    rootSelector: null,
    onDrop: moveAlbum,
  });

  const submit = async () => {
    if (!dialog) return;
    const name = dialog.name.trim();
    if (!name) return;
    setSaving(true);
    try {
      if (dialog.mode === 'create') await onCreate(name);
      else if (dialog.id) await onRename(dialog.id, name);
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

  return (
    <div className="ialbum">
      <div className="panel-head">
        <span className="panel-head__title">相簿</span>
        <IconButton label="新建相簿" size="sm" onClick={() => setDialog({ mode: 'create', name: '' })}>
          <Plus size={14} />
        </IconButton>
      </div>

      <div className="ialbum__list">
        {albums.map((album) => {
          const zone = hint?.targetId === album.id ? hint.zone : null;
          return (
            <div
              className="ifolder-row"
              key={album.id}
              data-active={selected === album.id}
              data-drag-row={album.system ? undefined : album.id}
              data-drop-zone={zone ?? undefined}
              data-dragging={dragId === album.id}
              onPointerDown={(event) => {
                if (album.system) return;
                startDrag(event, album.id);
              }}
            >
              {album.system ? (
                <span className="ifolder-row__grip" aria-hidden="true" />
              ) : (
                <span className="ifolder-row__grip" aria-hidden="true" title="拖动排序">
                  <GripVertical size={11} />
                </span>
              )}
              <button
                type="button"
                className="ifolder-row__main"
                data-active={selected === album.id}
                onClick={() => {
                  if (shouldIgnoreClick()) return;
                  onSelect(album.id);
                }}
                title={album.name}
              >
                {album.system ? (
                  <Star size={13} className="ifolder-row__icon" />
                ) : (
                  <Bookmark size={13} className="ifolder-row__icon" />
                )}
                <span className="ifolder-row__name">{album.name}</span>
                <span className="ifolder-row__count">{album.count}</span>
              </button>
              {album.system ? null : (
                <Menu
                  trigger={
                    <IconButton label="相簿操作" size="sm" className="ifolder-row__more">
                      <MoreHorizontal size={13} />
                    </IconButton>
                  }
                  items={[
                    {
                      label: '重命名',
                      icon: <Pencil size={12} />,
                      onSelect: () => setDialog({ mode: 'rename', id: album.id, name: album.name }),
                    },
                    {
                      label: '删除相簿',
                      icon: <Trash2 size={12} />,
                      danger: true,
                      separatorBefore: true,
                      onSelect: () => setPendingDelete(album),
                    },
                  ]}
                />
              )}
            </div>
          );
        })}
        {albums.length <= 1 ? (
          <p className="ifolder__hint">相簿是多对多集合：一张图可以同时进多个相簿，文件夹归属不变。</p>
        ) : null}
      </div>

      <Modal
        open={Boolean(dialog)}
        onClose={() => setDialog(null)}
        title={dialog?.mode === 'create' ? '新建相簿' : '重命名相簿'}
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
          placeholder="相簿名称"
          aria-label="相簿名称"
          onChange={(event) => setDialog((current) => (current ? { ...current, name: event.target.value } : current))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
          }}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除相簿"
        message={`「${pendingDelete?.name ?? ''}」将被删除，图片本身不会被删除，也不会离开原文件夹。`}
        confirmLabel="删除"
        danger
        loading={saving}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
