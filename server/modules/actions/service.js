/**
 * 跨模块编排：图片 → Prompt。
 *
 * 单独放一层，避免 images 服务依赖 prompts 服务；整个动作在一个事务里完成，
 * 不会出现「Prompt 建好了但图片没关联」的中间状态。
 */
import { ApiError } from '../../lib/errors.js';
import * as images from '../images/service.js';
import * as prompts from '../prompts/service.js';

/**
 * @param {{ db: any, config: any }} ctx
 * @param {string} imageId
 * @param {object} [body]
 */
export async function imageToPrompt(ctx, imageId, body = {}) {
  return ctx.db.mutate((data) => {
    const image = data.images.find((item) => item.id === imageId);
    if (!image) throw ApiError.notFound('图片不存在');
    const input = images.toPromptInput(image, body);
    const prompt = prompts.createInData(data, input);
    images.linkPromptInData(data, image.id, prompt.id);
    return prompt;
  });
}
