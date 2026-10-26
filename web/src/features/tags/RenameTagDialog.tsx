import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { api } from '../../lib/api';
import { Button, Modal, TextInput } from '../../components/ui';
import './tagDialogs.css';

interface RenameTagDialogProps {
  open: boolean;
  tag: string;
  onClose: () => void;
  onDone: () => void;
  onToast: (text: string, tone?: 'ok' | 'error') => void;
}

type RenamePreview = {
  prompts: number;
  images: number;
  segments: number;
  positive: number;
  negative: number;
  tagAction: 'renamed' | 'merged' | 'alias-only';
  translation: string;
  category: string | null;
};

const ACTION_LABEL: Record<RenamePreview['tagAction'], string> = {
  renamed: '重命名为新条目',
  merged: '合并进已有条目',
  'alias-only': '仅记录别名（库里没有这条）',
};

/** 重命名 / 合并：先跑 dryRun 预览影响面，再确认执行 */
export function RenameTagDialog({ open, tag, onClose, onDone, onToast }: RenameTagDialogProps) {
  const [target, setTarget] = useState(tag);
  const [preview, setPreview] = useState<RenamePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTarget(tag);
    setPreview(null);
    setError(null);
  }, [open, tag]);

  useEffect(() => {
    if (!open) return;
    const next = target.trim();
    if (!next || next === tag) {
      setPreview(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.tags.rename({ from: tag, to: next, dryRun: true });
        if (!cancelled) setPreview(result);
      } catch (cause) {
        if (!cancelled) {
          setPreview(null);
          setError(cause instanceof Error ? cause.message : '预览失败');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, tag, target]);

  const apply = async () => {
    const next = target.trim();
    if (!next || next === tag) return;
    setApplying(true);
    try {
      const result = await api.tags.rename({ from: tag, to: next });
      onToast(
        `已${result.tagAction === 'merged' ? '合并' : '重命名'}：影响 ${result.prompts} 条 Prompt、${result.images} 张图片`,
      );
      onDone();
      onClose();
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '重命名失败', 'error');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="重命名 / 合并 Tag"
      size="sm"
      dismissable={!applying}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={applying}>
            取消
          </Button>
          <Button
            variant="primary"
            onClick={() => void apply()}
            loading={applying}
            disabled={!target.trim() || target.trim() === tag || Boolean(error)}
          >
            执行
          </Button>
        </>
      }
    >
      <div className="tag-rename">
        <div className="tag-rename__row">
          <div className="tag-rename__field">
            <span className="tag-rename__label">原 tag</span>
            <code className="tag-rename__value">{tag}</code>
          </div>
          <ArrowRight size={14} className="tag-rename__arrow" />
          <div className="tag-rename__field">
            <span className="tag-rename__label">新 tag</span>
            <TextInput
              autoFocus
              value={target}
              aria-label="新 tag"
              onChange={(event) => setTarget(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void apply();
              }}
            />
          </div>
        </div>

        {loading ? <p className="tag-dialog__note">正在统计影响面…</p> : null}

        {preview && !loading ? (
          <div className="tag-rename__preview">
            <p>
              影响 <b>{preview.prompts}</b> 条 Prompt、<b>{preview.images}</b> 张图片
            </p>
            <p className="tag-dialog__muted">
              分块 {preview.segments} 处 · 正向 {preview.positive} 处 · 负向 {preview.negative} 处
            </p>
            <p>
              Tag 库：{ACTION_LABEL[preview.tagAction]}
              {preview.translation ? ` · 译文「${preview.translation}」` : ''}
            </p>
          </div>
        ) : null}

        {error ? <p className="tag-dialog__error">{error}</p> : null}

        <p className="tag-dialog__note">
          旧写法会记为别名，之后从 Prompt 或图片里再次出现时会自动归并到新 tag；已有的人工译文与分类会保留。
        </p>
      </div>
    </Modal>
  );
}
