/**
 * 单文件 JSON 仓储。
 * 读：内存缓存（snapshot 返回深拷贝，调用方无法污染内部状态）。
 * 写：串行队列 + 快照上修改 + 原子写，失败不提交。
 */
import fs from 'node:fs/promises';
import { atomicWrite, ensureDir, pathExists, readJson } from '../lib/fsx.js';
import { defaultDb, migrate } from './schema.js';

export class Db {
  /** @param {{ file: string, dataDir: string }} options */
  constructor({ file, dataDir }) {
    this.file = file;
    this.dataDir = dataDir;
    /** @type {ReturnType<typeof defaultDb>} */
    this.data = defaultDb(dataDir);
    this.queue = Promise.resolve();
  }

  async init() {
    await ensureDir(this.dataDir);
    if (await pathExists(this.file)) {
      let raw = null;
      try {
        raw = await readJson(this.file);
      } catch (err) {
        // 文件损坏时不静默覆盖：备份后重建，避免用户数据无声消失
        const backup = `${this.file}.corrupt-${Date.now()}`;
        await fs.rename(this.file, backup).catch(() => {});
        console.error(`[db] db.json 解析失败，已备份到 ${backup}：${err.message}`);
      }
      this.data = migrate(raw, this.dataDir);
      if (!raw) await this.#flush(this.data);
    } else {
      this.data = defaultDb(this.dataDir);
      await this.#flush(this.data);
    }
    return this;
  }

  /** 只读快照 */
  snapshot() {
    return structuredClone(this.data);
  }

  /**
   * 事务式修改：在快照上执行 fn，成功写盘后再替换内存状态。
   * @template T
   * @param {(draft: any) => T | Promise<T>} fn
   * @returns {Promise<T>}
   */
  mutate(fn) {
    const task = async () => {
      const draft = structuredClone(this.data);
      const result = await fn(draft);
      await this.#flush(draft);
      this.data = draft;
      return result;
    };
    const run = this.queue.then(task, task);
    // 队列本身不因单次失败而中断
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** 用整份数据替换当前仓储（恢复备份用） */
  replace(data) {
    const task = async () => {
      await this.#flush(data);
      this.data = data;
    };
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #flush(data) {
    await atomicWrite(this.file, `${JSON.stringify(data, null, 2)}\n`);
  }

  close() {
    // JSON 仓储没有句柄需要释放
  }
}

/**
 * 优先使用 SQLite；运行环境不支持时回退到 db.json（数据不会丢，但会提示）。
 */
export async function openDb(config) {
  try {
    const { SqliteDb } = await import('./sqlite.js');
    const sqlite = new SqliteDb({
      file: config.sqliteFile,
      dataDir: config.dataDir,
      legacyFile: config.dbFile,
    });
    await sqlite.init();
    return sqlite;
  } catch (error) {
    console.error(`[db] SQLite 不可用，回退到 db.json：${error.message}`);
    const db = new Db({ file: config.dbFile, dataDir: config.dataDir });
    await db.init();
    return db;
  }
}
