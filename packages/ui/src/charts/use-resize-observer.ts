'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Observe an element's width. Returns a ref to attach and the current pixel width.
 * Used by charts to render responsively instead of relying on a fixed viewBox.
 */
export function useResizeObserver<T extends HTMLElement>(): {
  ref: RefObject<T | null>;
  width: number;
  height: number;
} {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        setSize({ width: cr.width, height: cr.height });
      }
    });
    observer.observe(el);
    // Set initial size synchronously.
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  return { ref, width: size.width, height: size.height };
}
