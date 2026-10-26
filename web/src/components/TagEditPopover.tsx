import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Lock, LockOpen, X } from 'lucide-react';
import { TAG_CATEGORIES, type TagCategoryId } from '../../../shared/tagCategories.js';
import { useStore } from '../app/store';
import { api } from '../lib/api';
import { copyText } from '../lib/clipboard';
import type { TagEntry } from '../lib/types';
import { Button, Select, TextInput } from './ui';
import './TagEditPopover.css';

interface TagEditPopoverProps {
  tag: string;
  translation: string;
  category: TagCategoryId;
  reviewed: boolean;
  /** 鼠标位置（视口坐标） */
  x: number;
  y: number;
  onClose: () => void;
  onSaved: (entry: TagEntry) => void;
  onToast: (text: string, tone?: 'ok' | 'error') => void;
}

const WIDTH = 268;
const HEIGHT = 258;
const SAVE_DELAY = 600;

/**
 * Tag 快捷编辑浮层：右键图片详情里的 tag 打开。
 * 翻译 / 分类直接写回 Tag 库；人工改动会自动标记为已修正（批量流程跳过）。
 */
export function TagEditPopover({
  tag,
  translation,
  category,
  reviewed,
  x,
  y,
  onClose,
  onSaved,
  onToast,
}: TagEditPopoverProps) {
  const { tagCategories } = useStore();
  const categoryOptions = tagCategories.length
    ? tagCategories
    : TAG_CATEGORIES.map((entry, index) => ({ ...entry, order: index, builtin: true }));
  const [draft, setDraft] = useState(translation);
  const [currentCategory, setCurrentCategory] = useState<TagCategoryId>(category);
  const [currentReviewed, setCurrentReviewed] = useState(reviewed);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    setDraft(translation);
    setCurrentCategory(category);
    setCurrentReviewed(reviewed);
  }, [tag, translation, category, reviewed]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!cardRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  /** 位置按视口收敛，避免贴边被裁掉 */
  const position = useMemo(() => {
    const left = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - WIDTH - 8));
    const top = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - HEIGHT - 8));
    return { left, top };
  }, [x, y]);

  const save = async (patch: { translation?: string; category?: TagCategoryId; reviewed?: boolean }) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const entry = await api.tags.update({ tag, ...patch });
      setCurrentReviewed(entry.reviewed);
      setCurrentCategory(entry.category);
      setDraft(entry.translation);
      setSavedAt(Date.now());
      onSaved(entry);
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '保存失败', 'error');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const commitTranslation = (value: string) => {
    const next = value.trim();
    if (next === translation) return;
    void save({ translation: next });
  };

  // 输入停顿后自动保存，失焦时补一次
  useEffect(() => {
    if (draft.trim() === translation) return;
    const timer = window.setTimeout(() => commitTranslation(draft), SAVE_DELAY);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, translation]);

  const copy = async (text: string, label: string) => {
    try {
      await copyText(text);
      onToast(`已复制${label}`);
    } catch {
      onToast('复制失败', 'error');
    }
  };

  return (
    <div
      ref={cardRef}
      className="tag-popover"
      style={{ left: position.left, top: position.top, width: WIDTH }}
      role="dialog"
      aria-label={`编辑 tag ${tag}`}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        // 只关浮层，不要把 Esc 继续传给查看器（否则会连大图一起关掉）
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="tag-popover__head">
        <button
          type="button"
          className="tag-popover__tag mono"
          title="复制 tag"
          onClick={() => void copy(tag, ' tag')}
        >
          {tag}
          <Copy size={10} />
        </button>
        <button type="button" className="tag-popover__close" aria-label="关闭" onClick={onClose}>
          <X size={13} />
        </button>
      </header>

      <label className="tag-popover__label" htmlFor={`tag-zh-${tag}`}>
        中文翻译
      </label>
      <TextInput
        id={`tag-zh-${tag}`}
        value={draft}
        placeholder="留空表示不翻译"
        aria-label="中文翻译"
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commitTranslation(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitTranslation(draft);
            event.currentTarget.blur();
          }
        }}
      />

      <label className="tag-popover__label" htmlFor={`tag-cat-${tag}`}>
        分类
      </label>
      <Select
        id={`tag-cat-${tag}`}
        value={currentCategory}
        aria-label="分类"
        options={categoryOptions.map((entry) => ({ value: entry.id, label: entry.label }))}
        onChange={(event) => {
          const next = event.target.value as TagCategoryId;
          setCurrentCategory(next);
          void save({ category: next });
        }}
      />

      <div className="tag-popover__foot">
        <span className="tag-popover__status">
          {saving ? (
            '保存中…'
          ) : savedAt ? (
            <>
              <Check size={11} /> 已同步到 Tag 库
            </>
          ) : currentReviewed ? (
            <>
              <Lock size={11} /> 已修正，批量流程跳过
            </>
          ) : (
            '未修正'
          )}
        </span>
        <Button
          size="sm"
          variant="ghost"
          icon={currentReviewed ? <LockOpen size={11} /> : <Lock size={11} />}
          disabled={saving}
          onClick={() => void save({ reviewed: !currentReviewed })}
        >
          {currentReviewed ? '取消修正' : '标记已修正'}
        </Button>
      </div>
    </div>
  );
}
