import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark, FileText, FolderInput, Maximize2, Star, Trash2 } from 'lucide-react';
import type { LibraryImage } from '../../lib/types';

interface CardContextMenuProps {
  image: LibraryImage;
  x: number;
  y: number;
  onClose: () => void;
  onOpen: () => void;
  onToggleFavorite: () => void;
  onMove: () => void;
  onAddToAlbum: () => void;
  onToPrompt: () => void;
  onDelete: () => void;
}

/** 图片右键菜单：与拖拽、批量操作互补，提供单张的明确入口 */
export function CardContextMenu({
  image,
  x,
  y,
  onClose,
  onOpen,
  onToggleFavorite,
  onMove,
  onAddToAlbum,
  onToPrompt,
  onDelete,
}: CardContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setPosition({
      x: Math.min(x, window.innerWidth - rect.width - 8),
      y: Math.min(y, window.innerHeight - rect.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('click', close);
    document.addEventListener('contextmenu', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
    };
  }, [onClose]);

  const items = [
    { label: '打开', icon: <Maximize2 size={12} />, run: onOpen },
    {
      label: image.favorite ? '取消收藏' : '收藏',
      icon: <Star size={12} fill={image.favorite ? 'currentColor' : 'none'} />,
      run: onToggleFavorite,
    },
    { label: '移动到文件夹…', icon: <FolderInput size={12} />, run: onMove },
    { label: '加入相簿…', icon: <Bookmark size={12} />, run: onAddToAlbum },
    { label: '从图片创建 Prompt', icon: <FileText size={12} />, run: onToPrompt },
    { label: '删除', icon: <Trash2 size={12} />, run: onDelete, danger: true, separatorBefore: true },
  ];

  return createPortal(
    <div
      ref={ref}
      className="menu ctx-menu"
      role="menu"
      style={{ left: position.x, top: position.y }}
      onClick={(event) => event.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={`menu__item${item.danger ? ' menu__item--danger' : ''}`}
          onClick={() => {
            onClose();
            item.run();
          }}
        >
          <span className="menu__icon">{item.icon}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
