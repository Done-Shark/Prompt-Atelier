import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { TagCategoryId } from '../../../../shared/tagCategories.js';
import { Button, Modal, Switch, TextInput } from '../../components/ui';
import './tagDialogs.css';

interface FindReplaceDialogProps {
  open: boolean;
  /** 当前筛选条件，替换只作用于这批 tag */
  scope: {
    q?: string;
    category?: TagCategoryId;
    status?: 'all' | 'translated' | 'pending' | 'reviewed' | 'unused';
    source?: 'none' | 'dictionary' | 'llm' | 'gemini' | 'manual';
  };
  scopeCount: number;
  onClose: () => void;
  onDone: () => void;
  onToast: (text: string, tone?: 'ok' | 'error') => void;
}

type Preview = {
  total: number;
  truncated: boolean;
  matches: { from: string; to: string; usage: number }[];
  skipped: { from: string; to: string }[];
};

/** 查找替换：对当前筛选结果里的 tag 批量改名，支持正则与捕获组 */
export function FindReplaceDialog({ open, scope, scopeCount, onClose, onDone, onToast }: FindReplaceDialogProps) {
  const [pattern, setPattern] = useState('');
  const [replacement, setReplacement] = useState('');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPattern('');
    setReplacement('');
    setRegex(false);
    setCaseSensitive(false);
    setPreview(null);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const needle = pattern.trim();
    if (!needle) {
      setPreview(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.tags.findReplace({
          pattern: needle,
          replacement,
          regex,
          caseSensitive,
          dryRun: true,
          scope,
        });
        if (!cancelled) {
          setPreview({
            total: result.total ?? 0,
            truncated: result.truncated ?? false,
            matches: result.matches ?? [],
            skipped: result.skipped ?? [],
          });
        }
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
  }, [open, pattern, replacement, regex, caseSensitive, scope]);

  const apply = async () => {
    const needle = pattern.trim();
    if (!needle) return;
    setApplying(true);
    try {
      const result = await api.tags.findReplace({
        pattern: needle,
        replacement,
        regex,
        caseSensitive,
        scope,
      });
      onToast(
        `已替换 ${result.renamed ?? 0} 个 tag，影响 ${result.prompts ?? 0} 条 Prompt、${result.images ?? 0} 张图片`,
      );
      onDone();
      onClose();
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '替换失败', 'error');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="查找替换 Tag"
      size="md"
      dismissable={!applying}
      footer={
        <>
          <span className="tag-dialog__muted">
            作用范围：当前筛选结果（{scopeCount} 条）
          </span>
          <span className="toolbar__spacer" />
          <Button variant="ghost" onClick={onClose} disabled={applying}>
            取消
          </Button>
          <Button
            variant="primary"
            onClick={() => void apply()}
            loading={applying}
            disabled={!pattern.trim() || !preview || preview.total === 0}
          >
            执行替换{preview ? `（${preview.total}）` : ''}
          </Button>
        </>
      }
    >
      <div className="tag-replace">
        <div className="tag-replace__row">
          <label className="tag-replace__field">
            <span className="tag-rename__label">查找</span>
            <TextInput
              autoFocus
              value={pattern}
              placeholder={regex ? '^artist:' : 'artist:'}
              mono
              onChange={(event) => setPattern(event.target.value)}
            />
          </label>
          <label className="tag-replace__field">
            <span className="tag-rename__label">替换为</span>
            <TextInput
              value={replacement}
              placeholder={regex ? '$1' : '留空表示删除'}
              mono
              onChange={(event) => setReplacement(event.target.value)}
            />
          </label>
        </div>

        <div className="tag-replace__toggles">
          <Switch checked={regex} onChange={setRegex} label="正则（支持 $1 捕获组）" />
          <Switch checked={caseSensitive} onChange={setCaseSensitive} label="区分大小写" />
        </div>

        {loading ? <p className="tag-dialog__note">正在匹配…</p> : null}
        {error ? <p className="tag-dialog__error">{error}</p> : null}

        {preview && !loading ? (
          preview.total === 0 ? (
            <p className="tag-dialog__note">没有匹配的 tag。</p>
          ) : (
            <>
              <div className="tag-replace__list">
                {preview.matches.map((item) => (
                  <div className="tag-replace__item" key={item.from}>
                    <code className="tag-replace__from">{item.from}</code>
                    <span className="tag-replace__arrow">→</span>
                    <code className="tag-replace__to">{item.to}</code>
                    <span className="tag-replace__usage">{item.usage ? `${item.usage} 次` : '未使用'}</span>
                  </div>
                ))}
              </div>
              {preview.truncated ? (
                <p className="tag-dialog__note">只显示前 200 条，实际会替换 {preview.total} 条。</p>
              ) : null}
              {preview.skipped.length ? (
                <p className="tag-dialog__note">
                  {preview.skipped.length} 条替换后为空或与原值相同，已跳过。
                </p>
              ) : null}
            </>
          )
        ) : null}

        <p className="tag-dialog__note">
          替换会同步改写 Prompt 的正向 / 分块与图片标签，旧写法记为别名。执行前请确认预览列表。
        </p>
      </div>
    </Modal>
  );
}
