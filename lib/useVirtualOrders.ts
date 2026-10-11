'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { virtualWindow } from './virtual-window';
export function useVirtualOrders(count: number, resetKey: object) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const bodyOffsetRef = useRef(0);
  const headerHeightRef = useRef(0);
  const [position, setPosition] = useState({ top: 0, height: 400, offset: 0 });
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const table = tableRef.current;
    if (!viewport || !table) return;
    let frame = 0;
    const measure = () => {
      const head = table.tHead?.offsetHeight ?? 0;
      const offset = head + (table.caption?.offsetHeight ?? 0);
      bodyOffsetRef.current = offset;
      headerHeightRef.current = head;
      setPosition(previous => previous.top === viewport.scrollTop && previous.height === viewport.clientHeight && previous.offset === offset
        ? previous : { top: viewport.scrollTop, height: viewport.clientHeight, offset });
    };
    const scroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    if (table.tHead) observer.observe(table.tHead);
    if (table.caption) observer.observe(table.caption);
    viewport.addEventListener('scroll', scroll, { passive: true });
    measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); viewport.removeEventListener('scroll', scroll); };
  }, []);
  useEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
    setPosition(previous => ({ ...previous, top: 0 }));
  }, [resetKey]);
  const range = virtualWindow(count, position.top, position.height, position.offset);
  return { viewportRef, tableRef, bodyOffsetRef, headerHeightRef, range };
}
