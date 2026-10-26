/**
 * 后台任务路由：目录导入 + 进度轮询。
 */
import { readJsonBody, sendJson } from '../../lib/http.js';
import { ApiError } from '../../lib/errors.js';
import * as service from './service.js';

export function register(router, ctx) {
  router.post('/api/jobs/import-folder', async (req, res) => {
    const body = await readJsonBody(req);
    const job = await service.startImportFolder(ctx, body);
    service.pruneJobs();
    sendJson(res, 202, job);
  });

  router.get('/api/jobs/:id', async (req, res, { params }) => {
    const job = service.getJob(params.id);
    if (!job) throw ApiError.notFound('任务不存在或已过期');
    sendJson(res, 200, job);
  });
}
