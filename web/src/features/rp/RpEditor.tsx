import { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { api, fileToBase64 } from '../../lib/api';
import type { CharacterCard, CharacterInput, Folder } from '../../lib/types';
import { Button, Modal, Select, TextArea, TextInput } from '../../components/ui';

interface RpEditorProps {
  open: boolean;
  card: CharacterCard | null;
  folders: Folder[];
  /** 新建时的默认归属（当前选中的文件夹） */
  defaultFolderId: string | null;
  onClose: () => void;
  onSaved: (card: CharacterCard) => void | Promise<void>;
  onToast: (text: string, tone?: 'ok' | 'error') => void;
}

function splitTags(value: string) {
  return [...new Set(value.split(/[,，、\n]/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 50);
}

/** 新建 / 编辑角色卡：图片、标签、设定、简介、Prompt */
export function RpEditor({ open, card, folders, defaultFolderId, onClose, onSaved, onToast }: RpEditorProps) {
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');
  const [settings, setSettings] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [folderId, setFolderId] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(card?.name ?? '');
    setTags(card?.tags.join(', ') ?? '');
    setSettings(card?.settings ?? '');
    setDescription(card?.description ?? '');
    setPrompt(card?.prompt ?? '');
    setFolderId(card?.folderId ?? defaultFolderId ?? '');
    setImage(null);
    setImageName(null);
    setPreview(card?.imageFile ? api.characters.imageUrl(card.id) : null);
  }, [open, card, defaultFolderId]);

  const folderOptions = useMemo(() => {
    const byParent = new Map<string | null, Folder[]>();
    for (const folder of folders) {
      byParent.set(folder.parentId, [...(byParent.get(folder.parentId) ?? []), folder]);
    }
    for (const list of byParent.values()) {
      list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-Hans'));
    }
    const out = [{ value: '', label: '未归档' }];
    const walk = (parentId: string | null, depth: number) => {
      for (const folder of byParent.get(parentId) ?? []) {
        out.push({ value: folder.id, label: `${'　'.repeat(depth)}${folder.name}` });
        walk(folder.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [folders]);

  const pickImage = async (file: File) => {
    try {
      const base64 = await fileToBase64(file);
      setImage(base64);
      setImageName(file.name);
      const mime = file.type || (file.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
      setPreview(`data:${mime};base64,${base64}`);
    } catch {
      onToast('读取图片失败', 'error');
    }
  };

  const save = async () => {
    if (!name.trim()) {
      onToast('请填写名称', 'error');
      return;
    }
    setSaving(true);
    try {
      const input: CharacterInput = {
        name: name.trim(),
        tags: splitTags(tags),
        settings,
        description,
        prompt,
        folderId: folderId || null,
      };
      if (image) input.image = image;
      const saved = card
        ? await api.characters.update(card.id, input)
        : await api.characters.create({
            ...input,
            source: 'manual',
            originalName: imageName ?? null,
          });
      onToast(card ? '已保存角色卡' : '已创建角色卡');
      await onSaved(saved);
    } catch (error) {
      onToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={card ? '编辑角色卡' : '新建角色卡'}
      size="lg"
      dismissable={!saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!name.trim()}>
            保存
          </Button>
        </>
      }
    >
      <div className="rp-editor">
        <div className="rp-editor__image">
          <button
            type="button"
            className="rp-editor__preview"
            onClick={() => fileRef.current?.click()}
            title={preview ? '更换原图' : '选择原图'}
          >
            {preview ? <img src={preview} alt="角色卡原图" /> : <ImagePlus size={20} />}
          </button>
          <div className="rp-editor__image-meta">
            <Button size="sm" variant="secondary" icon={<ImagePlus size={12} />} onClick={() => fileRef.current?.click()}>
              {preview ? '更换原图' : '选择原图'}
            </Button>
            <p className="rp-editor__hint">
              原图会按原始字节保存到 <code>data/images/rp/</code>，不压缩、不转码。
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void pickImage(file);
              event.target.value = '';
            }}
          />
        </div>

        <div className="rp-editor__row">
          <label className="rp-editor__field">
            <span>名称</span>
            <TextInput
              autoFocus
              value={name}
              placeholder="角色名"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="rp-editor__field">
            <span>RP 标签</span>
            <TextInput
              value={tags}
              placeholder="骑士, 银发, 奇幻"
              onChange={(event) => setTags(event.target.value)}
            />
          </label>
        </div>

        <label className="rp-editor__field">
          <span>RP 设定</span>
          <TextArea
            rows={6}
            value={settings}
            placeholder="性格、世界观、场景等设定"
            onChange={(event) => setSettings(event.target.value)}
          />
        </label>

        <label className="rp-editor__field">
          <span>文件夹</span>
          <Select
            value={folderId}
            options={folderOptions}
            aria-label="所属文件夹"
            onChange={(event) => setFolderId(event.target.value)}
          />
        </label>

        <label className="rp-editor__field">
          <span>简介</span>
          <TextArea
            rows={3}
            value={description}
            placeholder="一句话简介或作者备注"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>

        <label className="rp-editor__field">
          <span>Prompt（可复制）</span>
          <TextArea
            rows={6}
            mono
            value={prompt}
            placeholder="可直接粘贴到 SillyTavern 的角色描述"
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}
