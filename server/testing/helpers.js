/**
 * 测试辅助：临时数据目录 + 临时 HTTP 服务。
 * 不放在 test/ 目录下，避免被 node --test 当成测试文件。
 */
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { openDb } from '../store/db.js';

export async function makeTmpDir(prefix = 'pa-test-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function rmDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

/** 直接打开一个隔离的仓储（服务层测试用） */
export async function openTestDb(t) {
  const dir = await makeTmpDir();
  const db = await openDb({
    dataDir: dir,
    dbFile: path.join(dir, 'db.json'),
    sqliteFile: path.join(dir, 'atelier.db'),
  });
  t.after(async () => {
    db.close();
    await rmDir(dir);
  });
  return { db, dir };
}

/** 启动真实 HTTP 服务（路由测试用），退出时关闭并清理 */
export async function startTestServer(t, options = {}) {
  const dataDir = options.dataDir || (await makeTmpDir());
  const app = await createApp({ dataDir });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const close = async () => {
    await new Promise((resolve) => server.close(resolve));
    app.db.close();
    await rmDir(dataDir);
  };
  t.after(close);

  return { base, dataDir, app, server, close };
}

/** 极简 fetch 封装：自动 JSON 解析，返回 { status, body, headers } */
export async function api(base, pathname, options = {}) {
  const init = { method: options.method || 'GET', headers: {} };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    init.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(base + pathname, init);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}
