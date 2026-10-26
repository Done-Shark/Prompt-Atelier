/**
 * 图片库服务：扫描、导入（去重 + 复制入库）、索引 CRUD、to-prompt。
 * 二进制落在 <dataDir>/images/<target>/<sha256>.<ext>，索引只存相对路径。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ApiError } from '../../lib/errors.js';
import { newId, nowIso } from '../../lib/ids.js';
import {
  atomicWrite,
  assertExistingDir,
  ensureDir,
  hashBuffer,
  resolveInside,
  walkFiles,
} from '../../lib/fsx.js';
import {
  cleanBool,
  cleanEnum,
  cleanNullableId,
  cleanPaging,
  cleanString,
  cleanStringArray,
  isPlainObject,
} from '../../lib/validate.js';
import { TARGETS } from '../../formats/index.js';
import { bareTag, parseTags } from '../../../shared/prompt/doc.js';
import { probe } from '../../media/probe.js';
import { readTextChunks } from '../../media/png.js';
import { parseNaiComment } from '../../media/naiMetadata.js';
import { parseComfyText } from '../../media/comfyMetadata.js';
import { parseParametersText } from '../../media/parametersMetadata.js';
import { ensureTagEntries } from '../tags/catalog.js';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const MAX_SCAN_FILES = 2000;

/** 自动打标签时跳过的通用质量词，避免每条图片都带同样的标签 */
const TAG_NOISE = new Set([
  'masterpiece',
  'best quality',
  'amazing quality',
  'high quality',
  'highres',
  'absurdres',
  'very aesthetic',
  'aesthetic',
  'official art',
  'detailed',
  'ultra detailed',
]);

/** 从正向 Prompt 里挑前几个具体 tag，作为图片的初始标签 */
function autoTags(positive) {
  const out = [];
  for (const tag of parseTags(positive)) {
    const bare = bareTag(tag).trim();
    if (!bare || bare.startsWith('<') || bare.length > 24) continue;
    if (TAG_NOISE.has(bare.toLowerCase())) continue;
    if (!out.includes(bare)) out.push(bare);
    if (out.length >= 3) break;
  }
  return out;
}

function extOf(name) {
  return path.extname(name || '').slice(1).toLowerCase();
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** 目标 + 文件夹内的下一个排序值 */
function nextImageOrder(data, target, folderId) {
  let max = -1;
  for (const image of data.images) {
    if (image.target !== target) continue;
    if ((image.folderId ?? null) !== (folderId ?? null)) continue;
    max = Math.max(max, Number(image.order) || 0);
  }
  return max + 1;
}

/** 严格解码 base64：Buffer.from 对非法字符过于宽容，会把垃圾数据当成图片 */
function decodeBase64(input) {
  if (typeof input !== 'string') return null;
  const text = input.replace(/\s+/g, '');
  if (!text || text.length % 4 !== 0 || !BASE64_RE.test(text)) return null;
  const buffer = Buffer.from(text, 'base64');
  return buffer.length ? buffer : null;
}

function emptyMetadata(width, height) {
  return {
    format: 'unknown',
    positive: '',
    negative: '',
    model: null,
    sampler: null,
    scheduler: null,
    seed: null,
    steps: null,
    cfg: null,
    width: width ?? null,
    height: height ?? null,
    loras: [],
  };
}

/**
 * 解析单张图片的元数据。
 * 顺序：NAI Comment → ComfyUI prompt → ComfyUI workflow（仅有 UI 格式时也归入 comfyui）→ unknown。
 * 解析失败不阻断导入。
 */
export function analyzeBuffer(buffer) {
  const info = probe(buffer);
  let metadata = null;

  if (info.format === 'png') {
    const texts = readTextChunks(buffer);
    if (texts.Comment) metadata = parseNaiComment(texts.Comment);
    if (!metadata && texts.prompt) metadata = parseComfyText(texts.prompt);
    if (!metadata && texts.parameters) {
      // SwarmUI / A1111 风格：正向 + Negative prompt + 参数行
      const parsed = parseParametersText(texts.parameters);
      if (parsed) {
        let workflow = null;
        if (texts.workflow) {
          try {
            workflow = JSON.parse(texts.workflow);
          } catch {
            workflow = texts.workflow;
          }
        }
        metadata = {
          ...emptyMetadata(info.width, info.height),
          ...parsed,
          format: texts.workflow ? 'comfyui' : 'unknown',
          raw: { parameters: texts.parameters, ...(workflow ? { workflow } : {}) },
        };
      }
    }
    if (!metadata && texts.workflow) {
      // 只有 workflow（UI 格式）时无法解析参数，但分区仍应归到 ComfyUI
      let raw = texts.workflow;
      try {
        raw = JSON.parse(texts.workflow);
      } catch {
        // 保留原始字符串
      }
      metadata = { ...emptyMetadata(info.width, info.height), format: 'comfyui', raw };
    }
  }

  if (!metadata) metadata = emptyMetadata(info.width, info.height);
  else {
    metadata.width = metadata.width ?? info.width;
    metadata.height = metadata.height ?? info.height;
  }

  // 原始元数据单独存（imageRaw），列表接口不再背着这份大 JSON
  const raw = metadata.raw ?? null;
  delete metadata.raw;
  return { metadata, raw, probe: info };
}

/** 对外响应去掉内部文件路径 */
export function publicImage(image) {
  const { file, ...rest } = image;
  return rest;
}

export function get(db, id) {
  const image = db.snapshot().images.find((item) => item.id === id);
  if (!image) throw ApiError.notFound('图片不存在');
  return image;
}

export function filePathOf(config, image) {
  const rel = image.file || `${image.target}/${image.hash}.${image.ext}`;
  return resolveInside(config.imagesDir, rel);
}

/** 缩略图缓存路径（<thumbsDir>/<hash>.webp），与图片内容一一对应 */
export function thumbPathOf(config, image) {
  const base = config.thumbsDir || path.join(config.dataDir || '.', 'thumbs');
  return path.join(base, `${image.hash}.webp`);
}

/** 保存前端生成的缩略图；只接受 WebP，限制 1MB */
export async function saveThumb(ctx, id, base64) {
  const image = get(ctx.db, id);
  if (typeof base64 !== 'string' || !base64) throw ApiError.validation('缩略图数据无效');
  const buffer = decodeBase64(base64);
  if (!buffer) throw ApiError.validation('缩略图数据无效');
  if (buffer.length > 1024 * 1024) throw ApiError.validation('缩略图过大');
  const isWebp = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!isWebp) throw ApiError.validation('缩略图必须是 WebP');
  await ensureDir(path.dirname(thumbPathOf(ctx.config, image)));
  await atomicWrite(thumbPathOf(ctx.config, image), buffer);
  return { ok: true, bytes: buffer.length };
}

/** 删除缩略图缓存（图片删除时调用） */
export async function dropThumb(ctx, image) {
  await fs.rm(thumbPathOf(ctx.config, image), { force: true }).catch(() => {});
}

export function list(db, query = {}) {
  const snap = db.snapshot();
  let items = snap.images;

  if (query.target === 'nai' || query.target === 'comfyui') {
    items = items.filter((image) => image.target === query.target);
  }
  if (query.favorite === '1' || query.favorite === 'true') {
    items = items.filter((image) => image.favorite === true);
  }
  if (query.albumId === 'favorites') {
    items = items.filter((image) => image.favorite === true);
  } else if (typeof query.albumId === 'string' && query.albumId) {
    items = items.filter((image) => (image.albumIds || []).includes(query.albumId));
  }
  if (query.folderId === 'root') {
    items = items.filter((image) => image.folderId === null);
  } else if (typeof query.folderId === 'string' && query.folderId) {
    items = items.filter((image) => image.folderId === query.folderId);
  }
  const keyword = typeof query.q === 'string' ? query.q.trim().toLowerCase() : '';
  if (keyword) {
    items = items.filter((image) => {
      if (image.fileName.toLowerCase().includes(keyword)) return true;
      if ((image.metadata?.positive || '').toLowerCase().includes(keyword)) return true;
      return (image.metadata?.model || '').toLowerCase().includes(keyword);
    });
  }

  const sort = ['name', 'manual'].includes(query.sort) ? query.sort : 'imported';
  const sorted = items.slice().sort((a, b) => {
    if (sort === 'name') return a.fileName.localeCompare(b.fileName, 'zh-Hans');
    if (sort === 'manual') {
      const diff = (a.order || 0) - (b.order || 0);
      return diff !== 0 ? diff : String(b.importedAt).localeCompare(String(a.importedAt));
    }
    return String(b.importedAt).localeCompare(String(a.importedAt));
  });

  const { limit, offset } = cleanPaging(query, { defaultLimit: 120, maxLimit: 500 });
  return { items: sorted.slice(offset, offset + limit).map(publicImage), total: sorted.length };
}

/** 扫描目录，仅预览不写库 */
export async function scan(ctx, body = {}) {
  if (!isPlainObject(body)) throw ApiError.validation('请求体必须是对象');
  const dir = await assertExistingDir(body.path);
  const recursive = cleanBool(body.recursive, true);
  const fallback = cleanEnum(
    body.fallbackTarget,
    TARGETS,
    ctx.db.snapshot().settings.defaultTarget || 'nai',
  );
  const forced = cleanEnum(body.target, TARGETS, null);
  const files = await walkFiles(dir, { recursive, maxFiles: MAX_SCAN_FILES });
  const hashes = new Set(ctx.db.snapshot().images.map((image) => image.hash));

  const entries = [];
  for (const file of files) {
    const ext = extOf(file);
    if (!IMAGE_EXTS.has(ext)) continue;
    let buffer;
    try {
      buffer = await fs.readFile(file);
    } catch {
      continue;
    }
    const { metadata } = analyzeBuffer(buffer);
    const target = forced || (metadata.format !== 'unknown' ? metadata.format : fallback);
    entries.push({
      path: file,
      fileName: path.basename(file),
      target,
      alreadyImported: hashes.has(hashBuffer(buffer)),
    });
  }
  return { entries, total: entries.length };
}

/**
 * 导入：path 扫描导入，或 files[{name,data(base64)}] 上传导入。
 * 去重键是文件内容 sha256；已存在则跳过。
 */
export async function importImages(ctx, body = {}) {
  if (!isPlainObject(body)) throw ApiError.validation('请求体必须是对象');
  const targetOption = cleanEnum(body.target, ['auto', ...TARGETS], 'auto');
  const fallback = cleanEnum(body.fallbackTarget, TARGETS, ctx.db.snapshot().settings.defaultTarget || 'nai');
  const recursive = cleanBool(body.recursive, true);

  /** @type {{name: string, sourcePath: string|null, buffer: Buffer}[]} */
  const sources = [];
  const skipped = [];

  if (Array.isArray(body.files)) {
    for (const file of body.files) {
      const name = isPlainObject(file) && typeof file.name === 'string' ? file.name : '';
      if (!isPlainObject(file) || typeof file.data !== 'string') {
        skipped.push({ path: name || '(未命名)', reason: '文件数据无效' });
        continue;
      }
      const buffer = decodeBase64(file.data);
      if (!buffer) {
        skipped.push({ path: name || '(未命名)', reason: '文件数据无效' });
        continue;
      }
      sources.push({ name, sourcePath: null, buffer });
    }
  } else if (typeof body.path === 'string' && body.path.trim()) {
    const dir = await assertExistingDir(body.path);
    const files = await walkFiles(dir, { recursive, maxFiles: MAX_SCAN_FILES });
    for (const file of files) {
      const ext = extOf(file);
      if (!IMAGE_EXTS.has(ext)) {
        skipped.push({ path: file, reason: '不支持的文件类型' });
        continue;
      }
      try {
        sources.push({ name: path.basename(file), sourcePath: file, buffer: await fs.readFile(file) });
      } catch {
        skipped.push({ path: file, reason: '文件读取失败' });
      }
    }
  } else {
    throw ApiError.validation('需要提供 path 或 files');
  }

  // 先做耗时的解析，再进入串行写事务
  const prepared = [];
  for (const source of sources) {
    const label = source.sourcePath || source.name || '(未命名)';
    if (!source.buffer.length) {
      skipped.push({ path: label, reason: '文件为空' });
      continue;
    }
    const info = probe(source.buffer);
    const ext = info.ext || '';
    if (!info.format || !IMAGE_EXTS.has(ext)) {
      skipped.push({ path: label, reason: '不支持的文件类型' });
      continue;
    }
    const { metadata, raw } = analyzeBuffer(source.buffer);
    const target =
      targetOption === 'auto' ? (metadata.format !== 'unknown' ? metadata.format : fallback) : targetOption;
    prepared.push({
      buffer: source.buffer,
      name: source.name || `${hashBuffer(source.buffer)}.${ext}`,
      sourcePath: source.sourcePath,
      ext,
      hash: hashBuffer(source.buffer),
      metadata,
      raw,
      target,
      // 展示用尺寸以文件本身为准，metadata 里的宽高是生成参数
      width: info.width ?? metadata.width ?? null,
      height: info.height ?? metadata.height ?? null,
    });
  }

  const scanned = body.files ? (Array.isArray(body.files) ? body.files.length : 0) : sources.length + skipped.length;

  return ctx.db.mutate(async (data) => {
    const existing = new Set(data.images.map((image) => image.hash));
    const imported = [];
    const requestedFolder =
      typeof body.folderId === 'string' && body.folderId
        ? data.folders.find((folder) => folder.id === body.folderId && folder.scope === 'image') || null
        : null;

    for (const item of prepared) {
      if (existing.has(item.hash)) {
        skipped.push({ path: item.sourcePath || item.name, reason: '已存在' });
        continue;
      }
      const rel = `${item.target}/${item.hash}.${item.ext}`;
      const abs = resolveInside(ctx.config.imagesDir, rel);
      await ensureDir(path.dirname(abs));
      await atomicWrite(abs, item.buffer);

      const tags = data.settings?.autoTagOnImport ? autoTags(item.metadata.positive) : [];
      ensureTagEntries(data, tags, {
        autoTranslate: data.settings?.translation?.autoTranslateOnImport === true,
      });
      const record = {
        id: newId('i'),
        target: item.target,
        fileName: item.name,
        ext: item.ext,
        width: item.width,
        height: item.height,
        bytes: item.buffer.length,
        hash: item.hash,
        folderId: requestedFolder && requestedFolder.target === item.target ? requestedFolder.id : null,
        albumIds: [],
        tags,
        favorite: false,
        metadata: item.metadata,
        promptId: null,
        importedAt: nowIso(),
        sourcePath: item.sourcePath,
        file: rel,
        order: nextImageOrder(data, item.target, requestedFolder ? requestedFolder.id : null),
      };
      data.images.unshift(record);
      if (item.raw !== null && item.raw !== undefined) {
        data.imageRaw = Array.isArray(data.imageRaw) ? data.imageRaw : [];
        data.imageRaw.push({ id: record.id, raw: item.raw });
      }
      existing.add(item.hash);
      imported.push(publicImage(record));
    }

    return { imported, skipped, scanned };
  });
}

/** 用当前解析器重新读取图片元数据（解析规则修复后，已入库的图片可以就地刷新） */
export async function reparse(ctx, id) {
  return ctx.db.mutate(async (data) => {
    const image = data.images.find((item) => item.id === id);
    if (!image) throw ApiError.notFound('图片不存在');
    const buffer = await fs.readFile(filePathOf(ctx.config, image));
    const { metadata, raw } = analyzeBuffer(buffer);
    image.metadata = metadata;
    data.imageRaw = (data.imageRaw || []).filter((entry) => entry.id !== id);
    if (raw !== null && raw !== undefined) data.imageRaw.push({ id, raw });
    return publicImage(image);
  });
}

export async function update(ctx, id, body = {}) {
  if (!isPlainObject(body)) throw ApiError.validation('请求体必须是对象');

  return ctx.db.mutate(async (data) => {
    const image = data.images.find((item) => item.id === id);
    if (!image) throw ApiError.notFound('图片不存在');

    if ('favorite' in body) image.favorite = cleanBool(body.favorite, image.favorite);
    if ('tags' in body) image.tags = cleanStringArray(body.tags);
    if ('folderId' in body) {
      const folderId = cleanNullableId(body.folderId);
      const folder = folderId
        ? data.folders.find(
            (item) => item.id === folderId && item.scope === 'image' && item.target === image.target,
          )
        : null;
      const nextFolderId = folder ? folder.id : null;
      if (nextFolderId !== image.folderId) {
        image.order = nextImageOrder(data, image.target, nextFolderId);
      }
      image.folderId = nextFolderId;
    }
    if ('target' in body) {
      const target = cleanEnum(body.target, TARGETS, null);
      if (!target) throw ApiError.validation('target 只能是 nai 或 comfyui');
      if (target !== image.target) {
        const oldAbs = filePathOf(ctx.config, image);
        const rel = `${target}/${image.hash}.${image.ext}`;
        const newAbs = resolveInside(ctx.config.imagesDir, rel);
        await ensureDir(path.dirname(newAbs));
        try {
          await fs.rename(oldAbs, newAbs);
        } catch {
          // 跨卷等场景退化为复制后删除
          await fs.copyFile(oldAbs, newAbs);
          await fs.rm(oldAbs, { force: true });
        }
        image.target = target;
        image.file = rel;
      }
    }

    return publicImage(image);
  });
}

export async function remove(ctx, id) {
  return ctx.db.mutate(async (data) => {
    const image = data.images.find((item) => item.id === id);
    if (!image) return { ok: true };
    const abs = filePathOf(ctx.config, image);
    await fs.rm(abs, { force: true }).catch(() => {});
    await dropThumb(ctx, image);
    data.images = data.images.filter((item) => item.id !== id);
    data.imageRaw = (data.imageRaw || []).filter((entry) => entry.id !== id);
    // Prompt 不随图片删除，只清掉来源引用
    for (const prompt of data.prompts) {
      if (prompt.imageId === id) prompt.imageId = null;
    }
    // Prompt 的示例图引用也一并清掉
    for (const prompt of data.prompts) {
      if (prompt.exampleImageId === id) prompt.exampleImageId = null;
    }
    return { ok: true };
  });
}

/** 由图片元数据生成 PromptInput；实际落库由 prompts 服务完成（避免模块互相 import） */
export function toPromptInput(image, options = {}) {
  const opts = isPlainObject(options) ? options : {};
  const metadata = image.metadata || emptyMetadata(null, null);
  const params =
    image.target === 'nai'
      ? {
          model: metadata.model ?? undefined,
          sampler: metadata.sampler ?? undefined,
          steps: metadata.steps ?? undefined,
          scale: metadata.cfg ?? undefined,
          seed: metadata.seed ?? undefined,
          width: metadata.width ?? undefined,
          height: metadata.height ?? undefined,
        }
      : {
          checkpoint: metadata.model ?? '',
          loras: metadata.loras ?? [],
          sampler: metadata.sampler ?? undefined,
          scheduler: metadata.scheduler ?? undefined,
          steps: metadata.steps ?? undefined,
          cfg: metadata.cfg ?? undefined,
          seed: metadata.seed ?? undefined,
          width: metadata.width ?? undefined,
          height: metadata.height ?? undefined,
        };

  const baseName = String(image.fileName || '').replace(/\.[^.]+$/, '');

  return {
    title: cleanString(baseName, { field: 'title', max: 200 }) || '图片 Prompt',
    target: image.target,
    positive: metadata.positive || '',
    negative: metadata.negative || '',
    tags: cleanStringArray(opts.tags),
    folderId: opts.folderId ?? null,
    params,
    origin: 'image',
    imageId: image.id,
    // 从图片创建的 Prompt 默认拿这张图当示例图
    exampleImageId: image.id,
  };
}

/** 在数据草稿上把图片关联到 Prompt（供跨模块编排复用） */
export function linkPromptInData(data, imageId, promptId) {
  const image = data.images.find((item) => item.id === imageId);
  if (!image) throw ApiError.notFound('图片不存在');
  image.promptId = promptId;
  return image;
}

export async function linkPrompt(db, imageId, promptId) {
  return db.mutate((data) => publicImage(linkPromptInData(data, imageId, promptId)));
}

/**
 * 批量操作：移动 / 收藏 / 删除。
 * 移动时目标文件夹必须与图片同目标，否则跳过该张。
 */
export async function batch(ctx, body = {}) {
  if (!isPlainObject(body)) throw ApiError.validation('请求体必须是对象');
  const ids = cleanStringArray(body.ids, { maxItems: 1000, maxLen: 80 });
  if (!ids.length) throw ApiError.validation('ids 不能为空');
  const action = body.action;
  if (!['move', 'favorite', 'delete'].includes(action)) {
    throw ApiError.validation('action 只能是 move / favorite / delete');
  }

  return ctx.db.mutate(async (data) => {
    const wanted = new Set(ids);
    const targets = data.images.filter((image) => wanted.has(image.id));
    if (!targets.length) return { ok: true, updated: 0, skipped: ids.length, deleted: 0 };

    if (action === 'favorite') {
      const favorite = cleanBool(body.favorite, true);
      for (const image of targets) image.favorite = favorite;
      return { ok: true, updated: targets.length, skipped: ids.length - targets.length, deleted: 0 };
    }

    if (action === 'move') {
      const folderId = cleanNullableId(body.folderId);
      const folder = folderId
        ? data.folders.find((item) => item.id === folderId && item.scope === 'image')
        : null;
      if (folderId && !folder) throw ApiError.notFound('目标文件夹不存在');
      let updated = 0;
      let skipped = ids.length - targets.length;
      for (const image of targets) {
        if (folder && folder.target !== image.target) {
          skipped += 1;
          continue;
        }
        const nextFolderId = folder ? folder.id : null;
        if (nextFolderId !== (image.folderId ?? null)) {
          image.order = nextImageOrder(data, image.target, nextFolderId);
        }
        image.folderId = nextFolderId;
        updated += 1;
      }
      return { ok: true, updated, skipped, deleted: 0 };
    }

    let deleted = 0;
    for (const image of targets) {
      const abs = filePathOf(ctx.config, image);
      await fs.rm(abs, { force: true }).catch(() => {});
      await dropThumb(ctx, image);
      for (const prompt of data.prompts) {
        if (prompt.imageId === image.id) prompt.imageId = null;
      }
      for (const prompt of data.prompts) {
        if (prompt.exampleImageId === image.id) prompt.exampleImageId = null;
      }
      deleted += 1;
    }
    data.images = data.images.filter((image) => !wanted.has(image.id));
    return { ok: true, updated: 0, skipped: ids.length - deleted, deleted };
  });
}

/**
 * 手动排序：把 ids 插到 beforeId 之前（beforeId 为空则放到末尾）。
 * 只影响同目标、同文件夹内的图片，不影响其他分区。
 */
export async function reorder(ctx, body = {}) {
  if (!isPlainObject(body)) throw ApiError.validation('请求体必须是对象');
  const target = cleanEnum(body.target, TARGETS, null);
  if (!target) throw ApiError.validation('target 只能是 nai 或 comfyui');
  const folderId = cleanNullableId(body.folderId) ?? null;
  const ids = cleanStringArray(body.ids, { maxItems: 1000, maxLen: 80 });
  if (!ids.length) throw ApiError.validation('ids 不能为空');
  const beforeId = typeof body.beforeId === 'string' && body.beforeId ? body.beforeId : null;

  return ctx.db.mutate((data) => {
    const scope = data.images
      .filter((image) => image.target === target && (image.folderId ?? null) === folderId)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    const moving = new Set(ids);
    const movingItems = scope.filter((image) => moving.has(image.id));
    if (!movingItems.length) return { ok: true, updated: 0 };
    const rest = scope.filter((image) => !moving.has(image.id));
    let insertAt = rest.length;
    if (beforeId) {
      const index = rest.findIndex((image) => image.id === beforeId);
      if (index >= 0) insertAt = index;
    }
    const ordered = [...rest.slice(0, insertAt), ...movingItems, ...rest.slice(insertAt)];
    ordered.forEach((image, index) => {
      image.order = index;
    });
    return { ok: true, updated: ordered.length };
  });
}
