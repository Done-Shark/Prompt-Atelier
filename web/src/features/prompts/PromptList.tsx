import { useRef, useState } from 'react';
import { ImagePlus, Inbox, Plus, SearchX, Star } from 'lucide-react';
import { useStore } from '../../app/store';
import { formatRelative, targetBadgeClass, targetShort } from '../../lib/format';
import type { Prompt, SortKey } from '../../lib/types';
import { Button, EmptyState, Segmented, Select } from '../../components/ui';
import { PromptText } from '../../components/PromptText';
import { ImagePickerDialog } from '../../components/ImagePickerDialog';
import { ThumbImage } from '../../components/ThumbImage';

interface PromptListProps {
  onEdit: (id: string) => void;
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'updated', label: '最近更新' },
  { value: 'created', label: '创建时间' },
  { value: 'title', label: '标题' },
  { value: 'usage', label: '使用次数' },
];

export function PromptList({ onEdit }: PromptListProps) {
  const {
    prompts,
    promptTotal,
    promptsLoading,
    filters,
    setFilters,
    resetFilters,
    selectedId,
    selectPrompt,
    stats,
    openEditor,
    loadMorePrompts,
    setPromptExampleImage,
    toast,
  } = useStore();
  const listRef = useRef<HTMLDivElement>(null);
  const [exampleFor, setExampleFor] = useState<Prompt | null>(null);

  const hasFilter = Boolean(filters.q || filters.tag || filters.favorite || filters.folderId !== 'all' || filters.target !== 'all');

  const moveSelection = (delta: number) => {
    if (!prompts.length) return;
    const index = prompts.findIndex((item) => item.id === selectedId);
    const next = Math.min(prompts.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta));
    const target = prompts[next];
    if (!target) return;
    selectPrompt(target.id);
    listRef.current?.querySelector<HTMLElement>(`[data-id="${target.id}"]`)?.focus();
  };

  return (
    <div className="prompt-list">
      <div className="toolbar">
        <Segmented
          label="目标格式"
          value={filters.target}
          onChange={(target) => setFilters({ target })}
          options={[
            { value: 'all', label: '全部' },
            { value: 'nai', label: 'NAI', count: stats?.naiPrompts },
            { value: 'comfyui', label: 'ComfyUI', count: stats?.comfyPrompts },
          ]}
        />
        {filters.tag ? (
          <button type="button" className="badge badge--accent" onClick={() => setFilters({ tag: null })} title="清除标签筛选">
            #{filters.tag} ×
          </button>
        ) : null}
        <span className="toolbar__spacer" />
        <span className="toolbar__count">{promptTotal} 条</span>
        <Select
          value={filters.sort}
          options={SORT_OPTIONS}
          aria-label="排序"
          onChange={(event) => setFilters({ sort: event.target.value as SortKey })}
          style={{ width: 116 }}
        />
        <Button
          variant="primary"
          size="sm"
          icon={<Plus size={13} />}
          onClick={() => openEditor(null)}
          title="新建 Prompt（Ctrl/Cmd + N）"
        >
          新建 Prompt
        </Button>
      </div>

      <div
        className="prompt-list__scroll"
        ref={listRef}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveSelection(1);
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveSelection(-1);
          }
        }}
      >
        {promptsLoading && prompts.length === 0 ? (
          <div className="boot">
            <span className="spinner" />
            正在加载…
          </div>
        ) : prompts.length === 0 ? (
          hasFilter ? (
            <EmptyState
              icon={<SearchX size={26} />}
              title="没有匹配的 Prompt"
              text="换个关键词，或清除筛选条件。"
              action={
                <Button variant="secondary" onClick={resetFilters}>
                  清除筛选
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Inbox size={26} />}
              title="还没有 Prompt"
              text="把常用的提示词存进来，按语义分块整理，随时复制到 NAI 或 ComfyUI。"
              action={
                <Button variant="primary" onClick={() => openEditor(null)}>
                  新建第一条
                </Button>
              }
            />
          )
        ) : (
          prompts.map((prompt) => (
            <div
              key={prompt.id}
              data-id={prompt.id}
              className="prompt-row"
              data-active={prompt.id === selectedId}
              role="button"
              tabIndex={0}
              onClick={() => selectPrompt(prompt.id)}
              onDoubleClick={() => onEdit(prompt.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  selectPrompt(prompt.id);
                }
              }}
            >
              <button
                type="button"
                className="prompt-row__thumb"
                data-empty={!prompt.exampleImageId}
                title={prompt.exampleImageId ? '更换示例图' : '设置示例图'}
                aria-label={prompt.exampleImageId ? '更换示例图' : '设置示例图'}
                onClick={(event) => {
                  event.stopPropagation();
                  setExampleFor(prompt);
                }}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                {prompt.exampleImageId ? (
                  <ThumbImage
                    id={prompt.exampleImageId}
                    alt={`${prompt.title} 示例图`}
                    className="prompt-row__thumb-img"
                  />
                ) : (
                  <ImagePlus size={15} />
                )}
              </button>
              <div className="prompt-row__main">
                <div className="prompt-row__title">
                  {prompt.favorite ? <Star size={12} className="prompt-row__star" fill="currentColor" /> : null}
                  <span>{prompt.title}</span>
                </div>
                <div className="prompt-row__snippet">
                  {prompt.positive ? <PromptText text={prompt.positive} clamp={2} /> : <span className="muted">（空 Prompt）</span>}
                </div>
                {prompt.tags.length ? (
                  <div className="prompt-row__tags">
                    {prompt.tags.slice(0, 3).map((tag) => (
                      <span className="prompt-row__tag" key={tag}>
                        #{tag}
                      </span>
                    ))}
                    {prompt.tags.length > 3 ? <span className="prompt-row__tag">+{prompt.tags.length - 3}</span> : null}
                  </div>
                ) : null}
              </div>
              <div className="prompt-row__meta">
                <span className={`badge ${targetBadgeClass(prompt.target)}`}>{targetShort(prompt.target)}</span>
                <span className="prompt-row__time">{formatRelative(prompt.updatedAt)}</span>
              </div>
            </div>
          ))
        )}
        {promptTotal > prompts.length ? (
          <div className="prompt-list__more">
            <Button variant="secondary" loading={promptsLoading} onClick={() => void loadMorePrompts()}>
              加载更多
            </Button>
            <span className="toolbar__count">还有 {promptTotal - prompts.length} 条</span>
          </div>
        ) : null}
      </div>

      <ImagePickerDialog
        open={Boolean(exampleFor)}
        hint={
          exampleFor
            ? `给「${exampleFor.title}」选一张示例图，会显示在这一行的左侧。`
            : undefined
        }
        currentId={exampleFor?.exampleImageId ?? null}
        onClose={() => setExampleFor(null)}
        onSelect={async (imageId) => {
          if (!exampleFor) return;
          try {
            await setPromptExampleImage(exampleFor.id, imageId);
            toast(imageId ? '已设置示例图' : '已移除示例图');
          } catch (error) {
            toast(error instanceof Error ? error.message : '设置失败', 'error');
          }
        }}
      />
    </div>
  );
}
