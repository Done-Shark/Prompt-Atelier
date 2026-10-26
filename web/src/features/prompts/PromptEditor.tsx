import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Star } from 'lucide-react';
import { buildSegments, serializeSegments } from '../../../../shared/prompt/doc.js';
import type { PromptSegment } from '../../../../shared/prompt/doc.js';
import { useStore } from '../../app/store';
import { api } from '../../lib/api';
import { targetLabel } from '../../lib/format';
import { copyText } from '../../lib/clipboard';
import type { Folder, Prompt, PromptInput, PromptParams, Target } from '../../lib/types';
import { Button, Field, IconButton, Modal, Segmented, Select, TextArea, TextInput } from '../../components/ui';
import { TagInput } from '../../components/TagInput';
import { SegmentEditor } from './SegmentEditor';
import { ParamsForm } from './ParamsForm';

type Tab = 'content' | 'params' | 'notes';

interface Draft {
  title: string;
  target: Target;
  positive: string;
  segments: PromptSegment[];
  negative: string;
  tags: string[];
  folderId: string | null;
  favorite: boolean;
  notes: string;
  params: PromptParams;
}

function emptyDraft(formats: Record<Target, PromptParams> | null, target: Target): Draft {
  return {
    title: '',
    target,
    positive: '',
    segments: [],
    negative: '',
    tags: [],
    folderId: null,
    favorite: false,
    notes: '',
    params: formats?.[target] ?? ({} as PromptParams),
  };
}

function fromPrompt(prompt: Prompt): Draft {
  return {
    title: prompt.title,
    target: prompt.target,
    positive: prompt.positive,
    // 旧数据没有 segments 时，用原文现场生成，避免保存时把 positive 清空
    segments: prompt.segments && prompt.segments.length ? prompt.segments : buildSegments(prompt.positive),
    negative: prompt.negative,
    tags: prompt.tags,
    folderId: prompt.folderId,
    favorite: prompt.favorite,
    notes: prompt.notes,
    params: prompt.params,
  };
}

function folderOptions(folders: Folder[]): { value: string; label: string }[] {
  const byParent = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const key = folder.parentId;
    byParent.set(key, [...(byParent.get(key) ?? []), folder]);
  }
  const out: { value: string; label: string }[] = [{ value: '', label: '未归档' }];
  const walk = (parentId: string | null, depth: number) => {
    for (const folder of byParent.get(parentId) ?? []) {
      out.push({ value: folder.id, label: `${'　'.repeat(depth)}${folder.name}` });
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function PromptEditor() {
  const { editor, closeEditor, prompts, formats, settings, folders, savePrompt, toast } = useStore();
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(null, 'nai'));
  const [tab, setTab] = useState<Tab>('content');
  const [negativeOpen, setNegativeOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [segmentsDirty, setSegmentsDirty] = useState(false);

  const editing = editor.promptId ? prompts.find((item) => item.id === editor.promptId) ?? null : null;

  useEffect(() => {
    if (!editor.open) return;
    setTab('content');
    setNegativeOpen(false);
    setSegmentsDirty(false);
    if (!editor.promptId) {
      setDraft(emptyDraft(formats, settings?.defaultTarget ?? 'nai'));
      return;
    }
    const local = prompts.find((item) => item.id === editor.promptId);
    if (local) {
      setDraft(fromPrompt(local));
      return;
    }
    setLoading(true);
    api.prompts
      .get(editor.promptId)
      .then((prompt) => setDraft(fromPrompt(prompt)))
      .catch(() => toast('读取 Prompt 失败', 'error'))
      .finally(() => setLoading(false));
    // 只在打开或切换目标 Prompt 时初始化，避免列表刷新覆盖正在编辑的内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.open, editor.promptId]);

  const options = useMemo(
    () => folderOptions(folders.filter((folder) => (folder.scope || 'prompt') === 'prompt')),
    [folders],
  );

  // 只有用户真的改过分块才按分块重算，否则保留原文顺序（positive 是事实来源）
  const positive = segmentsDirty ? serializeSegments(draft.segments) : draft.positive;

  const switchTarget = (target: Target) => {
    if (target === draft.target) return;
    setDraft((current) => ({
      ...current,
      target,
      params: formats?.[target] ?? current.params,
    }));
    toast(`已切换为 ${targetLabel(target)}，参数使用该格式默认值`);
  };

  const save = async () => {
    setSaving(true);
    try {
      const input: PromptInput = {
        title: draft.title,
        target: draft.target,
        positive,
        negative: draft.negative,
        tags: draft.tags,
        folderId: draft.folderId,
        favorite: draft.favorite,
        notes: draft.notes,
        params: draft.params as PromptInput['params'],
        ...(segmentsDirty ? { segments: draft.segments } : {}),
      };
      await savePrompt(input, editor.promptId ?? undefined);
      closeEditor();
      toast(editing ? '已保存修改' : '已创建 Prompt');
    } catch (error) {
      toast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={editor.open}
      onClose={closeEditor}
      size="lg"
      title={editing ? '编辑 Prompt' : '新建 Prompt'}
      description={
        editing
          ? `创建于 ${editing.createdAt.slice(0, 10)} · 已使用 ${editing.usageCount} 次`
          : '按语义分块整理正向 Prompt，块顺序就是输出顺序'
      }
      dismissable={!saving}
      footer={
        <>
          <span className="editor__hint">{positive.length} 字符 · {draft.segments.length} 个块</span>
          <Button variant="ghost" onClick={closeEditor} disabled={saving}>
            取消
          </Button>
          <Button variant="primary" onClick={save} loading={saving}>
            保存
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="boot">
          <span className="spinner" />
          正在读取…
        </div>
      ) : (
        <div className="editor">
          <div className="editor__top">
            <TextInput
              className="editor__title"
              value={draft.title}
              placeholder="给这条 Prompt 起个名字（留空自动截取）"
              aria-label="标题"
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
            <Segmented
              label="目标格式"
              value={draft.target}
              onChange={switchTarget}
              options={[
                { value: 'nai', label: 'NovelAI' },
                { value: 'comfyui', label: 'ComfyUI' },
              ]}
            />
            <IconButton
              label={draft.favorite ? '取消收藏' : '收藏'}
              onClick={() => setDraft({ ...draft, favorite: !draft.favorite })}
            >
              <Star size={15} fill={draft.favorite ? 'currentColor' : 'none'} color={draft.favorite ? 'var(--accent)' : undefined} />
            </IconButton>
          </div>

          <div className="editor__meta">
            <Field label="文件夹" className="editor__meta-item">
              <Select
                value={draft.folderId ?? ''}
                options={options}
                onChange={(event) => setDraft({ ...draft, folderId: event.target.value || null })}
              />
            </Field>
            <Field label="标签" className="editor__meta-item editor__meta-item--grow">
              <TagInput value={draft.tags} onChange={(tags) => setDraft({ ...draft, tags })} />
            </Field>
          </div>

          <div className="tabs" role="tablist" aria-label="编辑分区">
            {(
              [
                ['content', '内容'],
                ['params', '参数'],
                ['notes', '笔记'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                className="tab"
                data-active={tab === value}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'content' ? (
            <div className="editor__content">
              <SegmentEditor
                segments={draft.segments}
                baseline={draft.positive}
                onChange={(segments) => {
                  setSegmentsDirty(true);
                  setDraft((current) => ({ ...current, segments }));
                }}
              />

              <section className="negative">
                <div className="negative__head">
                  <button
                    type="button"
                    className="negative__toggle"
                    onClick={() => setNegativeOpen((value) => !value)}
                    aria-expanded={negativeOpen}
                  >
                    {negativeOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    负面 Prompt
                    <span className="negative__summary">
                      {draft.negative ? draft.negative.replace(/\s+/g, ' ').slice(0, 60) : '（空）'}
                    </span>
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Copy size={12} />}
                    disabled={!draft.negative}
                    onClick={async () => {
                      try {
                        await copyText(draft.negative);
                        toast('已复制负面 Prompt');
                      } catch {
                        toast('复制失败', 'error');
                      }
                    }}
                  >
                    复制
                  </Button>
                </div>
                {negativeOpen ? (
                  <TextArea
                    mono
                    rows={5}
                    value={draft.negative}
                    placeholder="负面提示词"
                    aria-label="负面 Prompt"
                    onChange={(event) => setDraft({ ...draft, negative: event.target.value })}
                  />
                ) : null}
              </section>
            </div>
          ) : null}

          {tab === 'params' ? (
            <ParamsForm
              target={draft.target}
              value={draft.params}
              onChange={(params) => setDraft({ ...draft, params })}
            />
          ) : null}

          {tab === 'notes' ? (
            <div className="editor__notes">
              <TextArea
                rows={10}
                value={draft.notes}
                placeholder="记录这条 Prompt 的来源、适用场景或调整思路…"
                aria-label="笔记"
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              />
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
