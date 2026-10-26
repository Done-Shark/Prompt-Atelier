/**
 * 图片库路由：扫描/导入/索引 CRUD/文件流/to-prompt。
 */
import { readJsonBody, sendFile, sendJson } from '../../lib/http.js';
import { ApiError } from '../../lib/errors.js';
import * as service from './service.js';
import * as actions from '../actions/service.js';
import { relayout } from '../storage/layout.js';

function queryOf(url) {
  return Object.fromEntries(url.searchParams.entries());
}

export function register(router, ctx) {
  router.get('/api/images', async (req, res, { url }) => {
    sendJson(res, 200, service.list(ctx.db, queryOf(url)));
  });

  // 固定路径先于 :id 注册
  router.post('/api/images/scan', async (req, res) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, await service.scan(ctx, body));
  });

  router.post('/api/images/import', async (req, res) => {
    const body = await readJsonBody(req);
    const result = await service.importImages(ctx, body);
    await relayout(ctx);
    sendJson(res, 200, result);
  });

  router.post('/api/images/batch', async (req, res) => {
    const body = await readJsonBody(req);
    const result = await service.batch(ctx, body);
    await relayout(ctx);
    sendJson(res, 200, result);
  });

  router.post('/api/images/reorder', async (req, res) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, await service.reorder(ctx, body));
  });

  router.get('/api/images/:id', async (req, res, { params }) => {
    sendJson(res, 200, service.publicImage(service.get(ctx.db, params.id)));
  });

  router.post('/api/images/:id/reparse', async (req, res, { params }) => {
    sendJson(res, 200, await service.reparse(ctx, params.id));
  });

  router.patch('/api/images/:id', async (req, res, { params }) => {
    const body = await readJsonBody(req);
    const image = await service.update(ctx, params.id, body);
    await relayout(ctx);
    sendJson(res, 200, image);
  });

  router.delete('/api/images/:id', async (req, res, { params }) => {
    sendJson(res, 200, await service.remove(ctx, params.id));
  });

  router.get('/api/images/:id/file', async (req, res, { params }) => {
    const image = service.get(ctx.db, params.id);
    const abs = service.filePathOf(ctx.config, image);
    const ok = await sendFile(res, abs, { 'Cache-Control': 'public, max-age=31536000, immutable' });
    if (!ok) throw ApiError.notFound('图片文件不存在');
  });

  // 缩略图：前端首次渲染时用 canvas 生成并 POST 回来，之后直接读缓存
  router.get('/api/images/:id/thumb', async (req, res, { params }) => {
    const image = service.get(ctx.db, params.id);
    const ok = await sendFile(res, service.thumbPathOf(ctx.config, image), {
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    if (!ok) throw ApiError.notFound('缩略图尚未生成');
  });

  router.post('/api/images/:id/thumb', async (req, res, { params }) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, await service.saveThumb(ctx, params.id, body?.data));
  });

  router.post('/api/images/:id/to-prompt', async (req, res, { params }) => {
    const body = await readJsonBody(req);
    sendJson(res, 201, await actions.imageToPrompt(ctx, params.id, body));
  });
}
