/**
 * 后台任务：目录导入。
 * 目的：不阻塞 HTTP 请求，前端轮询进度；逐文件导入，失败只影响单张。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { newId, nowIso } from '../../lib/ids.js';
import { assertExistingDir, walkFiles } from '../../lib/fsx.js';
import { importImages } from '../images/service.js';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const MAX_FILES = 5000;

/** @type {Map<string, any>} */
const jobs = new Map();

function extOf(name) {
  return path.extname(name || '').slice(1).toLowerCase();
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    total: job.total,
    done: job.done,
    imported: job.imported,
    skipped: job.skipped,
    errors: job.errors.slice(0, 50),
    importedItems: job.importedItems.slice(0, 200),
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error || null,
  };
}

export function getJob(id) {
  const job = jobs.get(id);
  return job ? publicJob(job) : null;
}

/**
 * 启动目录导入任务。立即返回任务快照，实际导入在后台串行执行。
 */
export async function startImportFolder(ctx, input = {}) {
  const dir = await assertExistingDir(input.path);
  const recursive = input.recursive !== false;
  const target = ['nai', 'comfyui'].includes(input.target) ? input.target : 'auto';
  const folderId = typeof input.folderId === 'string' && input.folderId ? input.folderId : null;
  const fallbackTarget = ['nai', 'comfyui'].includes(input.fallbackTarget) ? input.fallbackTarget : undefined;

  const files = (await walkFiles(dir, { recursive, maxFiles: MAX_FILES })).filter((file) =>
    IMAGE_EXTS.has(extOf(file)),
  );

  const job = {
    id: newId('job'),
    status: 'running',
    total: files.length,
    done: 0,
    imported: 0,
    skipped: 0,
    errors: [],
    importedItems: [],
    startedAt: nowIso(),
    finishedAt: null,
    error: null,
  };
  jobs.set(job.id, job);

  void (async () => {
    for (const file of files) {
      try {
        const buffer = await fs.readFile(file);
        const result = await importImages(ctx, {
          target,
          fallbackTarget,
          folderId,
          files: [{ name: path.basename(file), data: buffer.toString('base64') }],
        });
        job.imported += result.imported.length;
        job.skipped += result.skipped.length;
        job.importedItems.push(...result.imported);
        for (const item of result.skipped) {
          if (item.reason !== '已存在') job.errors.push({ path: item.path, reason: item.reason });
        }
      } catch (error) {
        job.skipped += 1;
        job.errors.push({ path: file, reason: error instanceof Error ? error.message : String(error) });
      }
      job.done += 1;
    }
    job.status = 'done';
    job.finishedAt = nowIso();
  })().catch((error) => {
    job.status = 'error';
    job.error = error instanceof Error ? error.message : String(error);
    job.finishedAt = nowIso();
  });

  return publicJob(job);
}

/** 只保留最近 20 个任务，避免内存无限增长 */
export function pruneJobs() {
  if (jobs.size <= 20) return;
  const finished = [...jobs.values()]
    .filter((job) => job.status !== 'running')
    .sort((a, b) => String(a.finishedAt).localeCompare(String(b.finishedAt)));
  for (const job of finished.slice(0, jobs.size - 20)) jobs.delete(job.id);
}
