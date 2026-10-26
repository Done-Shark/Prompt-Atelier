import { useEffect, useMemo, useState } from 'react';
import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import type { TagCategory } from '../../../../shared/tagCategories.js';
import { api } from '../../lib/api';
import { Button, ConfirmDialog, IconButton, Modal, TextInput } from '../../components/ui';
import { useRowDrag } from '../../lib/useRowDrag';
import './tagDialogs.css';

interface CategoryManagerDialogProps {
  open: boolean;
  categories: TagCategory[];
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onToast: (text: string, tone?: 'ok' | 'error') => void;
}

/** 分类管理：新增 / 重命名 / 拖动排序 / 删除自建分类 */
export function CategoryManagerDialog({
  open,
  categories,
  onClose,
  onChanged,
  onToast,
}: CategoryManagerDialogProps) {
  const [items, setItems] = useState<TagCategory[]>(categories);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [pendingDelete, setPendingDelete] = useState<TagCategory | null>(null);

  useEffect(() => {
    if (!open) return;
    setItems(categories);
    setDraft('');
    setEditingId(null);
    setPendingDelete(null);
  }, [open, categories]);

  const ids = useMemo(() => items.map((item) => item.id), [items]);

  const persistOrder = async (next: TagCategory[]) => {
    setItems(next);
    try {
      const payload = await api.tagCategories.reorder(next.map((item) => item.id));
      setItems(payload.items);
      await onChanged();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '排序失败', 'error');
      setItems(categories);
    }
  };

  const { dragId, hint, startDrag, shouldIgnoreClick } = useRowDrag({
    zones: ['before', 'after'],
    rootSelector: null,
    onDrop: (sourceId, targetId, zone) => {
      if (!targetId || sourceId === targetId) return;
      const from = items.findIndex((item) => item.id === sourceId);
      const target = items.findIndex((item) => item.id === targetId);
      if (from < 0 || target < 0) return;
      const next = items.slice();
      const [moved] = next.splice(from, 1);
      const insert = next.findIndex((item) => item.id === targetId) + (zone === 'after' ? 1 : 0);
      next.splice(insert, 0, moved);
      void persistOrder(next);
    },
  });

  const add = async () => {
    const label = draft.trim();
    if (!label) return;
    setBusy(true);
    try {
      const created = await api.tagCategories.create({ label });
      setItems((current) => [...current, created]);
      setDraft('');
      onToast(`已新增分类「${created.label}」`);
      await onChanged();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '新增失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveLabel = async (category: TagCategory) => {
    const label = editingLabel.trim();
    setEditingId(null);
    if (!label || label === category.label) return;
    try {
      const updated = await api.tagCategories.update(category.id, { label });
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      onToast('已重命名');
      await onChanged();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '重命名失败', 'error');
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      const result = await api.tagCategories.remove(pendingDelete.id);
      setItems((current) => current.filter((item) => item.id !== pendingDelete.id));
      onToast(result.moved ? `已删除，${result.moved} 个 tag 回到未分类` : '已删除分类');
      setPendingDelete(null);
      await onChanged();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '删除失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`分类管理（${items.length}）`}
        size="md"
        footer={
          <>
            <span className="tag-dialog__muted">拖动行调整顺序；图片详情与 Tag 库都按这个顺序分组。</span>
            <span className="toolbar__spacer" />
          </>
        }
      >
        <div className="tag-cat">
          <div className="tag-cat__list">
            {items.map((category) => {
              const zone = hint?.targetId === category.id ? hint?.zone ?? null : null;
              return (
                <div
                  className="tag-cat__row"
                  key={category.id}
                  data-drag-row={category.id}
                  data-drop-zone={zone ?? undefined}
                  data-dragging={dragId === category.id}
                  onPointerDown={(event) => startDrag(event, category.id)}
                >
                  <span className="tag-cat__grip" aria-hidden="true">
                    <GripVertical size={12} />
                  </span>
                  {editingId === category.id ? (
                    <TextInput
                      autoFocus
                      value={editingLabel}
                      aria-label="分类名称"
                      onChange={(event) => setEditingLabel(event.target.value)}
                      onBlur={() => void saveLabel(category)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void saveLabel(category);
                        if (event.key === 'Escape') setEditingId(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="tag-cat__label"
                      onClick={() => {
                        if (shouldIgnoreClick()) return;
                        setEditingId(category.id);
                        setEditingLabel(category.label);
                      }}
                    >
                      {category.label}
                      {category.builtin ? <span className="tag-cat__badge">内置</span> : null}
                    </button>
                  )}
                  <IconButton
                    label={`重命名 ${category.label}`}
                    size="sm"
                    onClick={() => {
                      setEditingId(category.id);
                      setEditingLabel(category.label);
                    }}
                  >
                    <Pencil size={12} />
                  </IconButton>
                  <IconButton
                    label={`删除 ${category.label}`}
                    size="sm"
                    disabled={category.builtin}
                    title={category.builtin ? '内置分类不能删除' : undefined}
                    onClick={() => setPendingDelete(category)}
                  >
                    <Trash2 size={12} />
                  </IconButton>
                </div>
              );
            })}
          </div>

          <div className="tag-cat__add">
            <TextInput
              value={draft}
              placeholder="新分类名称"
              aria-label="新分类名称"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void add();
              }}
            />
            <Button size="sm" variant="primary" icon={<Plus size={12} />} loading={busy} onClick={() => void add()}>
              添加
            </Button>
          </div>
          <p className="tag-cat__hint">共 {ids.length} 个分类；自建分类删除后，里面的 tag 会回到「未分类」。</p>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除分类"
        message={`删除「${pendingDelete?.label ?? ''}」后，该分类下的 tag 会回到「未分类」，tag 本身不会删除。`}
        confirmLabel="删除"
        danger
        loading={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}
