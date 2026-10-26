/**
 * SQLite 仓储（node:sqlite）。
 *
 * 与 JSON 仓储保持同一套接口：snapshot() 返回深拷贝，mutate(fn) 串行执行并在事务里落盘。
 * 集合仍以 JSON 行存储（一条记录一行），避免把业务字段拆散到各表后牵连所有服务；
 * 但写入是事务化的、按主键增量 upsert，不再整库重写，千级数据下比 db.json 稳。
 *
 * 首次启动会把旧 db.json 迁入 atelier.db，并保留 .migrated 备份。
 */
import fs from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { defaultDb, migrate } from './schema.js';
import { ensureDir, pathExists, readJson } from '../lib/fsx.js';

const COLLECTIONS = [
  { key: 'folders', table: 'folders', id: 'id', sort: 'updated_at' },
  { key: 'prompts', table: 'prompts', id: 'id', sort: 'updated_at' },
  { key: 'images', table: 'images', id: 'id', sort: 'imported_at' },
  { key: 'tags', table: 'tags', id: 'tag', sort: 'updated_at' },
  { key: 'albums', table: 'albums', id: 'id', sort: 'updated_at' },
  { key: 'tagAliases', table: 'tag_aliases', id: 'alias', sort: 'created_at' },
  { key: 'characters', table: 'characters', id: 'id', sort: 'updated_at' },
  { key: 'tagHistory', table: 'tag_history', id: 'id', sort: 'created_at' },
  { key: 'imageRaw', table: 'image_raw', id: 'id', sort: 'created_at' },
];

export class SqliteDb {
  /** @param {{ file: string, dataDir: string, legacyFile?: string }} options */
  constructor({ file, dataDir, legacyFile }) {
    this.file = file;
    this.dataDir = dataDir;
    this.legacyFile = legacyFile;
    /** @type {ReturnType<typeof defaultDb>} */
    this.data = defaultDb(dataDir);
    this.queue = Promise.resolve();
    /** @type {DatabaseSync | null} */
    this.db = null;
  }

  async init() {
    await ensureDir(this.dataDir);
    this.db = new DatabaseSync(this.file);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.#createTables();

    const initialized = this.#meta('initialized');
    if (!initialized) {
      this.data = await this.#bootstrap();
      this.#persist(this.data);
      this.#setMeta('initialized', '1');
      this.#setMeta('schema_version', String(this.data.version));
      if (this.legacyFile && (await pathExists(this.legacyFile))) {
        await fs.rename(this.legacyFile, `${this.legacyFile}.migrated-${Date.now()}`).catch(() => {});
      }
      return this;
    }

    const loaded = this.#load();
    const migrated = migrate(loaded, this.dataDir);
    this.data = migrated;
    if (JSON.stringify(loaded) !== JSON.stringify(migrated)) this.#persist(migrated);
    return this;
  }

  snapshot() {
    return structuredClone(this.data);
  }

  /**
   * @template T
   * @param {(draft: any) => T | Promise<T>} fn
   * @returns {Promise<T>}
   */
  mutate(fn) {
    const task = async () => {
      const draft = structuredClone(this.data);
      const result = await fn(draft);
      this.#persist(draft);
      this.data = draft;
      return result;
    };
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** 用整份数据替换当前仓储（恢复备份用） */
  replace(data) {
    const task = async () => {
      this.#persist(data);
      this.data = data;
    };
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  close() {
    try {
      this.db?.close();
    } catch {
      // 已关闭时忽略
    }
    this.db = null;
  }

  #createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS prompts (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, json TEXT NOT NULL, imported_at TEXT);
      CREATE TABLE IF NOT EXISTS tags (tag TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS albums (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS tag_aliases (alias TEXT PRIMARY KEY, json TEXT NOT NULL, created_at TEXT);
      CREATE TABLE IF NOT EXISTS characters (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS tag_history (id TEXT PRIMARY KEY, json TEXT NOT NULL, created_at TEXT);
      CREATE TABLE IF NOT EXISTS image_raw (id TEXT PRIMARY KEY, json TEXT NOT NULL, created_at TEXT);
    `);
  }

  #meta(key) {
    return this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
  }

  #setMeta(key, value) {
    this.db
      .prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  async #bootstrap() {
    if (this.legacyFile && (await pathExists(this.legacyFile))) {
      let raw = null;
      try {
        raw = await readJson(this.legacyFile);
      } catch (error) {
        console.error(`[db] db.json 解析失败，将使用空库：${error.message}`);
      }
      return migrate(raw, this.dataDir);
    }
    return defaultDb(this.dataDir);
  }

  #load() {
    const settingsRow = this.db.prepare('SELECT json FROM settings WHERE id = 1').get();
    const data = {
      version: Number(this.#meta('schema_version')) || defaultDb(this.dataDir).version,
      settings: settingsRow ? JSON.parse(settingsRow.json) : defaultDb(this.dataDir).settings,
    };
    for (const collection of COLLECTIONS) {
      data[collection.key] = this.db
        .prepare(`SELECT json FROM ${collection.table} ORDER BY ${collection.sort} ASC`)
        .all()
        .map((row) => JSON.parse(row.json));
    }
    return data;
  }

  /** 事务写入：settings 单行 + 各集合按主键 upsert / 删除缺失项 */
  #persist(data) {
    const db = this.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO settings(id, json) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json').run(
        JSON.stringify(data.settings),
      );

      for (const collection of COLLECTIONS) {
        const rows = Array.isArray(data[collection.key]) ? data[collection.key] : [];
        const upsert = db.prepare(
          `INSERT INTO ${collection.table}(${collection.id}, json, ${collection.sort})
           VALUES(?, ?, ?)
           ON CONFLICT(${collection.id}) DO UPDATE SET json = excluded.json, ${collection.sort} = excluded.${collection.sort}`,
        );
        const ids = new Set();
        for (const row of rows) {
          const id = row?.[collection.id];
          if (typeof id !== 'string' || !id) continue;
          ids.add(id);
          upsert.run(id, JSON.stringify(row), row.updatedAt || row.importedAt || row.createdAt || null);
        }
        const existing = db.prepare(`SELECT ${collection.id} AS id FROM ${collection.table}`).all();
        const remove = db.prepare(`DELETE FROM ${collection.table} WHERE ${collection.id} = ?`);
        for (const row of existing) {
          if (!ids.has(row.id)) remove.run(row.id);
        }
      }

      this.#setMeta('schema_version', String(data.version));
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // 回滚失败时保留原始错误
      }
      throw error;
    }
  }
}
