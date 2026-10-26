import { useCallback, useEffect, useState } from 'react';
import { ImageOff, Search } from 'lucide-react';
import { api } from '../lib/api';
import type { LibraryImage, TargetFilter } from '../lib/types';
import { Button, EmptyState, Modal, Segmented, Spinner, TextInput } from './ui';
import { ThumbImage } from './ThumbImage';
import './ImagePickerDialog.css';

interface ImagePickerDialogProps {
  open: boolean;
  /** 弹窗标题，默认「选择示例图片」 */
  title?: string;
  /** 顶部说明文字 */
  hint?: string;
  currentId?: string | null;
  onClose: () => void;
  onSelect: (imageId: string | null) => Promise<void> | void;
}

const PAGE_SIZE = 60;

/** 从图片库里挑一张示例图，或移除当前选择 */
export function ImagePickerDialog({
  open,
  title = '选择示例图片',
  hint,
  currentId,
  onClose,
  onSelect,
}: ImagePickerDialogProps) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [target, setTarget] = useState<TargetFilter>('all');
  const [items, setItems] = useState<LibraryImage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setDebounced('');
    setTarget('all');
  }, [open]);

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      try {
        const payload = await api.images.list({
          q: debounced || undefined,
          target,
          sort: 'imported',
          limit: PAGE_SIZE,
          offset,
        });
        setTotal(payload.total);
        setItems((current) => (offset === 0 ? payload.items : [...current, ...payload.items]));
      } catch {
        if (offset === 0) {
          setItems([]);
          setTotal(0);
        }
      } finally {
        setLoading(false);
      }
    },
    [debounced, target],
  );

  useEffect(() => {
    if (!open) return;
    void load(0);
  }, [open, load]);

  const pick = async (imageId: string | null) => {
    setSaving(imageId ?? 'clear');
    try {
      await onSelect(imageId);
      onClose();
    } finally {
      setSaving(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      dismissable={!saving}
      footer={
        <>
          <Button
            variant="ghost"
            disabled={!currentId || Boolean(saving)}
            onClick={() => void pick(null)}
          >
            移除示例图
          </Button>
          <span className="toolbar__spacer" />
          <Button variant="ghost" onClick={onClose} disabled={Boolean(saving)}>
            取消
          </Button>
        </>
      }
    >
      <div className="image-picker">
        {hint ? <p className="image-picker__hint">{hint}</p> : null}

        <div className="image-picker__toolbar">
          <div className="image-picker__search">
            <Search size={13} className="image-picker__search-icon" />
            <TextInput
              value={query}
              placeholder="搜索文件名"
              aria-label="搜索图片"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Segmented
            label="图片分区"
            value={target}
            onChange={setTarget}
            options={[
              { value: 'all', label: '全部' },
              { value: 'nai', label: 'NAI' },
              { value: 'comfyui', label: 'ComfyUI' },
            ]}
          />
          <span className="toolbar__count">{total} 张</span>
        </div>

        {loading && items.length === 0 ? (
          <div className="image-picker__loading">
            <Spinner />
            正在读取图片…
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<ImageOff size={20} />}
            title="没有可用图片"
            text="先到图片库导入图片，再回来设置示例图。"
          />
        ) : (
          <>
            <div className="image-picker__grid">
              {items.map((image) => (
                <button
                  type="button"
                  key={image.id}
                  className="image-picker__item"
                  data-active={image.id === currentId}
                  disabled={Boolean(saving)}
                  title={image.fileName}
                  onClick={() => void pick(image.id)}
                >
                  <ThumbImage id={image.id} alt={image.fileName} className="image-picker__img" />
                  {image.id === currentId ? <span className="image-picker__badge">当前</span> : null}
                </button>
              ))}
            </div>
            {items.length < total ? (
              <div className="image-picker__more">
                <Button variant="secondary" loading={loading} onClick={() => void load(items.length)}>
                  加载更多
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}
