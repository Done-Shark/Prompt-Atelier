/**
 * 目标格式的唯一配置表。前后端共用：新增格式时先改这里，再补 adapter / 解析器 / 参数表单。
 * 只放展示与身份信息，不放业务逻辑（业务在 server/formats/*.js）。
 */
export const TARGETS = [
  {
    id: 'nai',
    label: 'NovelAI',
    short: 'NAI',
    badge: 'badge--nai',
    dot: 'nai',
    pathHint: 'D:/NovelAI/outputs',
  },
  {
    id: 'comfyui',
    label: 'ComfyUI',
    short: 'ComfyUI',
    badge: 'badge--comfy',
    dot: 'comfy',
    pathHint: 'D:/ComfyUI/output',
  },
];

export const TARGET_IDS = TARGETS.map((target) => target.id);

export function getTargetMeta(id) {
  return TARGETS.find((target) => target.id === id) || TARGETS[0];
}
