/**
 * 侧栏行的指针拖拽排序。
 *
 * 为什么不用 HTML5 拖拽：
 * - dragover 阶段 dataTransfer 被浏览器保护，getData 读不到自定义数据；
 * - 行内嵌 button 时，拖过按钮会反复触发 dragleave，drop 直接被拒绝。
 * 指针方案不依赖 dataTransfer，鼠标/触控板表现一致。
 */
import { useCallback, useRef, useState } from 'react';

export type RowDropZone = 'before' | 'inside' | 'after';

export interface RowDragHint {
  targetId: string;
  zone: RowDropZone;
}

interface UseRowDragOptions {
  /** 允许的落点；相簿只需要 before/after */
  zones?: RowDropZone[];
  /** targetId 为 null 表示落在根级区域 */
  onDrop: (sourceId: string, targetId: string | null, zone: RowDropZone) => void;
  /** 根级落点选择器；传 null 表示不需要根级落点 */
  rootSelector?: string | null;
  /** 这些区域内的按下不触发拖拽 */
  ignoreSelector?: string;
}

interface DragState {
  id: string;
  startX: number;
  startY: number;
  active: boolean;
}

const DEFAULT_IGNORE = '.menu-wrap, .folder-row__caret, .ifolder-row__caret, .folder-row__more, .ifolder-row__more, [data-no-drag]';
const THRESHOLD = 4;

export function useRowDrag({
  zones = ['before', 'inside', 'after'],
  onDrop,
  rootSelector = '[data-drag-root]',
  ignoreSelector = DEFAULT_IGNORE,
}: UseRowDragOptions) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [hint, setHint] = useState<RowDragHint | null>(null);
  const [overRoot, setOverRoot] = useState(false);

  const stateRef = useRef<DragState | null>(null);
  const hintRef = useRef<RowDragHint | null>(null);
  const overRootRef = useRef(false);
  const suppressClickRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const setHintSafe = useCallback((next: RowDragHint | null) => {
    const current = hintRef.current;
    if (current?.targetId === next?.targetId && current?.zone === next?.zone) return;
    hintRef.current = next;
    setHint(next);
  }, []);

  const setOverRootSafe = useCallback((next: boolean) => {
    if (overRootRef.current === next) return;
    overRootRef.current = next;
    setOverRoot(next);
  }, []);

  const finish = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    stateRef.current = null;
    setDragId(null);
    setHintSafe(null);
    setOverRootSafe(false);
    delete document.body.dataset.rowDragging;
  }, [setHintSafe, setOverRootSafe]);

  const startDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>, id: string) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (ignoreSelector && target.closest(ignoreSelector)) return;
      if (stateRef.current) return;

      stateRef.current = { id, startX: event.clientX, startY: event.clientY, active: false };

      const resolveTarget = (x: number, y: number) => {
        const element = document.elementFromPoint(x, y) as HTMLElement | null;
        if (!element) return { targetId: null, zone: null, root: false };
        if (rootSelector && element.closest(rootSelector)) return { targetId: null, zone: null, root: true };
        const row = element.closest<HTMLElement>('[data-drag-row]');
        if (!row) return { targetId: null, zone: null, root: false };
        const rowId = row.dataset.dragRow;
        if (!rowId || rowId === id) return { targetId: null, zone: null, root: false };
        const rect = row.getBoundingClientRect();
        const ratio = (y - rect.top) / Math.max(1, rect.height);
        let zone: RowDropZone = 'inside';
        if (ratio < 0.3) zone = 'before';
        else if (ratio > 0.7) zone = 'after';
        if (!zones.includes(zone)) zone = ratio < 0.5 ? 'before' : 'after';
        return { targetId: rowId, zone, root: false };
      };

      const onMove = (moveEvent: PointerEvent) => {
        const state = stateRef.current;
        if (!state) return;
        const dx = moveEvent.clientX - state.startX;
        const dy = moveEvent.clientY - state.startY;
        if (!state.active) {
          if (Math.hypot(dx, dy) < THRESHOLD) return;
          state.active = true;
          setDragId(state.id);
          document.body.dataset.rowDragging = 'true';
        }
        moveEvent.preventDefault();
        const next = resolveTarget(moveEvent.clientX, moveEvent.clientY);
        setOverRootSafe(next.root);
        setHintSafe(next.targetId && next.zone ? { targetId: next.targetId, zone: next.zone } : null);
      };

      const onUp = () => {
        const state = stateRef.current;
        const active = state?.active === true;
        const currentHint = hintRef.current;
        const root = overRootRef.current;
        if (active) {
          // 拖拽结束后紧跟的 click 不应该被当成点击选中
          suppressClickRef.current = true;
          window.setTimeout(() => {
            suppressClickRef.current = false;
          }, 250);
        }
        finish();
        if (!active) return;
        if (root) onDrop(state!.id, null, 'after');
        else if (currentHint) onDrop(state!.id, currentHint.targetId, currentHint.zone);
      };

      const onCancel = () => finish();
      const onKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === 'Escape') finish();
      };

      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onCancel, true);
      window.addEventListener('keydown', onKeyDown, true);
      cleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('pointercancel', onCancel, true);
        window.removeEventListener('keydown', onKeyDown, true);
      };
    },
    [finish, ignoreSelector, onDrop, rootSelector, setHintSafe, setOverRootSafe, zones],
  );

  /** 拖拽刚结束时返回 true，用来吞掉那一次 click */
  const shouldIgnoreClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  return { dragId, hint, overRoot, startDrag, shouldIgnoreClick };
}
