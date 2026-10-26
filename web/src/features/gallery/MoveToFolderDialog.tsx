import { useMemo } from 'react';
import { Folder as FolderIcon, Inbox } from 'lucide-react';
import type { Folder } from '../../lib/types';
import { Button, Modal } from '../../components/ui';

interface MoveToFolderDialogProps {
  open: boolean;
  count: number;
  folders: Folder[];
  onClose: () => void;
  onSelect: (folderId: string | null) => void;
}

/** 批量移动目标：按树形顺序平铺，显示层级缩进 */
export function MoveToFolderDialog({ open, count, folders, onClose, onSelect }: MoveToFolderDialogProps) {
  const flat = useMemo(() => {
    const byParent = new Map<string | null, Folder[]>();
    for (const folder of folders) {
      const key = folder.parentId;
      byParent.set(key, [...(byParent.get(key) ?? []), folder]);
    }
    for (const list of byParent.values()) {
      list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-Hans'));
    }
    const out: { folder: Folder; depth: number }[] = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const folder of byParent.get(parentId) ?? []) {
        out.push({ folder, depth });
        walk(folder.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [folders]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`移动 ${count} 张图片`}
      description="选择目标文件夹，图片会追加到该文件夹末尾。"
      size="sm"
      footer={
        <Button variant="ghost" onClick={onClose}>
          取消
        </Button>
      }
    >
      <div className="move-list">
        <button type="button" className="move-list__item" onClick={() => onSelect(null)}>
          <Inbox size={14} className="move-list__icon" />
          <span>未归档</span>
        </button>
        {flat.map(({ folder, depth }) => (
          <button
            type="button"
            key={folder.id}
            className="move-list__item"
            style={{ paddingLeft: 10 + depth * 14 }}
            onClick={() => onSelect(folder.id)}
          >
            <FolderIcon size={14} className="move-list__icon" />
            <span className="move-list__name">{folder.name}</span>
            <span className="move-list__count">{folder.imageTotal ?? 0}</span>
          </button>
        ))}
        {flat.length === 0 ? <p className="move-list__empty">还没有图片文件夹，先在左侧新建一个。</p> : null}
      </div>
    </Modal>
  );
}
