/**
 * 图片拖拽的 MIME 与读写辅助。
 * 用自定义 MIME 区分"图片拖拽"与浏览器默认的文件拖拽。
 * 文件夹 / 相簿的排序改用指针拖拽（见 lib/useRowDrag.ts），不在这里。
 */
export const IMAGE_DRAG_MIME = 'application/x-prompt-atelier-images';

export function writeImageDragData(transfer: DataTransfer, ids: string[]) {
  transfer.setData(IMAGE_DRAG_MIME, JSON.stringify(ids));
  transfer.setData('text/plain', ids.join('\n'));
  transfer.effectAllowed = 'move';
}

export function readImageDragData(transfer: DataTransfer): string[] {
  try {
    const raw = transfer.getData(IMAGE_DRAG_MIME);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

export function hasImageDragData(transfer: DataTransfer): boolean {
  return Array.from(transfer.types).includes(IMAGE_DRAG_MIME);
}

/** 系统文件拖入（从资源管理器/浏览器外部拖图片） */
export function hasFileDragData(transfer: DataTransfer): boolean {
  return Array.from(transfer.types).includes('Files');
}
