/**
 * 导入外部 Tag 词典（默认只补空，不覆盖人工修正）。
 *
 * 用法：
 *   node server/scripts/import-dictionary.js                 # 一键下载 ffdkj 的 tag.sqlite 并导入
 *   node server/scripts/import-dictionary.js <路径|URL>      # 本地 / 远程文件
 *   node server/scripts/import-dictionary.js <路径> --overwrite   # 覆盖已有翻译（人工分类仍保留）
 *   node server/scripts/import-dictionary.js <路径> --all         # 连词典里的新 tag 一起写进 Tag 库
 *   node server/scripts/import-dictionary.js <路径> --dry-run     # 只统计，不写库
 *
 * 支持：
 *   - ffdkj `tag.sqlite`（表 tags: name / category / cn_name / post_count）
 *   - JSON：通用 {tag: 中文}、本项目导出包、NAI Launcher zh_translations、DSO dso-dictionary
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { openDb } from '../store/db.js';
import { mergeDictionary, parseDictionaryJson, readFfdkjSqlite } from '../modules/tags/dictionaryImport.js';

/** ffdkj 词典（与 Aaalice_NAI_Launcher 固定的同一个提交） */
const FFDKJ_URL =
  'https://raw.githubusercontent.com/ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table/3049e201002a64702873d7f9f3cc7cb8c45ea325/tag.sqlite';

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const source = args.find((arg) => !arg.startsWith('--')) || 'ffdkj';
const overwrite = flags.has('--overwrite');
const includeAll = flags.has('--all');
const dryRun = flags.has('--dry-run');

function isUrl(value) {
  return /^https?:\/\//i.test(value);
}

async function download(url, dest) {
  console.log(`下载词典：${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(dest, buffer);
  console.log(`已下载 ${(buffer.length / 1024 / 1024).toFixed(1)} MB → ${dest}`);
  return dest;
}

async function resolveSource() {
  if (source === 'ffdkj') {
    const dest = path.join(os.tmpdir(), 'ffdkj-tag.sqlite');
    // 已经下过就直接复用，省掉 20MB+ 的重复下载
    try {
      const stat = await fs.stat(dest);
      if (stat.size > 1024 * 1024) {
        console.log(`复用已下载的词典：${dest}（${(stat.size / 1024 / 1024).toFixed(1)} MB）`);
        return dest;
      }
    } catch {
      // 没有缓存就下载
    }
    return download(FFDKJ_URL, dest);
  }
  if (isUrl(source)) {
    const name = path.basename(new URL(source).pathname) || 'dictionary';
    const dest = path.join(os.tmpdir(), `pa-dict-${name}`);
    return download(source, dest);
  }
  const absolute = path.resolve(source);
  await fs.access(absolute);
  return absolute;
}

async function loadEntries(file) {
  const handle = await fs.open(file, 'r');
  const head = Buffer.alloc(16);
  await handle.read(head, 0, 16, 0);
  await handle.close();
  const isSqlite = head.subarray(0, 15).toString('ascii') === 'SQLite format 3';
  if (isSqlite) {
    const entries = await readFfdkjSqlite(file);
    return { format: 'ffdkj-sqlite', entries };
  }
  const text = await fs.readFile(file, 'utf8');
  return parseDictionaryJson(text);
}

const file = await resolveSource();
const { format, entries } = await loadEntries(file);
console.log(`识别为 ${format}，共 ${entries.length} 条词条`);

if (dryRun) {
  console.log('--dry-run：不写入数据库');
  process.exit(0);
}

const config = loadConfig();
const db = await openDb(config);
try {
  const result = await mergeDictionary(db, entries, { overwrite, all: includeAll });
  console.log(
    [
      `更新 ${result.updated} 条`,
      `新增 ${result.added} 条`,
      `跳过 ${result.skipped} 条`,
      result.missing ? `库中未收录 ${result.missing} 条（--all 可一并写入）` : null,
    ]
      .filter(Boolean)
      .join('，'),
  );
  const snap = db.snapshot();
  const translated = snap.tags.filter((entry) => entry.translation).length;
  console.log(`Tag 库：${snap.tags.length} 条，其中 ${translated} 条有翻译`);
} finally {
  db.close();
}
