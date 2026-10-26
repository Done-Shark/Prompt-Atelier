import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileText,
  MoreHorizontal,
  Pencil,
  Star,
  Trash2,
} from 'lucide-react';
import { useStore } from '../../app/store';
import { api, downloadUrl } from '../../lib/api';
import { copyText } from '../../lib/clipboard';
import { formatRelative, targetBadgeClass, targetLabel } from '../../lib/format';
import type { ComfyParams, NaiParams, Prompt } from '../../lib/types';
import { Button, ConfirmDialog, EmptyState, IconButton, Menu } from '../../components/ui';
import { PromptText } from '../../components/PromptText';

interface PromptDetailProps {
  onEdit: (id: string) => void;
}

export function PromptDetail({ onEdit }: PromptDetailProps) {
  const { selected, copyPrompt, toggleFavorite, deletePrompt, setFilters, openEditor, toast } = useStore();
  const [expanded, setExpanded] = useState(false);
  const [negativeOpen, setNegativeOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!selected) {
    return (
      <div className="detail">
        <EmptyState
          icon={<FileText size={26} />}
          title="选择一条 Prompt"
          text="左侧列表里点一条查看完整内容与参数。双击可以直接编辑。"
          action={
            <Button variant="secondary" onClick={() => openEditor(null)}>
              新建 Prompt
            </Button>
          }
        />
      </div>
    );
  }

  const prompt = selected;
  const isLong = prompt.positive.length > 360 || prompt.positive.split('\n').length > 6;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deletePrompt(prompt.id);
      toast('已删除 Prompt');
      setConfirmDelete(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : '删除失败', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="detail">
      <header className="detail__head">
        <div className="detail__title-row">
          <h2 className="detail__title" title={prompt.title}>
            {prompt.title}
          </h2>
          <IconButton
            label={prompt.favorite ? '取消收藏' : '收藏'}
            size="sm"
            onClick={() => toggleFavorite(prompt)}
          >
            <Star size={14} fill={prompt.favorite ? 'currentColor' : 'none'} color={prompt.favorite ? 'var(--accent)' : undefined} />
          </IconButton>
          <Menu
            trigger={
              <IconButton label="更多操作" size="sm">
                <MoreHorizontal size={14} />
              </IconButton>
            }
            items={[
              { label: '编辑', icon: <Pencil size={12} />, onSelect: () => onEdit(prompt.id) },
              {
                label: '复制为 NAI 文本',
                icon: <Copy size={12} />,
                onSelect: () => copyPrompt(prompt, 'nai'),
              },
              {
                label: '复制为 ComfyUI 文本',
                icon: <Copy size={12} />,
                onSelect: () => copyPrompt(prompt, 'comfyui'),
              },
              ...(prompt.target === 'comfyui' && (prompt.params as ComfyParams).workflow
                ? [
                    {
                      label: '复制 workflow JSON',
                      icon: <Copy size={12} />,
                      onSelect: () => copyPrompt(prompt, 'comfyui', 'workflow'),
                    },
                  ]
                : []),
              {
                label: '导出这条',
                icon: <Download size={12} />,
                onSelect: () => {
                  downloadUrl(api.prompts.exportUrl({ ids: [prompt.id] }), `${prompt.title}.json`);
                  toast('已导出');
                },
                separatorBefore: true,
              },
              {
                label: '删除',
                icon: <Trash2 size={12} />,
                danger: true,
                onSelect: () => setConfirmDelete(true),
                separatorBefore: true,
              },
            ]}
          />
        </div>
        <div className="detail__badges">
          <span className={`badge ${targetBadgeClass(prompt.target)}`}>
            {targetLabel(prompt.target)}
          </span>
          {prompt.origin === 'image' ? <span className="badge">来自图片</span> : null}
          {prompt.origin === 'import' ? <span className="badge">导入</span> : null}
          <span className="detail__time">更新于 {formatRelative(prompt.updatedAt)}</span>
        </div>
      </header>

      <div className="detail__scroll">
        <section className="detail__section">
          <div className="section__head">
            <h3 className="section__title">正向 Prompt</h3>
            <Button
              size="sm"
              variant="ghost"
              icon={<Copy size={12} />}
              onClick={() => copyPrompt(prompt, prompt.target)}
            >
              复制
            </Button>
          </div>
          {prompt.positive ? (
            <>
              <div className="detail__prompt">
                <PromptText text={prompt.positive} clamp={!expanded && isLong ? 9 : undefined} />
              </div>
              {isLong ? (
                <button type="button" className="detail__expand" onClick={() => setExpanded((value) => !value)}>
                  {expanded ? '收起' : '展开全部'}
                  {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
              ) : null}
            </>
          ) : (
            <p className="muted">还没有正向 Prompt。</p>
          )}
        </section>

        <section className="detail__section">
          <button type="button" className="detail__collapse" onClick={() => setNegativeOpen((value) => !value)}>
            {negativeOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span className="section__title">负面 Prompt</span>
            {!negativeOpen && prompt.negative ? (
              <span className="detail__collapse-summary">{prompt.negative.replace(/\s+/g, ' ').slice(0, 40)}</span>
            ) : null}
          </button>
          {negativeOpen ? (
            prompt.negative ? (
              <>
                <div className="detail__prompt detail__prompt--negative">
                  <PromptText text={prompt.negative} />
                </div>
                <div className="detail__inline-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Copy size={12} />}
                    onClick={async () => {
                      try {
                        await copyText(prompt.negative);
                        toast('已复制负面 Prompt');
                      } catch {
                        toast('复制失败', 'error');
                      }
                    }}
                  >
                    复制负面
                  </Button>
                </div>
              </>
            ) : (
              <p className="muted">没有负面 Prompt。</p>
            )
          ) : null}
        </section>

        <section className="detail__section">
          <div className="section__head">
            <h3 className="section__title">参数</h3>
          </div>
          <dl className="param-table">
            {paramRows(prompt).map((row) => (
              <div className="param-table__row" key={row.label}>
                <dt>{row.label}</dt>
                <dd className="mono" title={row.value}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {prompt.tags.length ? (
          <section className="detail__section">
            <div className="section__head">
              <h3 className="section__title">标签</h3>
            </div>
            <div className="detail__tags">
              {prompt.tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="chip"
                  onClick={() => setFilters({ tag, folderId: 'all', favorite: false })}
                  title={`筛选标签 ${tag}`}
                >
                  <span className="chip__text">#{tag}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {prompt.notes ? (
          <section className="detail__section">
            <div className="section__head">
              <h3 className="section__title">笔记</h3>
            </div>
            <p className="detail__notes">{prompt.notes}</p>
          </section>
        ) : null}

        <section className="detail__section detail__section--meta">
          <div className="meta-row">
            <span>使用次数</span>
            <span className="mono">{prompt.usageCount}</span>
          </div>
          <div className="meta-row">
            <span>创建</span>
            <span className="mono">{formatRelative(prompt.createdAt)}</span>
          </div>
          <div className="meta-row">
            <span>最后使用</span>
            <span className="mono">{prompt.lastUsedAt ? formatRelative(prompt.lastUsedAt) : '—'}</span>
          </div>
          <div className="meta-row">
            <span>ID</span>
            <span className="mono detail__id">{prompt.id}</span>
          </div>
        </section>
      </div>

      <footer className="detail__foot">
        <Button variant="secondary" icon={<Pencil size={13} />} onClick={() => onEdit(prompt.id)}>
          编辑
        </Button>
        <Button variant="primary" icon={<Copy size={13} />} onClick={() => copyPrompt(prompt, prompt.target)}>
          复制
        </Button>
      </footer>

      <ConfirmDialog
        open={confirmDelete}
        title="删除 Prompt"
        message={`「${prompt.title}」将被永久删除。关联的图片不会被删除。`}
        confirmLabel="删除"
        danger
        loading={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
      />
    </div>
  );
}

function paramRows(prompt: Prompt): { label: string; value: string }[] {
  if (prompt.target === 'nai') {
    const params = prompt.params as NaiParams;
    return [
      { label: '模型', value: params.model || '—' },
      { label: '采样器', value: params.sampler || '—' },
      { label: 'Steps', value: String(params.steps ?? '—') },
      { label: 'CFG Scale', value: String(params.scale ?? '—') },
      { label: 'CFG Rescale', value: String(params.cfgRescale ?? '—') },
      { label: 'Seed', value: String(params.seed ?? '—') },
      { label: '尺寸', value: `${params.width} × ${params.height}` },
      { label: 'UC Preset', value: String(params.ucPreset ?? '—') },
      { label: '质量提示词', value: params.qualityToggle ? '开' : '关' },
      { label: 'Variety+', value: params.variety ? '开' : '关' },
    ];
  }
  const params = prompt.params as ComfyParams;
  return [
    { label: 'Checkpoint', value: params.checkpoint || '—' },
    { label: '采样器', value: params.sampler || '—' },
    { label: '调度器', value: params.scheduler || '—' },
    { label: 'Steps', value: String(params.steps ?? '—') },
    { label: 'CFG', value: String(params.cfg ?? '—') },
    { label: 'Seed', value: String(params.seed ?? '—') },
    { label: '尺寸', value: `${params.width} × ${params.height}` },
    { label: 'Batch', value: String(params.batch ?? '—') },
    { label: 'LoRA', value: params.loras?.length ? params.loras.map((lora) => lora.name).join(', ') : '—' },
  ];
}
