/**
 * Prompt 路由：只做参数读取与响应封装，业务在 service。
 */
import { readJsonBody, sendJson } from '../../lib/http.js';
import { ApiError } from '../../lib/errors.js';
import * as service from './service.js';

function queryOf(url) {
  return Object.fromEntries(url.searchParams.entries());
}

export function register(router, ctx) {
  router.get('/api/prompts', async (req, res, { url }) => {
    sendJson(res, 200, service.list(ctx.db, queryOf(url)));
  });

  router.post('/api/prompts', async (req, res) => {
    const body = await readJsonBody(req);
    const prompt = await service.create(ctx.db, body);
    sendJson(res, 201, prompt);
  });

  // 固定路径必须注册在 :id 之前
  router.post('/api/prompts/import', async (req, res) => {
    const body = await readJsonBody(req);
    const result = await service.importMany(ctx.db, { data: body.data, folderId: body.folderId });
    sendJson(res, 200, result);
  });

  router.get('/api/prompts/export', async (req, res, { url }) => {
    const pack = service.exportPack(ctx.db, queryOf(url));
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    sendJson(res, 200, pack, {
      'Content-Disposition': `attachment; filename="prompt-atelier-${date}.json"`,
    });
  });

  router.get('/api/prompts/:id', async (req, res, { params }) => {
    sendJson(res, 200, service.get(ctx.db, params.id));
  });

  router.patch('/api/prompts/:id', async (req, res, { params }) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, await service.update(ctx.db, params.id, body));
  });

  router.delete('/api/prompts/:id', async (req, res, { params }) => {
    sendJson(res, 200, await service.remove(ctx.db, params.id));
  });

  router.post('/api/prompts/:id/duplicate', async (req, res, { params }) => {
    sendJson(res, 201, await service.duplicate(ctx.db, params.id));
  });

  router.post('/api/prompts/:id/use', async (req, res, { params }) => {
    sendJson(res, 200, await service.markUsed(ctx.db, params.id));
  });

  router.get('/api/prompts/:id/copy', async (req, res, { params, url }) => {
    const format = url.searchParams.get('format');
    if (format && format !== 'nai' && format !== 'comfyui') {
      throw ApiError.validation('format 只能是 nai 或 comfyui');
    }
    const mode = url.searchParams.get('mode') || undefined;
    sendJson(res, 200, service.copy(ctx.db, params.id, { format, mode }));
  });
}
