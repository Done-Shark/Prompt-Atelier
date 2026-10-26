/**
 * 文件夹路由。
 */
import { readJsonBody, sendJson } from '../../lib/http.js';
import * as service from './service.js';
import { relayout } from '../storage/layout.js';

export function register(router, ctx) {
  router.get('/api/folders', async (req, res, { url }) => {
    sendJson(res, 200, service.list(ctx.db, Object.fromEntries(url.searchParams)));
  });

  router.post('/api/folders', async (req, res) => {
    const body = await readJsonBody(req);
    sendJson(res, 201, await service.create(ctx.db, body));
  });

  router.patch('/api/folders/:id', async (req, res, { params }) => {
    const body = await readJsonBody(req);
    const folder = await service.update(ctx.db, params.id, body);
    await relayout(ctx);
    sendJson(res, 200, folder);
  });

  router.post('/api/folders/:id/move', async (req, res, { params }) => {
    const body = await readJsonBody(req);
    const result = await service.move(ctx.db, params.id, body);
    await relayout(ctx);
    sendJson(res, 200, result);
  });

  router.delete('/api/folders/:id', async (req, res, { params }) => {
    const result = await service.remove(ctx.db, params.id);
    await relayout(ctx);
    sendJson(res, 200, result);
  });
}
