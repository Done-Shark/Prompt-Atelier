/**
 * RP 角色卡路由。
 */
import { readJsonBody, sendFile, sendJson } from '../../lib/http.js';
import { ApiError } from '../../lib/errors.js';
import * as service from './service.js';
import { relayout } from '../storage/layout.js';

export function register(router, ctx) {
  router.get('/api/characters', async (req, res, { url }) => {
    sendJson(res, 200, service.list(ctx.db, Object.fromEntries(url.searchParams)));
  });

  router.post('/api/characters', async (req, res) => {
    const body = await readJsonBody(req);
    const card = await service.create(ctx, body);
    await relayout(ctx);
    sendJson(res, 201, card);
  });

  router.post('/api/characters/import', async (req, res) => {
    const body = await readJsonBody(req);
    const result = await service.importCards(ctx, body);
    await relayout(ctx);
    sendJson(res, 200, result);
  });

  router.post('/api/characters/batch-delete', async (req, res) => {
    const body = await readJsonBody(req);
    const result = await service.batchDelete(ctx, body);
    await relayout(ctx);
    sendJson(res, 200, result);
  });

  router.post('/api/characters/batch-move', async (req, res) => {
    const body = await readJsonBody(req);
    const result = await service.batchMove(ctx, body);
    await relayout(ctx);
    sendJson(res, 200, result);
  });

  router.get('/api/characters/:id/image', async (req, res, { params }) => {
    const card = service.get(ctx.db, params.id);
    const abs = service.imagePathOf(ctx.config, card);
    if (!abs) throw ApiError.notFound('角色卡没有图片');
    const ok = await sendFile(res, abs, { 'Cache-Control': 'public, max-age=31536000, immutable' });
    if (!ok) throw ApiError.notFound('图片文件不存在');
  });

  router.get('/api/characters/:id/thumb', async (req, res, { params }) => {
    const card = service.get(ctx.db, params.id);
    const abs = service.thumbPathOf(ctx.config, card);
    if (!abs) throw ApiError.notFound('角色卡没有图片');
    const ok = await sendFile(res, abs, { 'Cache-Control': 'public, max-age=31536000, immutable' });
    if (!ok) throw ApiError.notFound('缩略图尚未生成');
  });

  router.post('/api/characters/:id/thumb', async (req, res, { params }) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, await service.saveThumb(ctx, params.id, body?.data));
  });

  router.patch('/api/characters/:id', async (req, res, { params }) => {
    const body = await readJsonBody(req);
    const card = await service.update(ctx, params.id, body);
    await relayout(ctx);
    sendJson(res, 200, card);
  });

  router.delete('/api/characters/:id', async (req, res, { params }) => {
    const result = await service.remove(ctx, params.id);
    await relayout(ctx);
    sendJson(res, 200, result);
  });
}
