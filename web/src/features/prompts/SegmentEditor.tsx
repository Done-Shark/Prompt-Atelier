import { useMemo, useState } from 'react';
import {
  ArrowDownUp,
  ChevronDown,
  ChevronRight,
  Copy,
  GripVertical,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  SEGMENT_KINDS,
  buildSegments,
  classifyTag,
  countTags,
  kindLabel,
  parseTags,
  segmentText,
  serializeSegments,
} from '../../../../shared/prompt/doc.js';
import type { PromptSegment, SegmentKind } from '../../../../shared/prompt/doc.js';
import { useStore } from '../../app/store';
import { copyText } from '../../lib/clipboard';
import { Button, IconButton, Menu, TextArea } from '../../components/ui';
import { PromptText } from '../../components/PromptText';

interface SegmentEditorProps {
  segments: PromptSegment[];
  onChange: (segments: PromptSegment[]) => void;
  /** 保存前的原始文本；分块顺序与它不同时给出提示 */
  baseline?: string;
}

/**
 * 语义分块编辑器：
 * - 顶部是完整正向文本（语法高亮），块顺序即输出顺序；
 * - 每块可拖动排序、改名、整块复制、折叠；
 * - 每个 tag 单击复制、× 删除；
 * - 支持粘贴原始 Prompt 自动分块，或重新分类。
 */
export function SegmentEditor({ segments, onChange, baseline }: SegmentEditorProps) {
  const { toast } = useStore();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickText, setQuickText] = useState('');

  const fullText = useMemo(() => serializeSegments(segments), [segments]);
  const tagCount = useMemo(() => countTags(segments), [segments]);

  const copy = async (text: string, message: string) => {
    try {
      await copyText(text);
      toast(message);
    } catch (error) {
      toast(error instanceof Error ? error.message : '复制失败', 'error');
    }
  };

  const patchSegment = (id: string, patch: Partial<PromptSegment>) => {
    onChange(segments.map((segment) => (segment.id === id ? { ...segment, ...patch } : segment)));
  };

  const removeSegment = (id: string) => {
    onChange(segments.filter((segment) => segment.id !== id));
  };

  const addTag = (id: string, raw: string) => {
    const parts = raw
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const segment = segments.find((item) => item.id === id);
    if (!segment) return;
    const existing = new Set(segment.tags.map((tag) => tag.text));
    const tags = [...segment.tags];
    for (const part of parts) {
      if (existing.has(part)) continue;
      tags.push({ id: `tag_${Date.now().toString(36)}${tags.length}`, text: part, enabled: true });
    }
    patchSegment(id, { tags });
  };

  const removeTag = (segmentId: string, tagId: string) => {
    const segment = segments.find((item) => item.id === segmentId);
    if (!segment) return;
    patchSegment(segmentId, { tags: segment.tags.filter((tag) => tag.id !== tagId) });
  };

  const moveSegment = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const from = segments.findIndex((item) => item.id === fromId);
    const to = segments.findIndex((item) => item.id === toId);
    if (from < 0 || to < 0) return;
    const next = [...segments];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const addBlock = (kind: SegmentKind) => {
    onChange([
      ...segments,
      {
        id: `seg_${Date.now().toString(36)}`,
        kind,
        label: kindLabel(kind),
        tags: [],
      },
    ]);
  };

  const reclassify = () => {
    const rebuilt = buildSegments(fullText);
    onChange(rebuilt);
    setCollapsed({});
    toast('已按语义重新分块');
  };

  const mergeQuick = (mode: 'replace' | 'append') => {
    const text = quickText.trim();
    if (!text) return;
    if (mode === 'replace') {
      onChange(buildSegments(text));
    } else {
      const next = segments.map((segment) => ({ ...segment, tags: [...segment.tags] }));
      for (const tag of parseTags(text)) {
        const kind = classifyTag(tag);
        let target = next.find((segment) => segment.kind === kind);
        if (!target) {
          target = { id: `seg_${Date.now().toString(36)}${next.length}`, kind, label: kindLabel(kind), tags: [] };
          next.push(target);
        }
        if (!target.tags.some((item) => item.text === tag)) {
          target.tags.push({ id: `tag_${Date.now().toString(36)}${target.tags.length}`, text: tag, enabled: true });
        }
      }
      onChange(next);
    }
    setQuickText('');
    setQuickOpen(false);
  };

  const availableKinds = SEGMENT_KINDS.filter(
    (item) => item.kind === 'custom' || !segments.some((segment) => segment.kind === item.kind),
  );

  if (segments.length === 0) {
    return (
      <div className="segment-editor">
        <div className="segment-empty">
          <p className="segment-empty__title">粘贴一段现成的 Prompt 开始</p>
          <p className="segment-empty__text">
            会自动按画师、人物、动作、背景等语义分块。也可以手动建一个空块，逐个添加 tag。
          </p>
          <TextArea
            mono
            rows={5}
            autoFocus
            value={quickText}
            placeholder="1girl, solo, artist:xxx, long hair, standing, city lights at night, masterpiece…"
            aria-label="粘贴原始 Prompt"
            onChange={(event) => setQuickText(event.target.value)}
          />
          <div className="segment-empty__actions">
            <Button variant="primary" disabled={!quickText.trim()} onClick={() => mergeQuick('replace')}>
              分块并开始
            </Button>
            <Button variant="ghost" onClick={() => addBlock('custom')}>
              手动添加空块
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="segment-editor">
      <div className="segment-editor__preview">
        <div className="segment-editor__preview-head">
          <span className="section__title">正向 Prompt · {tagCount} 个 tag</span>
          <div className="segment-editor__preview-actions">
            <Button size="sm" variant="ghost" icon={<ArrowDownUp size={12} />} onClick={reclassify}>
              重新分类
            </Button>
            <Button size="sm" variant="ghost" icon={<Copy size={12} />} onClick={() => copy(fullText, '已复制完整正向 Prompt')}>
              复制全部
            </Button>
          </div>
        </div>
        <div className="segment-editor__preview-text">
          {fullText ? <PromptText text={fullText} /> : <span className="muted">还没有 tag，从下面的块开始添加，或粘贴一段现成的 Prompt。</span>}
        </div>
        {baseline && fullText !== baseline ? (
          <p className="segment-editor__note">
            分块顺序与原文不同。只有编辑分块并保存后，输出顺序才会按分块调整。
          </p>
        ) : null}
      </div>

      <div className="segment-editor__blocks">
        {segments.map((segment) => {
          const isCollapsed = collapsed[segment.id] ?? false;
          return (
            <section
              key={segment.id}
              className="seg-block"
              data-dragging={dragId === segment.id}
              draggable
              onDragStart={(event) => {
                setDragId(segment.id);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', segment.id);
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(event) => {
                if (dragId && dragId !== segment.id) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const from = event.dataTransfer.getData('text/plain') || dragId;
                if (from) moveSegment(from, segment.id);
                setDragId(null);
              }}
            >
              <header className="seg-block__head">
                <span className="seg-block__grip" aria-hidden="true">
                  <GripVertical size={13} />
                </span>
                <button
                  type="button"
                  className="seg-block__toggle"
                  aria-label={isCollapsed ? '展开块' : '折叠块'}
                  onClick={() => setCollapsed((current) => ({ ...current, [segment.id]: !isCollapsed }))}
                >
                  {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                </button>
                <input
                  className="seg-block__label"
                  value={segment.label}
                  aria-label="块名称"
                  onChange={(event) => patchSegment(segment.id, { label: event.target.value.slice(0, 40) })}
                />
                <span className="seg-block__count">{segment.tags.length}</span>
                <IconButton
                  label="复制这一组"
                  size="sm"
                  onClick={() => copy(segmentText(segment), `已复制「${segment.label}」`)}
                  disabled={segment.tags.length === 0}
                >
                  <Copy size={13} />
                </IconButton>
                <Menu
                  trigger={
                    <IconButton label="更多块操作" size="sm">
                      <MoreHorizontal size={14} />
                    </IconButton>
                  }
                  items={[
                    {
                      label: '清空这一组',
                      icon: <X size={12} />,
                      disabled: segment.tags.length === 0,
                      onSelect: () => patchSegment(segment.id, { tags: [] }),
                    },
                    {
                      label: '删除这一组',
                      icon: <Trash2 size={12} />,
                      danger: true,
                      separatorBefore: true,
                      onSelect: () => removeSegment(segment.id),
                    },
                  ]}
                />
              </header>

              {isCollapsed ? null : (
                <div className="seg-block__body">
                  <div className="tag-cloud">
                    {segment.tags.map((tag) => (
                      <span className="tag-chip" key={tag.id} data-enabled={tag.enabled !== false}>
                        <button
                          type="button"
                          className="tag-chip__copy"
                          title="点击复制这个 tag"
                          onClick={() => copy(tag.text, '已复制 tag')}
                        >
                          {tag.text}
                        </button>
                        <button
                          type="button"
                          className="tag-chip__x"
                          aria-label={`移除 ${tag.text}`}
                          onClick={() => removeTag(segment.id, tag.id)}
                        >
                          <X size={9} />
                        </button>
                      </span>
                    ))}
                    <input
                      className="tag-cloud__input"
                      placeholder="+ 添加 tag，回车确认"
                      aria-label={`向「${segment.label}」添加 tag`}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addTag(segment.id, event.currentTarget.value);
                          event.currentTarget.value = '';
                        }
                      }}
                      onBlur={(event) => {
                        if (event.currentTarget.value.trim()) {
                          addTag(segment.id, event.currentTarget.value);
                          event.currentTarget.value = '';
                        }
                      }}
                    />
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="segment-editor__foot">
        {availableKinds.length ? (
          <Menu
            align="left"
            direction="up"
            trigger={
              <Button size="sm" variant="ghost" icon={<Plus size={12} />}>
                添加语义块
              </Button>
            }
            items={availableKinds.map((item) => ({
              label: item.label,
              onSelect: () => addBlock(item.kind),
            }))}
          />
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => setQuickOpen((value) => !value)}>
          {quickOpen ? '收起快速导入' : '粘贴原始 Prompt'}
        </Button>
      </div>

      {quickOpen ? (
        <div className="quick-import">
          <TextArea
            mono
            rows={4}
            autoFocus
            value={quickText}
            placeholder="粘贴一段完整 Prompt，自动按语义分块…"
            onChange={(event) => setQuickText(event.target.value)}
          />
          <div className="quick-import__actions">
            <Button size="sm" variant="ghost" onClick={() => setQuickOpen(false)}>
              取消
            </Button>
            <Button size="sm" variant="secondary" disabled={!quickText.trim()} onClick={() => mergeQuick('append')}>
              追加到现有块
            </Button>
            <Button size="sm" variant="primary" disabled={!quickText.trim()} onClick={() => mergeQuick('replace')}>
              替换全部分块
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
