/**
 * 相簿路由。
 */
import { readJsonBody, sendJson } from '../../lib/http.js';
import * as service from './service.js';

export function register(router, ctx) {
  router.get('/api/albums', async (req, res) => {
    sendJson(res, 200, service.list(ctx.db));
  });

  router.post('/api/albums', async (req, res) => {
    const body = await readJsonBody(req);
    sendJson(res, 201, await service.create(ctx.db, body));
  });

  router.post('/api/albums/reorder', async (req, res) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, await service.reorder(ctx.db, body));
  });

  router.patch('/api/albums/:id', async (req, res, { params }) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, await service.update(ctx.db, params.id, body));
  });

  router.delete('/api/albums/:id', async (req, res, { params }) => {
    sendJson(res, 200, await service.remove(ctx.db, params.id));
  });

  router.post('/api/albums/:id/images', async (req, res, { params }) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, await service.membership(ctx, params.id, body));
  });
}
