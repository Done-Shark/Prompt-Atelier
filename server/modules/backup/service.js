/**
 * 整库备份 / 恢复（文件夹式）。
 *
 * 备份目录结构：
 *   PromptAtelier-backup-YYYYMMDD-HHmmss/
 *   ├─ manifest.json   版本、导出时间、各类数量
 *   ├─ data.json       设置 / Prompt / 图片索引 / 文件夹 / Tag / 别名 / 相册 / RP 角色卡
 *   ├─ images/         原图（nai / comfyui / rp）
 *   └─ thumbs/         缩略图缓存
 *
 * 说明：
 * - 备份不包含 `translation.apiKey`，恢复时沿用当前机器已配置的 Key；
 * - 恢复前会把当前 data.json 另存到 <data>/backups/pre-restore-*，图片只覆盖不删除。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ApiError } from '../../lib/errors.js';
import { ensureDir, pathExists } from '../../lib/fsx.js';
import { migrate } from '../../store/schema.js';

const APP = 'prompt-atelier';
const FORMAT = 1;

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(
    date.getMinutes(),
  )}${pad(date.getSeconds())}`;
}

async function dirSize(root) {
  let total = 0;
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else {
      const stat = await fs.stat(full).catch(() => null);
      if (stat) total += stat.size;
    }
  }
  return total;
}

function requireDir(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw ApiError.validation(`请选择${label}`);
  return path.resolve(value.trim());
}

async function readManifest(dir) {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!(await pathExists(manifestPath))) throw ApiError.validation('不是有效的备份目录（缺少 manifest.json）');
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch {
    throw ApiError.validation('manifest.json 无法解析');
  }
  if (manifest?.app !== APP || manifest?.format !== FORMAT) {
    throw ApiError.validation('备份格式不兼容（app 或 format 不匹配）');
  }
  if (!(await pathExists(path.join(dir, 'data.json')))) {
    throw ApiError.validation('备份缺少 data.json');
  }
  return manifest;
}

/** POST /api/backup/export */
export async function exportBackup(ctx, body = {}) {
  const targetDir = requireDir(body.targetDir, '备份目录');
  if (!(await pathExists(targetDir))) throw ApiError.validation('备份目录不存在');

  const dataDir = path.resolve(ctx.config.dataDir);
  if (targetDir === dataDir || targetDir.startsWith(`${dataDir}${path.sep}`)) {
    throw ApiError.validation('备份目录不能位于数据目录内');
  }

  const snap = ctx.db.snapshot();
  const dir = path.join(targetDir, `PromptAtelier-backup-${stamp()}`);
  await ensureDir(dir);

  const settings = structuredClone(snap.settings || {});
  delete settings.dataDir;
  const secretsOmitted = [];
  if (settings.translation?.apiKey) {
    settings.translation.apiKey = '';
    secretsOmitted.push('translation.apiKey');
  }

  const data = {
    version: snap.version,
    settings,
    folders: snap.folders || [],
    prompts: snap.prompts || [],
    images: snap.images || [],
    albums: snap.albums || [],
    tags: snap.tags || [],
    tagCategories: snap.tagCategories || [],
    tagAliases: snap.tagAliases || [],
    characters: snap.characters || [],
    imageRaw: snap.imageRaw || [],
    tagHistory: [],
  };
  await fs.writeFile(path.join(dir, 'data.json'), JSON.stringify(data, null, 2), 'utf8');

  let bytes = 0;
  if (await pathExists(ctx.config.imagesDir)) {
    const dest = path.join(dir, 'images');
    await fs.cp(ctx.config.imagesDir, dest, { recursive: true });
    bytes += await dirSize(dest);
  }
  if (await pathExists(ctx.config.thumbsDir)) {
    const dest = path.join(dir, 'thumbs');
    await fs.cp(ctx.config.thumbsDir, dest, { recursive: true });
    bytes += await dirSize(dest);
  }

  const manifest = {
    app: APP,
    format: FORMAT,
    version: snap.version,
    exportedAt: new Date().toISOString(),
    counts: {
      prompts: (snap.prompts || []).length,
      images: (snap.images || []).length,
      characters: (snap.characters || []).length,
      tags: (snap.tags || []).length,
      folders: (snap.folders || []).length,
      albums: (snap.albums || []).length,
    },
    secretsOmitted,
  };
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return { path: dir, bytes, manifest };
}

/** POST /api/backup/inspect */
export async function inspectBackup(ctx, body = {}) {
  const dir = requireDir(body.sourceDir, '备份目录');
  if (!(await pathExists(dir))) throw ApiError.validation('备份目录不存在');
  const manifest = await readManifest(dir);
  const stat = await fs.stat(path.join(dir, 'data.json'));
  return { path: dir, manifest, dataBytes: stat.size };
}

/** POST /api/backup/restore */
export async function restoreBackup(ctx, body = {}) {
  const dir = requireDir(body.sourceDir, '备份目录');
  if (!(await pathExists(dir))) throw ApiError.validation('备份目录不存在');
  const manifest = await readManifest(dir);

  let raw;
  try {
    raw = JSON.parse(await fs.readFile(path.join(dir, 'data.json'), 'utf8'));
  } catch {
    throw ApiError.validation('备份里的 data.json 无法解析');
  }

  const current = ctx.db.snapshot();
  const safetyDir = path.join(ctx.config.dataDir, 'backups', `pre-restore-${stamp()}`);
  await ensureDir(safetyDir);
  await fs.writeFile(path.join(safetyDir, 'data.json'), JSON.stringify(current, null, 2), 'utf8');

  const restored = migrate(raw, ctx.config.dataDir);
  restored.settings.dataDir = ctx.config.dataDir;
  const apiKey = current.settings?.translation?.apiKey;
  if (apiKey) restored.settings.translation.apiKey = apiKey;

  if (await pathExists(path.join(dir, 'images'))) {
    await fs.cp(path.join(dir, 'images'), ctx.config.imagesDir, { recursive: true, force: true });
  }
  if (await pathExists(path.join(dir, 'thumbs'))) {
    await fs.cp(path.join(dir, 'thumbs'), ctx.config.thumbsDir, { recursive: true, force: true });
  }

  await ctx.db.replace(restored);

  return {
    ok: true,
    counts: manifest.counts,
    exportedAt: manifest.exportedAt,
    safetyPath: safetyDir,
  };
}
