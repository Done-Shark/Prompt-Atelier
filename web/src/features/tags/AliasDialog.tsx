import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Search, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import type { TagAlias } from '../../lib/types';
import { EmptyState, IconButton, Modal, Spinner, TextInput } from '../../components/ui';
import './tagDialogs.css';

interface AliasDialogProps {
  open: boolean;
  onClose: () => void;
  /** 删除别名后通知外部刷新 Tag 列表与操作日志 */
  onChanged: () => void | Promise<void>;
  onPick: (tag: string) => void;
  onToast: (text: string, tone?: 'ok' | 'error') => void;
}

/** 别名管理：查看「旧写法 → 规范写法」，删除错误别名 */
export function AliasDialog({ open, onClose, onChanged, onPick, onToast }: AliasDialogProps) {
  const [items, setItems] = useState<TagAlias[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    let cancelled = false;
    setLoading(true);
    api.tags
      .aliases()
      .then((payload) => {
        if (!cancelled) setItems(payload.items);
      })
      .catch((error) => {
        if (!cancelled) onToast(error instanceof Error ? error.message : '读取别名失败', 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, onToast]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => `${item.alias} ${item.canonical}`.toLowerCase().includes(needle));
  }, [items, query]);

  const remove = async (alias: string) => {
    setBusy(alias);
    try {
      await api.tags.deleteAlias(alias);
      setItems((current) => current.filter((item) => item.alias !== alias));
      onToast(`已删除别名 ${alias}`);
      await onChanged();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '删除失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`别名（${items.length}）`}
      size="md"
      footer={
        <>
          <span className="tag-dialog__muted">改名 / 合并后旧写法会记在这里；删除后旧写法可以重新独立存在。</span>
          <span className="toolbar__spacer" />
        </>
      }
    >
      <div className="tag-alias">
        <div className="tag-alias__search">
          <Search size={13} className="tag-alias__search-icon" />
          <TextInput
            type="search"
            value={query}
            placeholder="搜索旧写法或规范 tag"
            aria-label="搜索别名"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {loading ? (
          <div className="tag-alias__loading">
            <Spinner />
            正在读取…
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={items.length ? '没有匹配的别名' : '还没有别名'}
            text={items.length ? '换个关键词试试。' : '在 Tag 行菜单里「重命名 / 合并」后，旧写法会出现在这里。'}
          />
        ) : (
          <div className="tag-alias__list">
            {filtered.map((item) => (
              <div className="tag-alias__row" key={item.alias}>
                <button
                  type="button"
                  className="tag-alias__main"
                  title={`查看 ${item.canonical}`}
                  onClick={() => {
                    onPick(item.canonical);
                    onClose();
                  }}
                >
                  <code className="tag-alias__alias">{item.alias}</code>
                  <ArrowRight size={12} className="tag-alias__arrow" />
                  <code className="tag-alias__canonical">{item.canonical}</code>
                </button>
                <IconButton
                  label={`删除别名 ${item.alias}`}
                  size="sm"
                  loading={busy === item.alias}
                  onClick={() => void remove(item.alias)}
                >
                  <Trash2 size={12} />
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
