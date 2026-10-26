/**
 * 格式适配层注册表。新增格式只需在这里挂一个 adapter。
 */
import { naiAdapter } from './nai.js';
import { comfyAdapter } from './comfyui.js';

const ADAPTERS = new Map([
  ['nai', naiAdapter],
  ['comfyui', comfyAdapter],
]);

import { TARGET_IDS } from '../../shared/targets.js';

export const TARGETS = TARGET_IDS;

export function isTarget(value) {
  return TARGETS.includes(value);
}

/** @returns {typeof naiAdapter} 未知 target 回落 NAI，避免调用方到处判空 */
export function getAdapter(target) {
  return ADAPTERS.get(target) || naiAdapter;
}



export function normalizeFor(target, params) {
  return getAdapter(target).normalize(params);
}
