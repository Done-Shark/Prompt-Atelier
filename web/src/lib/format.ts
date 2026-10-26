import { getTargetMeta } from '../../../shared/targets.js';
import type { Prompt, Target } from './types';

export function targetLabel(target: Target): string {
  return getTargetMeta(target).label;
}

export function targetShort(target: Target): string {
  return getTargetMeta(target).short;
}

/** 目标格式对应的徽标样式类，新增格式时无需再改组件 */
export function targetBadgeClass(target: Target): string {
  return getTargetMeta(target).badge;
}

export function targetPathHint(target: Target): string {
  return getTargetMeta(target).pathHint;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const diff = Date.now() - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return formatDate(iso);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const rounded =
    value >= 10 || index === 0 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '');
  return `${rounded} ${units[index]}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('zh-CN').format(value);
}

export function truncate(text: string, max: number): string {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max).trimEnd()}…` : value;
}

/** 列表里展示的正向摘要：压平空白、去掉过长权重包裹的视觉噪声 */
export function promptSnippet(prompt: Prompt, max = 160): string {
  return truncate(prompt.positive.replace(/\s+/g, ' ').trim(), max);
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}


