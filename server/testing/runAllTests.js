/**
 * 测试聚合器：仅在测试子进程（NODE_TEST_CONTEXT）里被 index.js 加载。
 * 递归收集 server 下的 *.test.js 并逐个 import，让 node:test 完成注册与执行。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');

async function collect(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collect(full)));
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      out.push(full);
    }
  }
  return out;
}

const files = (await collect(serverRoot)).sort();
for (const file of files) {
  await import(pathToFileURL(file).href);
}
