import { describe, expect, it } from 'vitest';
import { formatBytes, formatNumber, targetLabel, targetShort, truncate } from './format';

describe('format', () => {
  it('formatBytes 按单位换算并处理空值', () => {
    expect(formatBytes(0)).toBe('—');
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
  });

  it('formatNumber 使用千分位，空值回落破折号', () => {
    expect(formatNumber(12345)).toBe('12,345');
    expect(formatNumber(null)).toBe('—');
  });

  it('truncate 超长时追加省略号', () => {
    expect(truncate('abcdef', 3)).toBe('abc…');
    expect(truncate('abc', 10)).toBe('abc');
  });

  it('targetLabel / targetShort 与目标格式一致', () => {
    expect(targetLabel('nai')).toBe('NovelAI');
    expect(targetLabel('comfyui')).toBe('ComfyUI');
    expect(targetShort('nai')).toBe('NAI');
    expect(targetShort('comfyui')).toBe('ComfyUI');
  });
});
