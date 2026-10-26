import { useState } from 'react';
import { Check, FileText, Star, Trash2 } from 'lucide-react';
import { ThumbImage } from '../../components/ThumbImage';
import { targetShort } from '../../lib/format';
import type { LibraryImage } from '../../lib/types';
import { IconButton } from '../../components/ui';
import { hasImageDragData, writeImageDragData } from '../../lib/dnd';

export type Density = 'compact' | 'normal' | 'wide';

interface ImageGridProps {
  items: LibraryImage[];
  density: Density;
  groupByDate?: boolean;
  creatingId: string | null;
  selected: Set<string>;
  onToggleFavorite: (image: LibraryImage) => void;
  onDelete: (image: LibraryImage) => void;
  onToPrompt: (image: LibraryImage) => void;
  onCardClick: (image: LibraryImage, index: number, event: React.MouseEvent) => void;
  onCheck: (image: LibraryImage, index: number, checked: boolean) => void;
  onContextMenu: (image: LibraryImage, x: number, y: number) => void;
  onDragStart: (ids: string[]) => void;
  onDragEnd: () => void;
  onDropOnCard: (targetId: string, after: boolean) => void;
}

function dateGroup(iso: string): { key: string; label: string } {
  const date = new Date(iso);
  const now = new Date();
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const today = startOfDay(now);
  const day = startOfDay(date);
  const diff = Math.round((today - day) / 86400000);
  if (diff <= 0) return { key: 'today', label: '今天' };
  if (diff === 1) return { key: 'yesterday', label: '昨天' };
  if (diff < 7) return { key: 'week', label: '本周' };
  return { key: 'earlier', label: '更早' };
}

export function ImageGrid({
  items,
  density,
  groupByDate = false,
  creatingId,
  selected,
  onToggleFavorite,
  onDelete,
  onToPrompt,
  onCardClick,
  onCheck,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDropOnCard,
}: ImageGridProps) {
  const [dragOver, setDragOver] = useState<{ id: string; after: boolean } | null>(null);

  const card = (image: LibraryImage, index: number) => (
    <ImageCard
      key={image.id}
      image={image}
      index={index}
      creating={creatingId === image.id}
      selected={selected.has(image.id)}
      dragIds={selected.has(image.id) ? [...selected] : [image.id]}
      dropPosition={dragOver?.id === image.id ? (dragOver.after ? 'after' : 'before') : null}
      onToggleFavorite={() => onToggleFavorite(image)}
      onDelete={() => onDelete(image)}
      onToPrompt={() => onToPrompt(image)}
      onCardClick={(event) => onCardClick(image, index, event)}
      onCheck={(checked) => onCheck(image, index, checked)}
      onContextMenu={(x, y) => onContextMenu(image, x, y)}
      onDragStart={onDragStart}
      onDragEnd={() => {
        setDragOver(null);
        onDragEnd();
      }}
      onDragOver={(after) => setDragOver({ id: image.id, after })}
      onDragLeave={() => setDragOver((current) => (current?.id === image.id ? null : current))}
      onDrop={(after) => {
        setDragOver(null);
        onDropOnCard(image.id, after);
      }}
    />
  );

  if (!groupByDate) {
    return (
      <div className="gallery-grid" data-density={density}>
        {items.map((image, index) => card(image, index))}
      </div>
    );
  }

  const groups: { key: string; label: string; entries: { image: LibraryImage; index: number }[] }[] = [];
  items.forEach((image, index) => {
    const { key, label } = dateGroup(image.importedAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.entries.push({ image, index });
    else groups.push({ key, label, entries: [{ image, index }] });
  });

  return (
    <div className="gallery-groups">
      {groups.map((group) => (
        <section className="gallery-group" key={group.key}>
          <header className="gallery-group__head">
            <span>{group.label}</span>
            <span className="gallery-group__count">{group.entries.length}</span>
          </header>
          <div className="gallery-grid" data-density={density}>
            {group.entries.map((entry) => card(entry.image, entry.index))}
          </div>
        </section>
      ))}
    </div>
  );
}

interface ImageCardProps {
  image: LibraryImage;
  index: number;
  creating: boolean;
  selected: boolean;
  dragIds: string[];
  dropPosition: 'before' | 'after' | null;
  onToggleFavorite: () => void;
  onDelete: () => void;
  onToPrompt: () => void;
  onCardClick: (event: React.MouseEvent) => void;
  onCheck: (checked: boolean) => void;
  onContextMenu: (x: number, y: number) => void;
  onDragStart: (ids: string[]) => void;
  onDragEnd: () => void;
  onDragOver: (after: boolean) => void;
  onDragLeave: () => void;
  onDrop: (after: boolean) => void;
}

function ImageCard({
  image,
  index,
  creating,
  selected,
  dragIds,
  dropPosition,
  onToggleFavorite,
  onDelete,
  onToPrompt,
  onCardClick,
  onCheck,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: ImageCardProps) {
  const [loaded, setLoaded] = useState(false);
  const unknown = image.metadata.format === 'unknown';
  const meta = image.metadata.model || image.metadata.sampler;

  return (
    <article
      className="gcard"
      data-selected={selected}
      data-drop={dropPosition ?? undefined}
      draggable
      onDragStart={(event) => {
        onDragStart(dragIds);
        writeImageDragData(event.dataTransfer, dragIds);
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (!hasImageDragData(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const rect = event.currentTarget.getBoundingClientRect();
        onDragOver(event.clientX > rect.left + rect.width / 2);
      }}
      onDragLeave={onDragLeave}
      onDrop={(event) => {
        if (!hasImageDragData(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        onDrop(event.clientX > rect.left + rect.width / 2);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(event.clientX, event.clientY);
      }}
    >
      <button
        type="button"
        className="gcard__hit"
        onClick={onCardClick}
        aria-label={`查看 ${image.fileName}`}
        data-index={index}
      >
        <span className="gcard__frame">
          {!loaded ? <span className="gcard__placeholder" aria-hidden="true" /> : null}
          <ThumbImage
            id={image.id}
            alt={image.fileName}
            className="gcard__img"
            onReady={() => setLoaded(true)}
          />
        </span>
      </button>

      <label className="gcard__check" onClick={(event) => event.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          aria-label={`选择 ${image.fileName}`}
          onChange={(event) => onCheck(event.target.checked)}
        />
        <span className="gcard__check-box" aria-hidden="true">
          <Check size={11} />
        </span>
      </label>

      {unknown ? <span className="gcard__warn">无参数</span> : null}

      <div className="gcard__actions">
        <IconButton
          label={image.favorite ? '取消收藏' : '收藏'}
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite();
          }}
        >
          <Star size={13} fill={image.favorite ? 'currentColor' : 'none'} />
        </IconButton>
        <IconButton
          label="从图片创建 Prompt"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            onToPrompt();
          }}
          disabled={creating}
        >
          <FileText size={13} />
        </IconButton>
        <IconButton
          label="删除图片"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 size={13} />
        </IconButton>
      </div>

      <div className="gcard__bar" aria-hidden="true">
        <span className="gcard__name" title={image.fileName}>
          {image.fileName}
        </span>
        <span className="gcard__meta">
          {targetShort(image.target)}
          {meta ? ` · ${meta}` : ''}
        </span>
      </div>
    </article>
  );
}
