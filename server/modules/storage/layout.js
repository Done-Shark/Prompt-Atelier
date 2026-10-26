/**
 * 图片磁盘布局：镜像应用内的文件夹结构。
 *
 *   data/images/<target>/<文件夹1>/<文件夹2>/<原文件名>.<ext>
 *   data/images/rp/<文件夹1>/.../<角色名>.<ext>
 *
 * - 文件名优先用导入时的原文件名（角色卡用角色名），冲突时追加 ` (2)`；
 * - 同一张图仍按 sha256 去重，不会出现两份内容；
 * - 布局由 `relayout()` 统一维护：按数据库里的 folderId 重算目标路径并搬文件，
 *   幂等，可在启动时自愈（数据库已指向新路径但文件还没搬完也能修）。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, pathExists, resolveInside } from '../../lib/fsx.js';

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_SEGMENT = 80;

export function sanitizeSegment(input, fallback = '未命名') {
  let name = String(input ?? '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  if (!name) name = fallback;
  if (RESERVED.test(name)) name = `_${name}`;
  return name.slice(0, MAX_SEGMENT) || fallback;
}

function stripExt(fileName) {
  const name = String(fileName || '');
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(0, index) : name;
}

/** 文件夹链（从根到当前），用于拼磁盘路径 */
export function folderChain(data, folderId) {
  const chain = [];
  const seen = new Set();
  let cursor = folderId || null;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const folder = (data.folders || []).find((item) => item.id === cursor);
    if (!folder) break;
    chain.unshift(sanitizeSegment(folder.name, '文件夹'));
    cursor = folder.parentId || null;
  }
  return chain;
}

function uniqueRel(used, dir, base, ext) {
  let name = `${base}${ext}`;
  let index = 2;
  while (used.has(`${dir}/${name}`.toLowerCase())) {
    name = `${base} (${index})${ext}`;
    index += 1;
  }
  const rel = `${dir}/${name}`;
  used.add(rel.toLowerCase());
  return rel;
}

function currentRelOf(image) {
  const ext = `.${image.ext || 'png'}`;
  return image.file || `${image.target}/${image.hash}${ext}`;
}

/**
 * 计算每个图片 / 角色卡的目标相对路径（相对 imagesDir）。
 * 纯函数，不碰磁盘。
 */
export function planLayout(data) {
  const used = new Set();
  const images = [];
  for (const image of data.images || []) {
    const chain = folderChain(data, image.folderId);
    const dir = [image.target || 'nai', ...chain].join('/');
    const ext = `.${image.ext || 'png'}`;
    const base = sanitizeSegment(stripExt(image.fileName) || String(image.hash || '').slice(0, 12), 'image');
    const rel = uniqueRel(used, dir, base, ext);
    images.push({ id: image.id, rel, current: currentRelOf(image) });
  }

  const characters = [];
  for (const card of data.characters || []) {
    if (!card.imageFile || !card.imageExt) continue;
    const chain = folderChain(data, card.folderId);
    const dir = ['rp', ...chain].join('/');
    const ext = `.${card.imageExt}`;
    const base = sanitizeSegment(card.name, 'character');
    const rel = uniqueRel(used, dir, base, ext);
    characters.push({ id: card.id, rel, current: card.imageFile });
  }

  return { images, characters };
}

function withSuffix(rel, index) {
  const ext = path.posix.extname(rel);
  return `${rel.slice(0, rel.length - ext.length)} (${index})${ext}`;
}

/** 找到不冲突的目标路径：先按计划，若磁盘已有同名文件则追加序号 */
async function resolveTarget(imagesDir, fromRel, toRel) {
  const fromAbs = resolveInside(imagesDir, fromRel);
  let candidate = toRel;
  let index = 2;
  while (candidate !== fromRel && (await pathExists(resolveInside(imagesDir, candidate)))) {
    candidate = withSuffix(toRel, index);
    index += 1;
  }
  return { fromAbs, toAbs: resolveInside(imagesDir, candidate), rel: candidate };
}

async function moveFile(fromAbs, toAbs) {
  await ensureDir(path.dirname(toAbs));
  try {
    await fs.rename(fromAbs, toAbs);
  } catch {
    await fs.copyFile(fromAbs, toAbs);
    await fs.unlink(fromAbs).catch(() => {});
  }
}

async function pruneEmptyDirs(root, dir = root) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) await pruneEmptyDirs(root, path.join(dir, entry.name));
  }
  if (dir === root) return;
  const rest = await fs.readdir(dir).catch(() => []);
  if (rest.length === 0) await fs.rmdir(dir).catch(() => {});
}

async function doRelayout(ctx) {
  const snap = ctx.db.snapshot();
  const plan = planLayout(snap);
  const imagesDir = ctx.config.imagesDir;
  const updates = { images: [], characters: [] };
  let moved = 0;
  let healed = 0;

  for (const item of plan.images) {
    const fromAbs = resolveInside(imagesDir, item.current);
    const toAbs = resolveInside(imagesDir, item.rel);
    if (item.current === item.rel) continue;

    if (!(await pathExists(fromAbs))) {
      // 文件已经在目标位置（上次搬到一半），只补数据库
      if (await pathExists(toAbs)) {
        updates.images.push({ id: item.id, rel: item.rel });
        healed += 1;
      }
      continue;
    }
    const target = await resolveTarget(imagesDir, item.current, item.rel);
    await moveFile(target.fromAbs, target.toAbs);
    updates.images.push({ id: item.id, rel: target.rel });
    moved += 1;
  }

  for (const item of plan.characters) {
    const fromAbs = resolveInside(imagesDir, item.current);
    const toAbs = resolveInside(imagesDir, item.rel);
    if (item.current === item.rel) continue;

    if (!(await pathExists(fromAbs))) {
      if (await pathExists(toAbs)) {
        updates.characters.push({ id: item.id, rel: item.rel });
        healed += 1;
      }
      continue;
    }
    const target = await resolveTarget(imagesDir, item.current, item.rel);
    await moveFile(target.fromAbs, target.toAbs);
    updates.characters.push({ id: item.id, rel: target.rel });
    moved += 1;
  }

  if (updates.images.length || updates.characters.length) {
    await ctx.db.mutate((data) => {
      for (const item of updates.images) {
        const image = data.images.find((entry) => entry.id === item.id);
        if (image) image.file = item.rel;
      }
      for (const item of updates.characters) {
        const card = (data.characters || []).find((entry) => entry.id === item.id);
        if (card) card.imageFile = item.rel;
      }
    });
  }

  if (moved) await pruneEmptyDirs(imagesDir);
  return { moved, healed };
}

/** 串行执行，避免并发请求同时搬文件 */
let queue = Promise.resolve();

export function relayout(ctx) {
  const run = queue.then(
    () => doRelayout(ctx),
    () => doRelayout(ctx),
  );
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * 启动时调用：把旧的扁平布局迁到镜像布局，并打上标记。
 * 已迁移过的库也会跑一次 relayout，用于自愈（搬了一半 / 手动改过目录）。
 */
export async function ensureMirroredStorage(ctx) {
  const result = await relayout(ctx);
  const snap = ctx.db.snapshot();
  if (snap.settings?.storageLayout !== 'mirrored') {
    await ctx.db.mutate((data) => {
      data.settings.storageLayout = 'mirrored';
    });
  }
  return result;
}
