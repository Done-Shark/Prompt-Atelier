import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { parseTags } from '../../../../shared/prompt/doc.js';
import { TAG_CATEGORIES, displayTag, normalizeTagKey } from '../../../../shared/tagCategories.js';
import { useStore } from '../../app/store';
import { api } from '../../lib/api';
import { copyText } from '../../lib/clipboard';
import type { TagEntry, TagLookupItem } from '../../lib/types';
import { Button, Spinner } from '../../components/ui';
import { TagEditPopover } from '../../components/TagEditPopover';

interface ImageTagGroupsProps {
  positive: string;
}

/**
 * 图片详情里的 Tag 分类。分类与翻译来自 Tag 库（未收录的 tag 用规则推断），
 * 与 Prompt 编辑器里的语义块是两套视图：这里人物 / 版权分开。
 */
export function ImageTagGroups({ positive }: ImageTagGroupsProps) {
  const { toast, tagCategories } = useStore();
  const [items, setItems] = useState<TagLookupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{ item: TagLookupItem; x: number; y: number } | null>(null);
  const clickTimer = useRef<number | null>(null);

  /** 双击 / F2：在 tag 下方打开快捷编辑（与 Tag 库同一份数据） */
  const openTagEditor = (item: TagLookupItem, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setEditing({ item, x: rect.left, y: rect.bottom + 4 });
  };

  const copyTag = async (item: TagLookupItem) => {
    try {
      await copyText(item.tag);
      toast('已复制 tag');
    } catch {
      toast('复制失败', 'error');
    }
  };

  const tags = useMemo(
    () => parseTags(positive).filter((tag) => normalizeTagKey(tag) !== ''),
    [positive],
  );

  useEffect(() => {
    let cancelled = false;
    if (!tags.length) {
      setItems([]);
      return;
    }
    setLoading(true);
    api.tags
      .lookup(tags)
      .then((payload) => {
        if (!cancelled) setItems(payload.items);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [positive]);

  const groups = useMemo(() => {
    const categories = tagCategories.length
      ? tagCategories
      : TAG_CATEGORIES.map((entry, index) => ({ ...entry, order: index, builtin: true }));
    const known = new Set(categories.map((entry) => entry.id));
    const buckets = new Map<string, TagLookupItem[]>();
    for (const item of items) {
      const id = known.has(item.category) ? item.category : 'unsorted';
      buckets.set(id, [...(buckets.get(id) ?? []), item]);
    }
    return categories
      .filter((category) => buckets.has(category.id))
      .map((category) => ({ category, tags: buckets.get(category.id) ?? [] }));
  }, [items, tagCategories]);

  const copyGroup = async (label: string, values: string[]) => {
    try {
      await copyText(values.join(', '));
      toast(`已复制「${label}」${values.length} 个 tag`);
    } catch (error) {
      toast(error instanceof Error ? error.message : '复制失败', 'error');
    }
  };

  if (!tags.length) return null;

  return (
    <div className="tag-groups">
      <div className="tag-groups__head">
        <h3 className="section__title">Tag 分类</h3>
        <span className="tag-groups__hint">单击复制 · 双击 / F2 / 右键编辑 · 共 {tags.length} 个</span>
      </div>

      {loading && items.length === 0 ? (
        <div className="tag-groups__loading">
          <Spinner />
          正在匹配 Tag 库…
        </div>
      ) : (
        groups.map(({ category, tags: groupTags }) => (
          <section className="tag-group" key={category.id}>
            <div className="tag-group__head">
              <span className="tag-group__label">{category.label}</span>
              <span className="tag-group__count">{groupTags.length}</span>
              <Button
                size="sm"
                variant="ghost"
                icon={<Copy size={11} />}
                onClick={() => void copyGroup(category.label, groupTags.map((item) => item.tag))}
              >
                复制
              </Button>
            </div>
            <div className="tag-group__items">
              {groupTags.map((item) => (
                <button
                  type="button"
                  key={item.tag}
                  className="tag-pill"
                  data-reviewed={item.reviewed}
                  title={
                    item.translation
                      ? `${displayTag(item.tag)} · ${item.translation}（双击 / F2 修改）`
                      : `${displayTag(item.tag)}（双击 / F2 修改翻译与分类）`
                  }
                  aria-keyshortcuts="F2"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setEditing({ item, x: event.clientX, y: event.clientY });
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    if (clickTimer.current) {
                      window.clearTimeout(clickTimer.current);
                      clickTimer.current = null;
                    }
                    openTagEditor(item, event.currentTarget);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'F2') {
                      event.preventDefault();
                      openTagEditor(item, event.currentTarget);
                    }
                  }}
                  onClick={() => {
                    // 双击会先触发一次 click：延后复制，避免复制提示和编辑面板同时出现
                    if (clickTimer.current) window.clearTimeout(clickTimer.current);
                    clickTimer.current = window.setTimeout(() => {
                      clickTimer.current = null;
                      void copyTag(item);
                    }, 220);
                  }}
                >
                  <span className="tag-pill__en">{displayTag(item.tag)}</span>
                  {item.translation ? <span className="tag-pill__zh">{item.translation}</span> : null}
                </button>
              ))}
            </div>
          </section>
        ))
      )}

      {editing ? (
        <TagEditPopover
          tag={editing.item.tag}
          translation={editing.item.translation}
          category={editing.item.category}
          reviewed={editing.item.reviewed}
          x={editing.x}
          y={editing.y}
          onClose={() => setEditing(null)}
          onToast={toast}
          onSaved={(entry: TagEntry) => {
            setItems((current) =>
              current.map((item) =>
                item.tag === entry.tag
                  ? {
                      ...item,
                      category: entry.category,
                      translation: entry.translation,
                      reviewed: entry.reviewed,
                      known: true,
                    }
                  : item,
              ),
            );
            setEditing((current) =>
              current && current.item.tag === entry.tag
                ? {
                    ...current,
                    item: {
                      ...current.item,
                      category: entry.category,
                      translation: entry.translation,
                      reviewed: entry.reviewed,
                      known: true,
                    },
                  }
                : current,
            );
          }}
        />
      ) : null}
    </div>
  );
}
