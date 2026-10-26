/**
 * Tag 分类路由。
 */
import { readJsonBody, sendJson } from '../../lib/http.js';
import * as service from './service.js';

export function register(router, ctx) {
  router.get('/api/tag-categories', async (req, res) => {
    sendJson(res, 200, { items: service.list(ctx.db) });
  });

  router.post('/api/tag-categories', async (req, res) => {
    const body = await readJsonBody(req);
    sendJson(res, 201, await service.create(ctx, body));
  });

  router.post('/api/tag-categories/reorder', async (req, res) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, await service.reorder(ctx, body));
  });

  router.patch('/api/tag-categories/:id', async (req, res, { params }) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, await service.update(ctx, params.id, body));
  });

  router.delete('/api/tag-categories/:id', async (req, res, { params }) => {
    sendJson(res, 200, await service.remove(ctx, params.id));
  });
}
