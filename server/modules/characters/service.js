/**
 * RP 角色卡：图片 + 标签 / 设定 / 简介 / Prompt。
 *
 * 图片按「原图」保存：不解码、不压缩，直接落到 <data>/images/rp/<sha256>.<ext>，
 * 与 NAI / ComfyUI 一样按模块分目录，扩展名保持源文件的真实格式。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ApiError } from '../../lib/errors.js';
import { newId, nowIso } from '../../lib/ids.js';
import { atomicWrite, hashBuffer, resolveInside } from '../../lib/fsx.js';
import { cleanPaging, cleanString, cleanStringArray, isPlainObject } from '../../lib/validate.js';
import { probe } from '../../media/probe.js';
import { parseRpCard } from '../../media/rpCard.js';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const LIMITS = { name: 120, settings: 20000, description: 4000, prompt: 20000 };

function decodeBase64(input) {
  if (typeof input !== 'string') return null;
  const text = input.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!text || text.length % 4 !== 0 || !BASE64_RE.test(text)) return null;
  const buffer = Buffer.from(text, 'base64');
  return buffer.length ? buffer : null;
}

/** folderId 必须是 scope=rp 的文件夹，否则落回未归档 */
function resolveFolderId(data, value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw ApiError.validation('folderId 必须是字符串或 null');
  const folder = data.folders.find((item) => item.id === value && (item.scope === 'rp' || !item.scope));
  return folder ? folder.id : null;
}

function requireCard(db, id) {
  const card = db.snapshot().characters.find((item) => item.id === id);
  if (!card) throw ApiError.notFound('角色卡不存在');
  return card;
}

export function thumbPathOf(config, card) {
  if (!card?.imageHash) return null;
  const base = config.thumbsDir || path.join(config.dataDir || '.', 'thumbs');
  return path.join(base, `${card.imageHash}.webp`);
}

/** 保存前端生成的 WebP 缩略图（与图片库共用 <data>/thumbs 缓存） */
export async function saveThumb(ctx, id, base64) {
  const card = requireCard(ctx.db, id);
  if (!card.imageHash) throw ApiError.validation('角色卡没有图片');
  const buffer = decodeBase64(base64);
  if (!buffer) throw ApiError.validation('缩略图数据无效');
  if (buffer.length > 1024 * 1024) throw ApiError.validation('缩略图过大');
  const isWebp =
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!isWebp) throw ApiError.validation('缩略图必须是 WebP');
  await atomicWrite(thumbPathOf(ctx.config, card), buffer);
  return { ok: true, bytes: buffer.length };
}

export function imagePathOf(config, card) {
  if (!card?.imageFile) return null;
  return resolveInside(config.imagesDir, card.imageFile);
}

/** 原图落盘：只按 sha256 命名，扩展名跟随真实格式 */
async function storeImage(ctx, base64) {
  const buffer = decodeBase64(base64);
  if (!buffer) throw ApiError.validation('图片数据无效');
  if (buffer.length > MAX_IMAGE_BYTES) throw ApiError.validation('图片超过 20MB');
  const info = probe(buffer);
  if (!info.format) throw ApiError.validation('只支持 PNG / JPG / WebP');

  const hash = hashBuffer(buffer);
  const rel = `rp/${hash}.${info.ext}`;
  await atomicWrite(resolveInside(ctx.config.imagesDir, rel), buffer);
  return {
    imageHash: hash,
    imageFile: rel,
    imageExt: info.ext,
    imageWidth: info.width,
    imageHeight: info.height,
    imageBytes: buffer.length,
  };
}

async function dropImageIfUnused(ctx, data, card) {
  if (!card?.imageHash || !card.imageFile) return;
  const shared = data.characters.some((item) => item.id !== card.id && item.imageHash === card.imageHash);
  if (shared) return;
  await fs.rm(resolveInside(ctx.config.imagesDir, card.imageFile), { force: true }).catch(() => {});
}

function normalizeFields(input, current = {}) {
  const next = {};
  if ('name' in input) {
    next.name = cleanString(input.name, { field: '名称', max: LIMITS.name }) || '未命名角色';
  } else if (!current.id) {
    next.name = '未命名角色';
  }
  for (const [field, max] of [
    ['settings', LIMITS.settings],
    ['description', LIMITS.description],
    ['prompt', LIMITS.prompt],
  ]) {
    if (field in input) next[field] = cleanString(input[field], { field, max }) ?? '';
  }
  if ('tags' in input) next.tags = cleanStringArray(input.tags).slice(0, 50);
  if ('originalName' in input) {
    const name = typeof input.originalName === 'string' ? input.originalName.trim() : '';
    next.originalName = name ? name.slice(0, 200) : null;
  }
  return next;
}

export function list(db, query = {}) {
  const keyword = typeof query.q === 'string' ? query.q.trim().toLowerCase() : '';
  const folderFilter = query.folderId;
  let items = db.snapshot().characters.slice();
  if (folderFilter === 'root') {
    items = items.filter((card) => card.folderId === null);
  } else if (typeof folderFilter === 'string' && folderFilter && folderFilter !== 'all') {
    // 选中父文件夹时连同子文件夹一起显示，和树上的数量一致
    const ids = new Set([folderFilter]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of db.snapshot().folders) {
        if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
          ids.add(folder.id);
          changed = true;
        }
      }
    }
    items = items.filter((card) => card.folderId && ids.has(card.folderId));
  }
  if (keyword) {
    items = items.filter((card) =>
      [card.name, card.description, card.settings, card.prompt, ...(card.tags || [])]
        .join('\n')
        .toLowerCase()
        .includes(keyword),
    );
  }
  const sort = query.sort === 'name' ? 'name' : 'updated';
  items.sort((a, b) => {
    if (sort === 'name') return String(a.name).localeCompare(String(b.name), 'zh-Hans');
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
  const { limit, offset } = cleanPaging(query, { defaultLimit: 200, maxLimit: 500 });
  return { items: items.slice(offset, offset + limit), total: items.length };
}

export function get(db, id) {
  return requireCard(db, id);
}

export async function create(ctx, body = {}) {
  if (!isPlainObject(body)) throw ApiError.validation('请求体必须是对象');
  const image = body.image ? await storeImage(ctx, body.image) : null;
  const fields = normalizeFields(body);
  const now = nowIso();
  return ctx.db.mutate((data) => {
    const card = {
      id: newId('c'),
      name: fields.name ?? '未命名角色',
      tags: fields.tags ?? [],
      settings: fields.settings ?? '',
      description: fields.description ?? '',
      prompt: fields.prompt ?? '',
      imageHash: image?.imageHash ?? null,
      imageFile: image?.imageFile ?? null,
      imageExt: image?.imageExt ?? null,
      imageWidth: image?.imageWidth ?? null,
      imageHeight: image?.imageHeight ?? null,
      imageBytes: image?.imageBytes ?? null,
      folderId: resolveFolderId(data, body.folderId) ?? null,
      originalName: typeof body.originalName === 'string' ? body.originalName.slice(0, 200) : null,
      source: ['manual', 'png', 'json'].includes(body.source) ? body.source : 'manual',
      raw: isPlainObject(body.raw) ? body.raw : null,
      createdAt: now,
      updatedAt: now,
    };
    data.characters.push(card);
    return card;
  });
}

export async function update(ctx, id, body = {}) {
  if (!isPlainObject(body)) throw ApiError.validation('请求体必须是对象');
  const current = requireCard(ctx.db, id);
  const image = body.image ? await storeImage(ctx, body.image) : null;
  const fields = normalizeFields(body, current);
  const now = nowIso();

  return ctx.db.mutate((data) => {
    const card = data.characters.find((item) => item.id === id);
    if (!card) throw ApiError.notFound('角色卡不存在');
    Object.assign(card, fields);
    if ('folderId' in body) card.folderId = resolveFolderId(data, body.folderId) ?? null;
    if (image) {
      const previous = { ...card };
      Object.assign(card, image);
      void dropImageIfUnused(ctx, data, previous);
    }
    card.updatedAt = now;
    return card;
  });
}

export async function remove(ctx, id) {
  return ctx.db.mutate(async (data) => {
    const card = data.characters.find((item) => item.id === id);
    if (!card) return { ok: true };
    await dropImageIfUnused(ctx, data, card);
    data.characters = data.characters.filter((item) => item.id !== id);
    return { ok: true };
  });
}

/** 批量删除：一次事务，图片只在没有其它卡引用时删除 */
export async function batchDelete(ctx, body = {}) {
  if (!isPlainObject(body)) throw ApiError.validation('请求体必须是对象');
  const ids = cleanStringArray(body.ids, { maxItems: 500, maxLen: 100 });
  if (!ids.length) throw ApiError.validation('ids 不能为空');
  const wanted = new Set(ids);

  return ctx.db.mutate(async (data) => {
    const removed = data.characters.filter((card) => wanted.has(card.id));
    if (!removed.length) return { ok: true, deleted: 0 };
    const remaining = data.characters.filter((card) => !wanted.has(card.id));
    const survivingHashes = new Set(remaining.map((card) => card.imageHash).filter(Boolean));
    for (const card of removed) {
      if (!card.imageFile || !card.imageHash || survivingHashes.has(card.imageHash)) continue;
      await fs.rm(resolveInside(ctx.config.imagesDir, card.imageFile), { force: true }).catch(() => {});
    }
    data.characters = remaining;
    return { ok: true, deleted: removed.length };
  });
}

/** 批量移动：folderId 为 null 表示移回未归档 */
export async function batchMove(ctx, body = {}) {
  if (!isPlainObject(body)) throw ApiError.validation('请求体必须是对象');
  const ids = cleanStringArray(body.ids, { maxItems: 500, maxLen: 100 });
  if (!ids.length) throw ApiError.validation('ids 不能为空');
  const wanted = new Set(ids);

  return ctx.db.mutate((data) => {
    const folderId = resolveFolderId(data, body.folderId) ?? null;
    const now = nowIso();
    let moved = 0;
    for (const card of data.characters) {
      if (!wanted.has(card.id)) continue;
      card.folderId = folderId;
      card.updatedAt = now;
      moved += 1;
    }
    return { ok: true, moved, folderId };
  });
}

/**
 * 批量导入角色卡（PNG / JSON）。
 * 同一张图（sha256 相同）只导入一次。
 */
export async function importCards(ctx, body = {}) {
  if (!isPlainObject(body) || !Array.isArray(body.files)) {
    throw ApiError.validation('files 必须是数组');
  }
  const files = body.files.slice(0, 100);
  const allowDuplicateNames = body.allowDuplicateNames === true;
  const existingNames = new Set(
    (ctx.db.snapshot().characters || []).map((card) => String(card.name).trim().toLowerCase()),
  );
  const prepared = [];
  const skipped = [];

  for (const file of files) {
    const name = typeof file?.name === 'string' ? file.name : '未命名文件';
    const buffer = decodeBase64(file?.data);
    if (!buffer) {
      skipped.push({ name, reason: '文件数据无效' });
      continue;
    }
    const parsed = parseRpCard(buffer);
    if (!parsed) {
      skipped.push({ name, reason: '不是 SillyTavern 角色卡（缺少 chara / JSON 字段）' });
      continue;
    }
    const nameKey = String(parsed.name).trim().toLowerCase();
    if (!allowDuplicateNames && existingNames.has(nameKey)) {
      skipped.push({ name, reason: `同名角色卡「${parsed.name}」已存在` });
      continue;
    }
    existingNames.add(nameKey);
    const isPng = parsed.source === 'png';
    prepared.push({
      name,
      parsed,
      image: isPng ? await storeImage(ctx, file.data) : null,
    });
  }

  if (!prepared.length) return { imported: [], skipped };

  return ctx.db.mutate((data) => {
    const existingHashes = new Set(data.characters.map((card) => card.imageHash).filter(Boolean));
    const now = nowIso();
    const imported = [];
    for (const item of prepared) {
      if (item.image?.imageHash && existingHashes.has(item.image.imageHash)) {
        skipped.push({ name: item.name, reason: '图片已存在，跳过重复导入' });
        continue;
      }
      const card = {
        id: newId('c'),
        name: item.parsed.name,
        tags: item.parsed.tags,
        settings: item.parsed.settings,
        description: item.parsed.description,
        prompt: item.parsed.prompt,
        imageHash: item.image?.imageHash ?? null,
        imageFile: item.image?.imageFile ?? null,
        imageExt: item.image?.imageExt ?? null,
        imageWidth: item.image?.imageWidth ?? null,
        imageHeight: item.image?.imageHeight ?? null,
        imageBytes: item.image?.imageBytes ?? null,
        originalName: item.name.slice(0, 200),
        source: item.parsed.source,
        raw: item.parsed.raw,
        createdAt: now,
        updatedAt: now,
      };
      data.characters.push(card);
      if (card.imageHash) existingHashes.add(card.imageHash);
      imported.push(card);
    }
    return { imported, skipped };
  });
}
