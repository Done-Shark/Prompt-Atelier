/**
 * 设置与统计路由。
 */
import { readJsonBody, sendJson } from '../../lib/http.js';
import * as service from './service.js';

export function register(router, ctx) {
  router.get('/api/settings', async (req, res) => {
    sendJson(res, 200, service.get(ctx.db, ctx.config.dataDir));
  });

  router.patch('/api/settings', async (req, res) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, await service.update(ctx.db, ctx.config.dataDir, body));
  });

  router.get('/api/stats', async (req, res) => {
    sendJson(res, 200, service.stats(ctx.db));
  });
}
