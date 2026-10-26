/**
 * Tag 库路由。
 */
import { readJsonBody, sendJson } from '../../lib/http.js';
import * as service from './service.js';
import * as tagOps from './tagOps.js';
import { listHistory, undoLast } from './history.js';

export function register(router, ctx) {
  router.get('/api/tags', async (req, res, { url }) => {
    sendJson(res, 200, service.list(ctx.db, Object.fromEntries(url.searchParams)));
  });

  // 用 body 传 tag，避免 tag 里的括号、斜杠破坏路径
  router.patch('/api/tags', async (req, res) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, await service.update(ctx.db, body));
  });

  router.get('/api/tags/history', async (req, res, { url }) => {
    const limit = Number(url.searchParams.get('limit')) || 20;
    sendJson(res, 200, { items: listHistory(ctx.db, limit) });
  });

  router.post('/api/tags/undo', async (req, res) => {
    sendJson(res, 200, await undoLast(ctx.db));
  });

  router.get('/api/tags/aliases', async (req, res) => {
    sendJson(res, 200, { items: service.listAliases(ctx.db) });
  });

  router.post('/api/tags/aliases/delete', async (req, res) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, await service.deleteAlias(ctx, body));
  });

  router.post('/api/tags/rename', async (req, res) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, await tagOps.rename(ctx, body));
  });

  router.post('/api/tags/find-replace', async (req, res) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, await tagOps.findReplace(ctx, body));
  });

  router.post('/api/tags/batch', async (req, res) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, await service.batchUpdate(ctx, body));
  });

  router.post('/api/tags/lookup', async (req, res) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, service.lookup(ctx.db, body?.tags));
  });

  router.post('/api/tags/translate', async (req, res) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, await service.translate(ctx, body));
  });

  router.post('/api/tags/sync', async (req, res) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, await service.sync(ctx, body));
  });

  router.post('/api/tags/import-dictionary', async (req, res) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, await service.importDictionary(ctx, body));
  });

  router.post('/api/tags/import', async (req, res) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, await service.importPack(ctx.db, body));
  });

  router.get('/api/tags/export', async (req, res) => {
    sendJson(res, 200, service.exportPack(ctx.db));
  });

  router.post('/api/tags/sync-catalog', async (req, res) => {
    sendJson(res, 200, await service.syncCatalog(ctx.db));
  });
}
