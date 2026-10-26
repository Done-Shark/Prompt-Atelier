import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronLeft, ChevronRight, Copy, FileText, RefreshCw, Star, X } from 'lucide-react';
import { useStore } from '../../app/store';
import { api } from '../../lib/api';
import { copyText } from '../../lib/clipboard';
import { formatBytes, formatRelative, targetBadgeClass, targetShort } from '../../lib/format';
import type { LibraryImage } from '../../lib/types';
import { Button, IconButton } from '../../components/ui';
import { PromptText } from '../../components/PromptText';
import { ImageTagGroups } from './ImageTagGroups';

interface ImageViewerProps {
  items: LibraryImage[];
  index: number;
  creating: boolean;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onToggleFavorite: (image: LibraryImage) => void;
  onCreatePrompt: (image: LibraryImage) => void;
  onReparse: (image: LibraryImage) => Promise<void>;
}

export function ImageViewer({
  items,
  index,
  creating,
  onClose,
  onIndexChange,
  onToggleFavorite,
  onCreatePrompt,
  onReparse,
}: ImageViewerProps) {
  const { toast } = useStore();
  const [negativeOpen, setNegativeOpen] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [reparsing, setReparsing] = useState(false);

  const reparse = async () => {
    if (!image || reparsing) return;
    setReparsing(true);
    try {
      await onReparse(image);
    } catch (error) {
      toast(error instanceof Error ? error.message : '重新解析失败', 'error');
    } finally {
      setReparsing(false);
    }
  };

  const image = items[index];
  const imageId = image?.id;

  useEffect(() => {
    setNegativeOpen(false);
    setRawOpen(false);
  }, [imageId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const element = event.target as HTMLElement | null;
      const tag = element?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element?.isContentEditable) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowLeft') {
        if (index > 0) {
          event.preventDefault();
          onIndexChange(index - 1);
        }
      } else if (event.key === 'ArrowRight') {
        if (index < items.length - 1) {
          event.preventDefault();
          onIndexChange(index + 1);
        }
      } else if (event.key.toLowerCase() === 'f' && image) {
        event.preventDefault();
        onToggleFavorite(image);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [image, index, items.length, onClose, onIndexChange, onToggleFavorite]);

  if (!image) return null;

  const meta = image.metadata;
  const positive = meta.positive;
  const negative = meta.negative;

  const copyPositive = async () => {
    try {
      await copyText(positive);
      toast('已复制正向 Prompt');
    } catch (error) {
      toast(error instanceof Error ? error.message : '复制失败', 'error');
    }
  };

  const size =
    image.width && image.height
      ? `${image.width} × ${image.height}`
      : meta.width && meta.height
        ? `${meta.width} × ${meta.height}`
        : '—';

  const rows: { label: string; value: string }[] = [
    { label: '模型', value: meta.model || '—' },
    { label: '采样器', value: meta.sampler || '—' },
    { label: '调度器', value: meta.scheduler || '—' },
    { label: 'Steps', value: meta.steps !== null ? String(meta.steps) : '—' },
    { label: 'CFG', value: meta.cfg !== null ? String(meta.cfg) : '—' },
    { label: 'Seed', value: meta.seed !== null ? String(meta.seed) : '—' },
    { label: '尺寸', value: size },
    {
      label: 'LoRA',
      value: meta.loras?.length
        ? meta.loras.map((lora) => (lora.strength ? `${lora.name} (${lora.strength})` : lora.name)).join(', ')
        : '—',
    },
  ];

  return createPortal(
    <div
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`查看 ${image.fileName}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="viewer__stage">
        <img className="viewer__image" src={api.images.fileUrl(image.id)} alt={image.fileName} />

        <IconButton
          label="上一张"
          className="viewer__nav viewer__nav--prev"
          disabled={index === 0}
          onClick={() => onIndexChange(index - 1)}
        >
          <ChevronLeft size={18} />
        </IconButton>
        <IconButton
          label="下一张"
          className="viewer__nav viewer__nav--next"
          disabled={index >= items.length - 1}
          onClick={() => onIndexChange(index + 1)}
        >
          <ChevronRight size={18} />
        </IconButton>

        <span className="viewer__counter">
          {index + 1} / {items.length}
        </span>
      </div>

      <aside className="viewer__panel">
        <header className="viewer__head">
          <div className="viewer__titles">
            <h2 className="viewer__title" title={image.fileName}>
              {image.fileName}
            </h2>
            <div className="viewer__meta">
              <span className={`badge ${targetBadgeClass(image.target)}`}>
                {targetShort(image.target)}
              </span>
              <span className="viewer__meta-text">{size}</span>
              <span className="viewer__meta-text">{formatBytes(image.bytes)}</span>
              <span className="viewer__meta-text">导入于 {formatRelative(image.importedAt)}</span>
            </div>
          </div>
          <IconButton label="关闭查看器" onClick={onClose} autoFocus>
            <X size={15} />
          </IconButton>
        </header>

        <div className="viewer__body">
          <section className="viewer__section">
            <div className="viewer__section-head">
              <h3 className="section__title">正向 Prompt</h3>
              <Button
                size="sm"
                variant="ghost"
                icon={<Copy size={12} />}
                onClick={() => void copyPositive()}
                disabled={!positive}
              >
                复制
              </Button>
            </div>
            {positive ? (
              <div className="viewer__prompt">
                <PromptText text={positive} />
              </div>
            ) : (
              <p className="viewer__empty-text">未识别到正向 Prompt，可从图片手动新建 Prompt。</p>
            )}
            <ImageTagGroups positive={positive} />
          </section>

          <section className="viewer__section">
            <button
              type="button"
              className="viewer__collapse"
              onClick={() => setNegativeOpen((value) => !value)}
              aria-expanded={negativeOpen}
            >
              {negativeOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span className="section__title">负向 Prompt</span>
              {!negativeOpen ? (
                <span className="viewer__collapse-summary">{negative || '无'}</span>
              ) : null}
            </button>
            {negativeOpen ? (
              negative ? (
                <div className="viewer__prompt viewer__prompt--negative">
                  <PromptText text={negative} />
                </div>
              ) : (
                <p className="viewer__empty-text">没有负向 Prompt。</p>
              )
            ) : null}
          </section>

          <section className="viewer__section">
            <h3 className="section__title">参数</h3>
            <dl className="param-table">
              {rows.map((row) => (
                <div className="param-table__row" key={row.label}>
                  <dt>{row.label}</dt>
                  <dd className="mono" title={row.value}>
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="viewer__section">
            <button
              type="button"
              className="viewer__collapse"
              onClick={() => setRawOpen((value) => !value)}
              aria-expanded={rawOpen}
            >
              {rawOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span className="section__title">原始元数据</span>
            </button>
            {rawOpen ? (
              meta.raw ? (
                <pre className="viewer__raw">{JSON.stringify(meta.raw, null, 2)}</pre>
              ) : (
                <p className="viewer__empty-text">未识别到生成参数。</p>
              )
            ) : null}
          </section>
        </div>

        <footer className="viewer__foot">
          <IconButton label="重新解析元数据" size="sm" loading={reparsing} onClick={() => void reparse()}>
            <RefreshCw size={13} />
          </IconButton>
          <Button
            size="sm"
            variant="secondary"
            icon={<Star size={13} fill={image.favorite ? 'currentColor' : 'none'} />}
            onClick={() => onToggleFavorite(image)}
          >
            {image.favorite ? '已收藏' : '收藏'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<Copy size={13} />}
            onClick={() => void copyPositive()}
            disabled={!positive}
          >
            复制正向
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<FileText size={13} />}
            loading={creating}
            onClick={() => onCreatePrompt(image)}
          >
            从图片创建
          </Button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
