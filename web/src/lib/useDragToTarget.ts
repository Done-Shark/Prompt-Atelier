/**
 * 指针拖拽：把某个条目拖到带 `data-card-target` 的目标上（用于角色卡 → 文件夹）。
 *
 * 与 useRowDrag 一样不走 HTML5 拖拽：dragover 阶段 dataTransfer 被浏览器保护，
 * 指针方案在鼠标 / 触控板上表现一致，也不受行内按钮影响。
 */
import { useCallback, useRef, useState } from 'react';

interface UseDragToTargetOptions {
  /** 目标元素选择器，元素上需要 data-card-target="<id>" */
  targetSelector: string;
  onDrop: (sourceId: string, targetId: string) => void;
  /** 这些区域内的按下不触发拖拽 */
  ignoreSelector?: string;
  threshold?: number;
}

export function useDragToTarget({
  targetSelector,
  onDrop,
  ignoreSelector = '.menu-wrap, [data-no-drag]',
  threshold = 4,
}: UseDragToTargetOptions) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overTarget, setOverTarget] = useState<string | null>(null);

  const stateRef = useRef<{ id: string; x: number; y: number; active: boolean } | null>(null);
  const overRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const finish = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    stateRef.current = null;
    overRef.current = null;
    setDragId(null);
    setOverTarget(null);
    delete document.body.dataset.rowDragging;
  }, []);

  const startDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>, id: string) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (ignoreSelector && target.closest(ignoreSelector)) return;
      if (stateRef.current) return;

      stateRef.current = { id, x: event.clientX, y: event.clientY, active: false };

      const onMove = (moveEvent: PointerEvent) => {
        const state = stateRef.current;
        if (!state) return;
        if (!state.active) {
          if (Math.hypot(moveEvent.clientX - state.x, moveEvent.clientY - state.y) < threshold) return;
          state.active = true;
          setDragId(state.id);
          document.body.dataset.rowDragging = 'true';
        }
        moveEvent.preventDefault();
        const element = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null;
        const hit = element?.closest<HTMLElement>(targetSelector);
        const next = hit?.dataset.cardTarget ?? null;
        if (overRef.current !== next) {
          overRef.current = next;
          setOverTarget(next);
        }
      };

      const onUp = () => {
        const state = stateRef.current;
        const active = state?.active === true;
        const over = overRef.current;
        if (active) {
          // 拖拽结束后紧跟的 click 不应该被当成选中
          suppressClickRef.current = true;
          window.setTimeout(() => {
            suppressClickRef.current = false;
          }, 250);
        }
        finish();
        if (active && over) onDrop(state!.id, over);
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
    [finish, ignoreSelector, onDrop, targetSelector, threshold],
  );

  const shouldIgnoreClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  return { dragId, overTarget, startDrag, shouldIgnoreClick };
}
