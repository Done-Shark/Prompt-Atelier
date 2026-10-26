/**
 * 应用装配：路由注册 + 静态资源 + 错误收敛。
 * 这里不含业务逻辑，只把 ctx（db/config）传给各模块。
 */
import path from 'node:path';
import { loadConfig } from './config.js';
import { openDb } from './store/db.js';
import { Router } from './lib/router.js';
import { toApiError } from './lib/errors.js';
import {
  HTML_CSP,
  NO_DIST_HTML,
  applyCors,
  resolveStatic,
  sendFile,
  sendHtml,
  sendJson,
} from './lib/http.js';
import { isDirectory } from './lib/fsx.js';
import { register as registerPrompts } from './modules/prompts/routes.js';
import { register as registerFolders } from './modules/folders/routes.js';
import { register as registerTags } from './modules/tags/routes.js';
import { register as registerImages } from './modules/images/routes.js';
import { register as registerAlbums } from './modules/albums/routes.js';
import { register as registerJobs } from './modules/jobs/routes.js';
import { register as registerCharacters } from './modules/characters/routes.js';
import { register as registerBackup } from './modules/backup/routes.js';
import { register as registerTagCategories } from './modules/tagCategories/routes.js';
import * as albumsService from './modules/albums/service.js';
import { register as registerSettings } from './modules/settings/routes.js';
import * as settingsService from './modules/settings/service.js';
import * as foldersService from './modules/folders/service.js';
import * as tagsService from './modules/tags/service.js';
import * as tagCategoriesService from './modules/tagCategories/service.js';
import { getAdapter } from './formats/index.js';
import { ensureMirroredStorage } from './modules/storage/layout.js';

export async function createApp(options = {}) {
  const config = options.config || loadConfig(options);
  const db = await openDb(config);
  const ctx = { db, config };
  // 旧版扁平布局在这里迁到镜像布局；已迁移的库顺带自愈（搬了一半 / 手动改过目录）
  await ensureMirroredStorage(ctx);
  const startedAt = Date.now();

  const router = new Router();

  router.get('/api/health', async (req, res) => {
    sendJson(res, 200, {
      ok: true,
      version: config.version,
      uptime: Math.round((Date.now() - startedAt) / 100) / 10,
    });
  });

  router.get('/api/bootstrap', async (req, res) => {
    sendJson(res, 200, {
      settings: settingsService.get(db, config.dataDir),
      folders: foldersService.list(db).items,
      albums: albumsService.list(db).items,
      tags: tagsService.tagNames(db),
      tagCategories: tagCategoriesService.list(db),
      stats: settingsService.stats(db),
      version: config.version,
      // 参数默认值由后端适配器提供，前端不再复制一份
      formats: {
        nai: getAdapter('nai').defaults(),
        comfyui: getAdapter('comfyui').defaults(),
      },
    });
  });

  registerPrompts(router, ctx);
  registerFolders(router, ctx);
  registerAlbums(router, ctx);
  registerJobs(router, ctx);
  registerCharacters(router, ctx);
  registerBackup(router, ctx);
  registerTagCategories(router, ctx);
  registerTags(router, ctx);
  registerImages(router, ctx);
  registerSettings(router, ctx);

  async function handler(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');

    if (isApi) {
      applyCors(req, res);
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      const matched = router.match(req.method || 'GET', url.pathname);
      if (!matched) {
        sendJson(res, 404, { error: { message: '接口不存在', code: 'NOT_FOUND' } });
        return;
      }
      try {
        await matched.handler(req, res, { params: matched.params, url });
      } catch (err) {
        const apiError = toApiError(err);
        if (apiError.code === 'INTERNAL') {
          console.error(`[api] ${req.method} ${url.pathname}`, err);
        }
        if (res.headersSent) {
          res.end();
          return;
        }
        sendJson(res, apiError.status, { error: { message: apiError.message, code: apiError.code } });
      }
      return;
    }

    await serveWeb(req, res, url, config);
  }

  return { handler, db, config, router };
}

/** 静态服务：有 web/dist 就服务构建产物并回退 index.html，否则返回中文提示 */
async function serveWeb(req, res, url, config) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  if (!(await isDirectory(config.webDist))) {
    sendHtml(res, 200, NO_DIST_HTML);
    return;
  }

  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const abs = resolveStatic(config.webDist, pathname);
  if (abs) {
    const cacheControl = pathname.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    if (await sendFile(res, abs, { 'Cache-Control': cacheControl })) return;
  }

  // SPA 回退：未知路径交给前端路由
  const indexFile = path.join(config.webDist, 'index.html');
  if (await sendFile(res, indexFile, { 'Cache-Control': 'no-cache', 'Content-Security-Policy': HTML_CSP })) return;
  sendHtml(res, 200, NO_DIST_HTML);
}
