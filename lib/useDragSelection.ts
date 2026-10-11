'use client';
import { useCallback, useEffect, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type RefObject, type SetStateAction } from 'react';
import type { Row } from './model';
import { ORDER_ROW_HEIGHT } from './virtual-window';
type Drag = { pointer: number; x: number; y: number; currentY: number; start: number; last: number; base: Map<string, string>; active: boolean };
export function useDragSelection({ rowsRef, selectionRef, setSelected, viewportRef, bodyOffsetRef, headerHeightRef, anchorRef, disabled, resetKey }: {
  rowsRef: RefObject<Row[]>; selectionRef: RefObject<Map<string, string>>;
  setSelected: Dispatch<SetStateAction<Map<string, string>>>;
  viewportRef: RefObject<HTMLDivElement | null>; bodyOffsetRef: RefObject<number>; headerHeightRef: RefObject<number>;
  anchorRef: RefObject<string | null>;
  disabled: boolean; resetKey: object;
}) {
  const drag = useRef<Drag | null>(null);
  const frame = useRef(0);
  const ignoreClick = useRef(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const disabledRef = useRef(disabled); disabledRef.current = disabled;
  const [dragging, setDragging] = useState(false);
  const stop = useCallback(() => {
    const current = drag.current;
    drag.current = null;
    cancelAnimationFrame(frame.current);
    setDragging(false);
    if (current?.active) {
      ignoreClick.current = true;
      clearTimeout(clickTimer.current);
      clickTimer.current = setTimeout(() => { ignoreClick.current = false; }, 0);
    }
    const viewport = viewportRef.current;
    if (current && viewport?.hasPointerCapture(current.pointer)) viewport.releasePointerCapture(current.pointer);
  }, [viewportRef]);
  useEffect(() => { stop(); }, [resetKey, stop]);
  useEffect(() => {
    const update = () => {
      const current = drag.current, viewport = viewportRef.current;
      if (!current?.active || !viewport) return;
      const rect = viewport.getBoundingClientRect();
      const localY = Math.max(headerHeightRef.current, Math.min(viewport.clientHeight - 1, current.currentY - rect.top));
      const index = Math.max(0, Math.min(rowsRef.current.length - 1, Math.floor((viewport.scrollTop + localY - bodyOffsetRef.current) / ORDER_ROW_HEIGHT)));
      if (index === current.last) return;
      current.last = index;
      const next = new Map(current.base);
      for (const row of rowsRef.current.slice(Math.min(current.start, index), Math.max(current.start, index) + 1)) next.set(row._id, row._rev!);
      setSelected(next);
    };
    const autoScroll = () => {
      const current = drag.current, viewport = viewportRef.current;
      if (!current?.active || !viewport) return;
      const rect = viewport.getBoundingClientRect();
      const upper = rect.top + headerHeightRef.current + 24, lower = rect.top + viewport.clientHeight - 24;
      if (current.currentY < upper) viewport.scrollTop -= Math.min(22, (upper - current.currentY) / 3 + 2);
      else if (current.currentY > lower) viewport.scrollTop += Math.min(22, (current.currentY - lower) / 3 + 2);
      update();
      frame.current = requestAnimationFrame(autoScroll);
    };
    const move = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || event.pointerId !== current.pointer) return;
      current.currentY = event.clientY;
      if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) >= 5) {
        current.active = true;
        anchorRef.current = rowsRef.current[current.start]?._id ?? null;
        setDragging(true);
        viewportRef.current?.setPointerCapture(event.pointerId);
        frame.current = requestAnimationFrame(autoScroll);
      }
      if (current.active) { event.preventDefault(); update(); }
    };
    const end = (event: PointerEvent) => { if (event.pointerId === drag.current?.pointer) stop(); };
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
    window.addEventListener('blur', stop);
    return () => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end); window.removeEventListener('blur', stop);
      cancelAnimationFrame(frame.current); clearTimeout(clickTimer.current);
    };
  }, [viewportRef, rowsRef, bodyOffsetRef, headerHeightRef, anchorRef, setSelected, stop]);
  const start = useCallback((row: Row, event: ReactPointerEvent<HTMLTableRowElement>) => {
    // Touch retains normal scrolling; controls and the right button keep their
    // own behavior. Capture starts only after the drag threshold, so clicks and
    // double clicks still select/edit exactly as before.
    if (disabledRef.current || event.button !== 0 || event.pointerType === 'touch'
      || (event.target as HTMLElement).closest('input,button,select,a')) return;
    const index = rowsRef.current.findIndex(item => item._id === row._id);
    if (index < 0) return;
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, currentY: event.clientY,
      start: index, last: -1, base: new Map(event.ctrlKey || event.metaKey || event.shiftKey ? selectionRef.current : []), active: false };
  }, [rowsRef, selectionRef]);
  const suppressClick = useCallback(() => ignoreClick.current, []);
  return { start, dragging, suppressClick };
}
