/**
 * 设置与统计。dataDir 只读，始终返回进程实际使用的目录。
 */
import { ApiError } from '../../lib/errors.js';
import { cleanBool, cleanEnum, cleanString, cleanStringArray, isPlainObject, LIMITS } from '../../lib/validate.js';
import { TARGETS } from '../../formats/index.js';

const THEMES = ['dark', 'light', 'system'];

export function get(db, dataDir) {
  return { ...db.snapshot().settings, dataDir };
}

export async function update(db, dataDir, patch = {}) {
  if (!isPlainObject(patch)) throw ApiError.validation('请求体必须是对象');

  return db.mutate((data) => {
    const settings = data.settings;
    if ('theme' in patch) {
      const theme = cleanEnum(patch.theme, THEMES, null);
      if (!theme) throw ApiError.validation('theme 只能是 dark / light / system');
      settings.theme = theme;
    }
    if ('defaultTarget' in patch) {
      const target = cleanEnum(patch.defaultTarget, TARGETS, null);
      if (!target) throw ApiError.validation('defaultTarget 只能是 nai 或 comfyui');
      settings.defaultTarget = target;
    }
    if ('scanPaths' in patch) {
      if (!isPlainObject(patch.scanPaths)) throw ApiError.validation('scanPaths 必须是对象');
      for (const target of TARGETS) {
        if (!(target in patch.scanPaths)) continue;
        if (!Array.isArray(patch.scanPaths[target])) {
          throw ApiError.validation(`scanPaths.${target} 必须是路径数组`);
        }
        const paths = cleanStringArray(patch.scanPaths[target], {
          maxItems: LIMITS.scanPaths,
          maxLen: LIMITS.path,
        });
        settings.scanPaths[target] = paths;
      }
    }
    if ('copyWithParams' in patch) settings.copyWithParams = cleanBool(patch.copyWithParams, settings.copyWithParams);
    if ('autoTagOnImport' in patch) settings.autoTagOnImport = cleanBool(patch.autoTagOnImport, settings.autoTagOnImport);
    if ('reduceMotion' in patch) settings.reduceMotion = cleanBool(patch.reduceMotion, settings.reduceMotion);
    if ('translation' in patch) {
      if (!isPlainObject(patch.translation)) throw ApiError.validation('translation 必须是对象');
      const translation = settings.translation;
      const input = patch.translation;
      if ('provider' in input) {
        const provider = cleanEnum(input.provider, ['dictionary', 'llm', 'gemini'], null);
        if (!provider) throw ApiError.validation('翻译来源只能是 dictionary / llm / gemini');
        translation.provider = provider;
      }
      for (const field of ['baseUrl', 'model', 'apiKey']) {
        if (field in input) {
          translation[field] = cleanString(input[field], { field, max: field === 'apiKey' ? 400 : 500 }) ?? '';
        }
      }
      if ('autoTranslateOnImport' in input) {
        translation.autoTranslateOnImport = cleanBool(input.autoTranslateOnImport, translation.autoTranslateOnImport);
      }
      if ('danbooruEnabled' in input) {
        translation.danbooruEnabled = cleanBool(input.danbooruEnabled, translation.danbooruEnabled);
      }
    }
    // dataDir 由进程启动参数决定，忽略客户端提交

    settings.dataDir = dataDir;
    return { ...settings };
  });
}

export function stats(db) {
  const snap = db.snapshot();
  const prompts = snap.prompts;
  const images = snap.images;
  const tags = new Set();
  for (const prompt of prompts) {
    for (const tag of prompt.tags || []) tags.add(tag);
  }
  return {
    prompts: prompts.length,
    naiPrompts: prompts.filter((prompt) => prompt.target === 'nai').length,
    comfyPrompts: prompts.filter((prompt) => prompt.target === 'comfyui').length,
    images: images.length,
    naiImages: images.filter((image) => image.target === 'nai').length,
    comfyImages: images.filter((image) => image.target === 'comfyui').length,
    favorites: prompts.filter((prompt) => prompt.favorite).length,
    folders: snap.folders.length,
    albums: (snap.albums || []).length,
    tags: (snap.tags || []).length,
  };
}
