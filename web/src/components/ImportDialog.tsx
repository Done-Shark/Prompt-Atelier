import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FolderOpen, Upload, X } from 'lucide-react';
import { useStore } from '../app/store';
import { api, fileToBase64 } from '../lib/api';
import { formatBytes, targetBadgeClass, targetShort } from '../lib/format';
import type { ImportImagesResult, LibraryImage, ScanPreviewEntry, Target } from '../lib/types';
import { Button, IconButton, Modal, Segmented, Spinner, Switch, TextInput } from './ui';
import './ImportDialog.css';

type ImportTarget = 'auto' | Target;
type ImportTab = 'folder' | 'upload';

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  initialPath?: string;
  initialTarget?: Target;
  /** 导入后直接归档到该图片文件夹 */
  initialFolderId?: string | null;
  initialFolderName?: string | null;
}

const IMAGE_NAME = /\.(png|jpe?g|webp)$/i;
/** 单次请求的 base64 估算上限：服务端请求体上限 32MB，留出 JSON 结构余量 */
const MAX_BATCH_BYTES = 20 * 1024 * 1024;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return '操作失败';
}

export function ImportDialog({
  open,
  onClose,
  onImported,
  initialPath,
  initialTarget,
  initialFolderId = null,
  initialFolderName = null,
}: ImportDialogProps) {
  const { settings } = useStore();
  const [tab, setTab] = useState<ImportTab>('folder');
  const [target, setTarget] = useState<ImportTarget>('auto');
  const [path, setPath] = useState('');
  const [recursive, setRecursive] = useState(true);

  const [entries, setEntries] = useState<ScanPreviewEntry[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);

  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportImagesResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const seededRef = useRef<string | null>(null);

  const runScan = useCallback(async (value: string, scanTarget: ImportTarget, recursiveFlag: boolean) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setScanError('先填写要扫描的目录');
      return;
    }
    setScanning(true);
    setScanError(null);
    setEntries(null);
    setResult(null);
    try {
      // api.ts 的 scan 签名只声明 Target，但后端把非 nai/comfyui 的 target 视为“未强制”，
      // 传 auto 才能拿到逐条识别结果。
      const payload = await api.images.scan({
        target: (scanTarget === 'auto' ? 'auto' : scanTarget) as Target,
        path: trimmed,
        recursive: recursiveFlag,
      });
      setEntries(payload.entries);
      if (!payload.entries.length) setScanError('这个目录里没有可导入的图片');
    } catch (cause) {
      setScanError(messageOf(cause));
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      seededRef.current = null;
      return;
    }
    const nextTarget: ImportTarget = initialTarget ?? 'auto';
    setTab('folder');
    setTarget(nextTarget);
    setPath(initialPath ?? '');
    setEntries(null);
    setScanError(null);
    setFiles([]);
    setResult(null);
    setError(null);
    setProgress(null);
    setDragging(false);

    if (initialPath) {
      const key = `${initialPath}|${nextTarget}`;
      if (seededRef.current !== key) {
        seededRef.current = key;
        void runScan(initialPath, nextTarget, true);
      }
    }
  }, [open, initialPath, initialTarget, runScan]);

  if (!open) return null;

  const fallbackTarget: Target =
    target === 'auto' ? (initialTarget ?? settings?.defaultTarget ?? 'nai') : target;
  const importable = entries ? entries.filter((entry) => !entry.alreadyImported).length : 0;

  const browse = async () => {
    const bridge = window.atelier;
    if (!bridge) return;
    try {
      const dir = await bridge.chooseDirectory();
      if (dir) {
        setPath(dir);
        setEntries(null);
        setScanError(null);
      }
    } catch {
      setScanError('无法打开目录选择器');
    }
  };

  const addFiles = (list: FileList | File[]) => {
    const accepted: File[] = [];
    let rejected = 0;
    for (const file of Array.from(list)) {
      if (IMAGE_NAME.test(file.name)) accepted.push(file);
      else rejected += 1;
    }
    if (rejected) setError(`已忽略 ${rejected} 个不支持的文件（只支持 PNG / JPEG / WebP）`);
    setFiles((current) => {
      const known = new Set(current.map((file) => `${file.name}:${file.size}`));
      return [...current, ...accepted.filter((file) => !known.has(`${file.name}:${file.size}`))];
    });
    setResult(null);
    setError(null);
  };

  const handleImport = async () => {
    if (importing) return;
    setError(null);

    if (tab === 'folder') {
      if (!entries || !entries.length) return;
      setImporting(true);
      setProgress({ done: 0, total: entries.length });
      try {
        let job = await api.jobs.importFolder({
          target,
          path: path.trim(),
          recursive,
          fallbackTarget,
          folderId: initialFolderId,
        });
        setProgress({ done: 0, total: job.total });
        while (job.status === 'running') {
          await new Promise((resolve) => setTimeout(resolve, 350));
          job = await api.jobs.get(job.id);
          setProgress({ done: job.done, total: job.total });
        }
        if (job.status === 'error') throw new Error(job.error || '目录导入失败');
        setResult({
          imported: job.importedItems,
          skipped: job.errors,
          scanned: job.total,
        });
      } catch (cause) {
        setError(messageOf(cause));
      } finally {
        setImporting(false);
        setProgress(null);
        onImported();
      }
      return;
    }

    if (!files.length) return;
    setImporting(true);
    setProgress({ done: 0, total: files.length });
    const imported: LibraryImage[] = [];
    const skipped: { path: string; reason: string }[] = [];
    try {
      // 按 base64 后的估算体积分批，避免整批超过服务端 32MB 请求体上限
      const batches: File[][] = [];
      let current: File[] = [];
      let currentBytes = 0;
      for (const file of files) {
        const estimate = Math.ceil(file.size * (4 / 3)) + 1024;
        if (current.length && currentBytes + estimate > MAX_BATCH_BYTES) {
          batches.push(current);
          current = [];
          currentBytes = 0;
        }
        current.push(file);
        currentBytes += estimate;
      }
      if (current.length) batches.push(current);

      let done = 0;
      for (const batch of batches) {
        const payloads = await Promise.all(
          batch.map(async (file) => ({ name: file.name, data: await fileToBase64(file) })),
        );
        const payload = await api.images.importFiles({
          target,
          fallbackTarget,
          folderId: initialFolderId,
          files: payloads,
        });
        imported.push(...payload.imported);
        skipped.push(...payload.skipped);
        done += batch.length;
        setProgress({ done, total: files.length });
      }
      setResult({ imported, skipped, scanned: files.length });
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setImporting(false);
      setProgress(null);
      onImported();
    }
  };

  const progressText = progress
    ? progress.done > 0
      ? `正在导入 ${progress.done}/${progress.total}`
      : `正在导入 ${progress.total} 张…`
    : '正在导入…';

  const canImport = tab === 'folder' ? importable > 0 : files.length > 0;

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!importing) onClose();
      }}
      title="导入图片"
      description="从 NAI / ComfyUI 的输出目录导入，或直接拖入文件。重复图片会自动跳过。"
      size="lg"
      dismissable={!importing}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            完成
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={importing}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void handleImport()} loading={importing} disabled={!canImport}>
              {tab === 'folder' ? `导入 ${importable} 张` : `导入 ${files.length} 个文件`}
            </Button>
          </>
        )
      }
    >
      <div className="import-dialog">
        {initialFolderName ? (
          <p className="import-folder-hint">
            导入后归档到文件夹：<strong>{initialFolderName}</strong>
          </p>
        ) : null}
        <div className="import-target">
          <span className="import-label">目标</span>
          <Segmented
            label="导入目标"
            value={target}
            onChange={setTarget}
            options={[
              { value: 'auto', label: '自动识别' },
              { value: 'nai', label: '强制 NAI' },
              { value: 'comfyui', label: '强制 ComfyUI' },
            ]}
          />
          <span className="import-hint">自动识别读取 PNG 元数据；识别不到时归入默认目标。</span>
        </div>

        <div className="import-tabs" role="tablist" aria-label="导入方式">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'folder'}
            className="import-tab"
            data-active={tab === 'folder'}
            onClick={() => setTab('folder')}
            disabled={importing}
          >
            扫描目录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'upload'}
            className="import-tab"
            data-active={tab === 'upload'}
            onClick={() => setTab('upload')}
            disabled={importing}
          >
            拖拽上传
          </button>
        </div>

        {result ? (
          <div className="import-result">
            <div className="import-result__head">
              <CheckCircle2 size={16} className="import-result__icon" />
              导入完成
            </div>
            <p className="import-result__summary">
              成功 {result.imported.length} 张，跳过 {result.skipped.length} 张
              {result.scanned ? `（共处理 ${result.scanned} 个文件）` : ''}。
            </p>
            {result.skipped.length ? (
              <ul className="import-result__list">
                {result.skipped.slice(0, 3).map((item, index) => (
                  <li key={`${item.path}-${index}`}>
                    <span className="mono">{item.path}</span>
                    <span className="import-result__reason">{item.reason}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : tab === 'folder' ? (
          <div className="import-pane">
            <div className="import-row">
              <div className="import-path">
                <TextInput
                  value={path}
                  onChange={(event) => {
                    setPath(event.target.value);
                    setEntries(null);
                    setScanError(null);
                  }}
                  placeholder="D:/NovelAI/outputs"
                  aria-label="扫描目录路径"
                  spellCheck={false}
                  disabled={importing}
                />
              </div>
              {window.atelier ? (
                <Button variant="secondary" icon={<FolderOpen size={13} />} onClick={() => void browse()} disabled={importing}>
                  浏览…
                </Button>
              ) : null}
              <Button
                variant="secondary"
                onClick={() => void runScan(path, target, recursive)}
                loading={scanning}
                disabled={importing || !path.trim()}
              >
                扫描
              </Button>
            </div>

            <Switch checked={recursive} onChange={setRecursive} label="包含子目录" disabled={importing} />

            {scanError ? (
              <p className="import-error" role="alert">
                <AlertCircle size={13} />
                {scanError}
              </p>
            ) : null}

            {entries && entries.length ? (
              <div className="import-preview">
                <div className="import-preview__head">
                  找到 {entries.length} 张
                  {entries.length - importable > 0 ? `，其中 ${entries.length - importable} 张已存在` : ''}
                </div>
                <ul className="import-preview__list">
                  {entries.map((entry) => (
                    <li className="import-preview__row" key={entry.path}>
                      <span className="import-preview__name" title={entry.path}>
                        {entry.fileName}
                      </span>
                      <span className={`badge ${targetBadgeClass(entry.target)}`}>
                        {targetShort(entry.target)}
                      </span>
                      {entry.alreadyImported ? <span className="badge">已存在</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {scanning ? (
              <div className="import-progress">
                <Spinner />
                正在扫描目录…
              </div>
            ) : null}
          </div>
        ) : (
          <div className="import-pane">
            <div
              className="import-drop"
              data-dragging={dragging}
              role="button"
              tabIndex={0}
              aria-label="选择或拖入图片文件"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (!importing) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (!importing) addFiles(event.dataTransfer.files);
              }}
            >
              <Upload size={22} className="import-drop__icon" />
              <p className="import-drop__title">把图片拖到这里</p>
              <p className="import-drop__text">或点击选择文件 · 支持 PNG / JPEG / WebP</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(event) => {
                  if (event.target.files) addFiles(event.target.files);
                  event.target.value = '';
                }}
              />
            </div>

            {files.length ? (
              <ul className="import-files">
                {files.map((file, index) => (
                  <li className="import-files__row" key={`${file.name}-${file.size}-${index}`}>
                    <span className="import-files__name" title={file.name}>
                      {file.name}
                    </span>
                    <span className="import-files__size mono">{formatBytes(file.size)}</span>
                    <IconButton
                      label={`移除 ${file.name}`}
                      size="sm"
                      disabled={importing}
                      onClick={() => setFiles((current) => current.filter((_, item) => item !== index))}
                    >
                      <X size={12} />
                    </IconButton>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}

        {importing ? (
          <div className="import-progress" role="status">
            <Spinner />
            {progressText}
          </div>
        ) : null}

        {error ? (
          <p className="import-error" role="alert">
            <AlertCircle size={13} />
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
