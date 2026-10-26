import { Bookmark, Star } from 'lucide-react';
import type { Album } from '../../lib/types';
import { Button, Modal } from '../../components/ui';

interface AddToAlbumDialogProps {
  open: boolean;
  count: number;
  albums: Album[];
  currentAlbumId: string | null;
  onClose: () => void;
  onAdd: (albumId: string) => void;
  onRemove: (albumId: string) => void;
}

/** 批量加入相簿；相簿是多对多，不会改变文件夹归属 */
export function AddToAlbumDialog({
  open,
  count,
  albums,
  currentAlbumId,
  onClose,
  onAdd,
  onRemove,
}: AddToAlbumDialogProps) {
  const current = albums.find((album) => album.id === currentAlbumId) ?? null;
  const userAlbums = albums.filter((album) => album.id !== 'favorites');
  const favorites = albums.find((album) => album.id === 'favorites');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`加入相簿（${count} 张）`}
      description="一张图片可以同时属于多个相簿，原文件夹归属不变。"
      size="sm"
      footer={
        <Button variant="ghost" onClick={onClose}>
          取消
        </Button>
      }
    >
      <div className="move-list">
        {current && !current.system ? (
          <button type="button" className="move-list__item move-list__item--remove" onClick={() => onRemove(current.id)}>
            <Bookmark size={14} className="move-list__icon" />
            <span className="move-list__name">从「{current.name}」移出</span>
          </button>
        ) : null}
        {favorites ? (
          <button type="button" className="move-list__item" onClick={() => onAdd('favorites')}>
            <Star size={14} className="move-list__icon" />
            <span className="move-list__name">收藏</span>
            <span className="move-list__count">{favorites.count}</span>
          </button>
        ) : null}
        {userAlbums.map((album) => (
          <button type="button" key={album.id} className="move-list__item" onClick={() => onAdd(album.id)}>
            <Bookmark size={14} className="move-list__icon" />
            <span className="move-list__name">{album.name}</span>
            <span className="move-list__count">{album.count}</span>
          </button>
        ))}
        {userAlbums.length === 0 ? (
          <p className="move-list__empty">还没有自建相簿，先在左侧「相簿」里新建一个。</p>
        ) : null}
      </div>
    </Modal>
  );
}
