/**
 * 整库备份 / 恢复路由。
 */
import { readJsonBody, sendJson } from '../../lib/http.js';
import * as service from './service.js';
import { relayout } from '../storage/layout.js';

export function register(router, ctx) {
  router.post('/api/backup/export', async (req, res) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, await service.exportBackup(ctx, body));
  });

  router.post('/api/backup/inspect', async (req, res) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, await service.inspectBackup(ctx, body));
  });

  router.post('/api/backup/restore', async (req, res) => {
    const body = await readJsonBody(req);
    const result = await service.restoreBackup(ctx, body);
    await relayout(ctx);
    sendJson(res, 200, result);
  });
}
