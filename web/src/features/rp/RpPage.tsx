import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, IdCard, ImageOff, ListChecks, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { useStore } from '../../app/store';
import { api, fileToBase64 } from '../../lib/api';
import { copyText } from '../../lib/clipboard';
import { formatBytes } from '../../lib/format';
import type { CharacterCard, Folder } from '../../lib/types';
import { Button, ConfirmDialog, EmptyState, IconButton, Menu, Spinner, TextInput } from '../../components/ui';
import { RpEditor } from './RpEditor';
import { RpFolderTree, type RpFolderFilter } from './RpFolderTree';
import { useDragToTarget } from '../../lib/useDragToTarget';
import { ThumbImage } from '../../components/ThumbImage';
import './rp.css';

const RP_THUMB_SOURCE = {
  thumb: (id: string) => api.characters.thumbUrl(id),
  file: (id: string) => api.characters.imageUrl(id),
  save: (id: string, data: string) => api.characters.saveThumb(id, data),
};

const COLLAPSE_KEY = 'atelier:rp:folders-collapsed';

function readCollapsed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(COLLAPSE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

const SOURCE_LABEL: Record<CharacterCard['source'], string> = {
  manual: '手动创建',
  png: 'PNG 角色卡',
  json: 'JSON 角色卡',
};

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : '操作失败';
}

/** RP 角色卡：左侧图片 + 名称，右侧设定 / 简介 / Prompt */
export function RpPage() {
  const { toast } = useStore();
  const [items, setItems] = useState<CharacterCard[]>([]);
  const [total, setTotal] = useState(0);
  const [allTotal, setAllTotal] = useState(0);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<RpFolderFilter>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; card: CharacterCard | null }>({
    open: false,
    card: null,
  });
  const [pendingDelete, setPendingDelete] = useState<CharacterCard | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadFolders = useCallback(async () => {
    try {
      const payload = await api.folders.list({ scope: 'rp' });
      setFolders(payload.items);
    } catch (error) {
      toast(messageOf(error), 'error');
    }
  }, [toast]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const folderId =
        selectedFolder === 'all' ? undefined : selectedFolder === 'root' ? 'root' : selectedFolder;
      const payload = await api.characters.list({
        q: debounced || undefined,
        sort: 'updated',
        folderId,
        limit: 300,
      });
      setItems(payload.items);
      setTotal(payload.total);
      setSelected((current) => {
        const valid = new Set(payload.items.map((item) => item.id));
        return new Set([...current].filter((id) => valid.has(id)));
      });
      const meta = await api.characters.list({ limit: 1 });
      setAllTotal(meta.total);
      setSelectedId((current) =>
        current && payload.items.some((item) => item.id === current) ? current : (payload.items[0]?.id ?? null),
      );
    } catch (error) {
      toast(messageOf(error), 'error');
    } finally {
      setLoading(false);
    }
  }, [debounced, selectedFolder, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedCard = items.find((item) => item.id === selectedId) ?? null;
  const exitSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const batchDelete = async () => {
    if (!selected.size) return;
    setBatchBusy(true);
    try {
      const result = await api.characters.batchDelete([...selected]);
      toast(`已删除 ${result.deleted} 张角色卡`);
      setBatchDeleteOpen(false);
      exitSelect();
      await Promise.all([load(), loadFolders()]);
    } catch (error) {
      toast(messageOf(error), 'error');
    } finally {
      setBatchBusy(false);
    }
  };

  const batchMove = async (folderId: string | null) => {
    if (!selected.size) return;
    setBatchBusy(true);
    try {
      const result = await api.characters.batchMove([...selected], folderId);
      const name = folderId ? folders.find((folder) => folder.id === folderId)?.name : null;
      toast(`已移动 ${result.moved} 张${name ? `到「${name}」` : '到未归档'}`);
      exitSelect();
      await Promise.all([load(), loadFolders()]);
    } catch (error) {
      toast(messageOf(error), 'error');
    } finally {
      setBatchBusy(false);
    }
  };

  const persistCollapsed = (next: Set<string>) => {
    setCollapsed(next);
    window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
  };

  const toggleCollapse = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    persistCollapsed(next);
  };

  const createFolder = async (name: string, parentId: string | null) => {
    try {
      await api.folders.create({ name, parentId, scope: 'rp' });
      toast(parentId ? '已创建子文件夹' : '已创建文件夹');
      if (parentId) {
        const next = new Set(collapsed);
        next.delete(parentId);
        persistCollapsed(next);
      }
      await loadFolders();
    } catch (error) {
      toast(messageOf(error), 'error');
    }
  };

  const renameFolder = async (id: string, name: string) => {
    try {
      await api.folders.update(id, { name });
      toast('已重命名');
      await loadFolders();
    } catch (error) {
      toast(messageOf(error), 'error');
    }
  };

  const deleteFolder = async (id: string) => {
    try {
      await api.folders.remove(id);
      toast('已删除文件夹，角色卡回到未归档');
      if (selectedFolder === id) setSelectedFolder('all');
      await Promise.all([loadFolders(), load()]);
    } catch (error) {
      toast(messageOf(error), 'error');
    }
  };

  const moveFolder = async (id: string, target: { parentId: string | null; beforeId: string | null }) => {
    try {
      await api.folders.move(id, target);
      await loadFolders();
    } catch (error) {
      toast(messageOf(error), 'error');
    }
  };

  /** 拖角色卡到文件夹 / 未归档 */
  const moveCard = async (cardId: string, targetId: string) => {
    const folderId = targetId === 'root' ? null : targetId;
    const folderName = folderId ? folders.find((folder) => folder.id === folderId)?.name : null;
    try {
      await api.characters.update(cardId, { folderId });
      toast(folderName ? `已移动到「${folderName}」` : '已移回未归档');
      await Promise.all([load(), loadFolders()]);
    } catch (error) {
      toast(messageOf(error), 'error');
    }
  };

  const {
    dragId: draggingCardId,
    overTarget: cardOver,
    startDrag: startCardDrag,
    shouldIgnoreClick: shouldIgnoreCardClick,
  } = useDragToTarget({ targetSelector: '[data-card-target]', onDrop: (id, target) => void moveCard(id, target) });

  const importFiles = async (files: File[]) => {
    if (!files.length) return;
    setImporting(true);
    try {
      const payload = await Promise.all(
        files.map(async (file) => ({ name: file.name, data: await fileToBase64(file) })),
      );
      const result = await api.characters.importFiles(payload);
      toast(
        `导入 ${result.imported.length} 个角色卡${result.skipped.length ? `，跳过 ${result.skipped.length} 个` : ''}`,
      );
      if (result.skipped.length) console.warn('[rp] 跳过的文件', result.skipped);
      await Promise.all([loadFolders(), load()]);
      if (result.imported[0]) setSelectedId(result.imported[0].id);
    } catch (error) {
      toast(messageOf(error), 'error');
    } finally {
      setImporting(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.characters.remove(pendingDelete.id);
      toast('已删除角色卡');
      setPendingDelete(null);
      await load();
    } catch (error) {
      toast(messageOf(error), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const copyPrompt = async (text: string) => {
    if (!text.trim()) {
      toast('Prompt 为空', 'error');
      return;
    }
    try {
      await copyText(text);
      toast('已复制 Prompt');
    } catch {
      toast('复制失败', 'error');
    }
  };

  return (
    <div className="rp-page">
      <aside className="rp-folders">
        <RpFolderTree
          folders={folders}
          selected={selectedFolder}
          total={allTotal}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          onCollapseAll={() => persistCollapsed(new Set(folders.map((folder) => folder.id)))}
          onExpandAll={() => persistCollapsed(new Set())}
          onSelect={setSelectedFolder}
          onCreate={createFolder}
          onRename={renameFolder}
          onDelete={deleteFolder}
          onMove={moveFolder}
          cardOver={cardOver}
        />
      </aside>

      <aside className="rp-list">
        <div className="rp-list__head">
          <span className="panel-head__title">角色卡</span>
          <span className="rp-list__count">{total}</span>
          <IconButton
            label={selecting ? '退出批量选择' : '批量选择'}
            size="sm"
            onClick={() => (selecting ? exitSelect() : setSelecting(true))}
          >
            <ListChecks size={13} />
          </IconButton>
          <IconButton
            label="导入角色卡（PNG / JSON）"
            size="sm"
            loading={importing}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={13} />
          </IconButton>
          <IconButton
            label="新建角色卡"
            size="sm"
            onClick={() => setEditor({ open: true, card: null })}
          >
            <Plus size={14} />
          </IconButton>
        </div>

        <div className="rp-list__search">
          <Search size={13} className="rp-list__search-icon" />
          <TextInput
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索名称、标签或设定"
            aria-label="搜索角色卡"
          />
        </div>

        {selecting ? (
          <div className="rp-batch">
            <span className="rp-batch__count">已选 {selected.size} 张</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setSelected(
                  selected.size === items.length ? new Set() : new Set(items.map((item) => item.id)),
                )
              }
            >
              {selected.size === items.length && items.length ? '取消全选' : '全选'}
            </Button>
            <Menu
              trigger={
                <Button size="sm" variant="ghost" loading={batchBusy} disabled={!selected.size}>
                  移动到
                </Button>
              }
              items={[
                { label: '未归档', onSelect: () => void batchMove(null) },
                ...folders.map((folder) => ({
                  label: folder.name,
                  onSelect: () => void batchMove(folder.id),
                })),
              ]}
            />
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={12} />}
              disabled={!selected.size}
              onClick={() => setBatchDeleteOpen(true)}
            >
              删除
            </Button>
            <Button size="sm" variant="ghost" onClick={exitSelect}>
              退出
            </Button>
          </div>
        ) : null}

        <div className="rp-list__scroll">
          {loading && items.length === 0 ? (
            <div className="rp-list__loading">
              <Spinner />
              正在载入…
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<IdCard size={24} />}
              title={total ? '没有匹配的角色卡' : '还没有角色卡'}
              text={total ? '换个关键词试试。' : '导入 SillyTavern 的 PNG / JSON 角色卡，或手动新建。'}
              action={
                total ? null : (
                  <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                    导入角色卡
                  </Button>
                )
              }
            />
          ) : (
            items.map((card) => (
              <button
                type="button"
                key={card.id}
                className="rp-row"
                data-active={card.id === selectedId}
                data-selected={selected.has(card.id)}
                data-dragging={draggingCardId === card.id}
                onPointerDown={(event) => {
                  if (selecting) return;
                  startCardDrag(event, card.id);
                }}
                onClick={() => {
                  if (shouldIgnoreCardClick()) return;
                  if (selecting) {
                    toggleSelect(card.id);
                    return;
                  }
                  setSelectedId(card.id);
                }}
                title={selecting ? card.name : `${card.name}（拖到左侧文件夹可移动）`}
              >
                {selecting ? (
                  <span className="rp-row__check">
                    <input
                      type="checkbox"
                      checked={selected.has(card.id)}
                      readOnly
                      tabIndex={-1}
                      aria-label={`选择 ${card.name}`}
                    />
                  </span>
                ) : null}
                <span className="rp-row__thumb">
                  {card.imageFile ? (
                    <ThumbImage id={card.id} alt={card.name} source={RP_THUMB_SOURCE} />
                  ) : (
                    <IdCard size={18} />
                  )}
                </span>
                <span className="rp-row__body">
                  <span className="rp-row__name">{card.name}</span>
                  <span className="rp-row__tags">
                    {card.tags.length ? card.tags.slice(0, 3).join(' · ') : '无标签'}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="rp-detail">
        {selectedCard ? (
          <>
            <header className="rp-detail__head">
              <div className="rp-detail__cover">
                {selectedCard.imageFile ? (
                  <img src={api.characters.imageUrl(selectedCard.id)} alt={selectedCard.name} />
                ) : (
                  <ImageOff size={26} />
                )}
              </div>
              <div className="rp-detail__title">
                <h1>{selectedCard.name}</h1>
                <div className="rp-tags">
                  {selectedCard.tags.length ? (
                    selectedCard.tags.map((tag) => (
                      <span className="rp-tag" key={tag}>
                        #{tag}
                      </span>
                    ))
                  ) : (
                    <span className="rp-detail__muted">无标签</span>
                  )}
                </div>
                <p className="rp-detail__meta">
                  {SOURCE_LABEL[selectedCard.source]}
                  {selectedCard.originalName ? ` · ${selectedCard.originalName}` : ''}
                  {selectedCard.imageWidth ? ` · ${selectedCard.imageWidth}×${selectedCard.imageHeight}` : ''}
                  {selectedCard.imageBytes ? ` · ${formatBytes(selectedCard.imageBytes)}` : ''}
                </p>
              </div>
              <div className="rp-detail__actions">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Pencil size={12} />}
                  onClick={() => setEditor({ open: true, card: selectedCard })}
                >
                  编辑
                </Button>
                <IconButton label="删除角色卡" size="sm" onClick={() => setPendingDelete(selectedCard)}>
                  <Trash2 size={13} />
                </IconButton>
              </div>
            </header>

            <div className="rp-detail__scroll">
              <section className="rp-section">
                <header className="rp-section__head">
                  <h2>RP 设定</h2>
                </header>
                <p className="rp-section__text">{selectedCard.settings || '（空）'}</p>
              </section>

              <section className="rp-section">
                <header className="rp-section__head">
                  <h2>简介</h2>
                </header>
                <p className="rp-section__text">{selectedCard.description || '（空）'}</p>
              </section>

              <section className="rp-section">
                <header className="rp-section__head">
                  <h2>Prompt</h2>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Copy size={11} />}
                    onClick={() => void copyPrompt(selectedCard.prompt)}
                  >
                    复制
                  </Button>
                </header>
                <pre className="rp-prompt">{selectedCard.prompt || '（空）'}</pre>
              </section>
            </div>
          </>
        ) : (
          <div className="rp-detail__empty">
            <EmptyState
              icon={<IdCard size={26} />}
              title="选择一个角色卡"
              text="左侧列表会显示角色图与名称；导入 SillyTavern 卡片可直接解析设定与 Prompt。"
            />
          </div>
        )}
      </section>

      <RpEditor
        open={editor.open}
        card={editor.card}
        onClose={() => setEditor({ open: false, card: null })}
        folders={folders}
        defaultFolderId={
          selectedFolder === 'all' || selectedFolder === 'root' ? null : selectedFolder
        }
        onSaved={async (card) => {
          setEditor({ open: false, card: null });
          await Promise.all([loadFolders(), load()]);
          setSelectedId(card.id);
        }}
        onToast={toast}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除角色卡"
        message={`「${pendingDelete?.name ?? ''}」会被删除，原图也会从数据目录移除。`}
        confirmLabel="删除"
        danger
        loading={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />

      <ConfirmDialog
        open={batchDeleteOpen}
        title="批量删除角色卡"
        message={`将删除选中的 ${selected.size} 张角色卡，原图在没有其他卡引用时一并移除。`}
        confirmLabel="删除"
        danger
        loading={batchBusy}
        onCancel={() => setBatchDeleteOpen(false)}
        onConfirm={batchDelete}
      />

      <input
        ref={fileRef}
        type="file"
        accept=".png,.json,image/png,application/json"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          if (files.length) void importFiles(files);
          event.target.value = '';
        }}
      />
    </div>
  );
}
