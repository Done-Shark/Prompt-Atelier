/**
 * 运行时配置：路径解析、端口、版本号。
 * 所有路径都在这里集中计算，其他模块只接收 config 对象。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根目录（server/ 的上一级） */
export const repoRoot = path.resolve(here, '..');

function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.1.0';
  } catch {
    return '0.1.0';
  }
}

export const VERSION = readVersion();

/**
 * 生成配置对象。测试通过显式传入 dataDir 隔离真实数据目录。
 * @param {{ dataDir?: string, env?: NodeJS.ProcessEnv }} [options]
 */
export function loadConfig(options = {}) {
  const env = options.env || process.env;
  const dataDir = path.resolve(options.dataDir || env.PROMPT_ATELIER_DATA_DIR || path.join(repoRoot, 'data'));
  const port = Number.parseInt(env.PORT ?? '', 10);
  return {
    version: VERSION,
    repoRoot,
    dataDir,
    dbFile: path.join(dataDir, 'db.json'),
    sqliteFile: path.join(dataDir, 'atelier.db'),
    imagesDir: path.join(dataDir, 'images'),
    thumbsDir: path.join(dataDir, 'thumbs'),
    webDist: path.join(repoRoot, 'web', 'dist'),
    host: env.HOST || '127.0.0.1',
    port: Number.isInteger(port) && port > 0 ? port : 8787,
  };
}
