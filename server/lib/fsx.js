/**
 * 文件系统工具：原子写、目录遍历、内容 hash、路径边界校验。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { ApiError } from './errors.js';

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(target) {
  try {
    const stat = await fs.stat(target);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * 原子写：先写同目录临时文件并 fsync，再 rename 覆盖。
 * 避免进程中断留下半截 JSON。
 */
export async function atomicWrite(file, data) {
  const dir = path.dirname(file);
  await ensureDir(dir);
  const tmp = path.join(dir, `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await fs.open(tmp, 'w');
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tmp, file);
  } catch (err) {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

export async function readJson(file) {
  const text = await fs.readFile(file, 'utf8');
  return JSON.parse(text);
}

export function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}



/** 递归列出文件绝对路径（跳过隐藏项），maxFiles 防止误扫超大目录 */
export async function walkFiles(root, { recursive = true, maxFiles = 5000 } = {}) {
  const out = [];
  async function visit(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (recursive) await visit(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }
  await visit(root);
  return out;
}

/** 判断 target 是否位于 root 内（Windows 下大小写不敏感） */
export function isInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (!rel) return true;
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  return true;
}

/**
 * 把用户输入解析成 root 内的绝对路径，越界直接抛 PATH_INVALID。
 * 用于图片库按相对路径取文件。
 */
export function resolveInside(root, relativePath) {
  const abs = path.resolve(root, relativePath);
  if (!isInside(root, abs)) {
    throw ApiError.pathInvalid('路径超出允许范围');
  }
  return abs;
}

/** 解析用户提交的扫描目录：必须是已存在的绝对路径 */
export async function assertExistingDir(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw ApiError.pathInvalid('目录路径不能为空');
  }
  const abs = path.resolve(input.trim());
  if (!path.isAbsolute(input.trim())) {
    throw ApiError.pathInvalid('需要绝对路径');
  }
  if (!(await isDirectory(abs))) {
    throw ApiError.pathInvalid('目录不存在或不可读');
  }
  return abs;
}
