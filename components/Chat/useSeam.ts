"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

/**
 * Where the conversation turns the page: the index of the first row on the
 * right page, which the latest rows fill (the last one always goes there).
 * Rows are measured as they render; a row's height on the right page is kept
 * once seen there, so a row at the seam can't bounce between the pages.
 */
export function useSeam(
  ids: string[],
  enabled: boolean,
  refs: {
    /** The right page's scroller, its rows, and the left page's rows */
    page: RefObject<HTMLElement | null>;
    rows: RefObject<HTMLElement | null>;
    leftRows: RefObject<HTMLElement | null>;
  }
): number {
  const [seam, setSeam] = useState(0);
  const heights = useRef<{ width: number; byId: Map<string, number> }>({
    width: 0,
    byId: new Map(),
  });
  // The rows each page holds now: the DOM matches the last render
  const rendered = useRef({ ids, seam });
  rendered.current = { ids, seam };
  const { page, rows, leftRows } = refs;

  const measure = useCallback(() => {
    const scroller = page.current;
    const right = rows.current;
    const left = leftRows.current;
    if (!scroller || !right || !left) return;
    const { ids, seam } = rendered.current;
    const cache = heights.current;
    if (cache.width !== right.clientWidth) {
      cache.width = right.clientWidth;
      cache.byId.clear();
    }
    const height = (el: Element) => el.getBoundingClientRect().height;
    Array.from(right.children).forEach((el, i) => {
      const id = ids[seam + i];
      if (id) cache.byId.set(id, height(el));
    });
    const leftHeights = Array.from(left.children).map(height);

    const style = getComputedStyle(scroller);
    const gap = parseFloat(getComputedStyle(right).rowGap) || 0;
    // What else the right page holds below the rows: "Claude is working", a prompt
    const extras =
      (right.parentElement?.offsetHeight ?? 0) - right.offsetHeight;
    const room =
      scroller.clientHeight -
      parseFloat(style.paddingTop) -
      parseFloat(style.paddingBottom) -
      extras;

    let next = ids.length;
    let used = 0;
    for (let i = ids.length - 1; i >= 0; i--) {
      const h = cache.byId.get(ids[i]) ?? leftHeights[i] ?? 0;
      const add = next < ids.length ? h + gap : h;
      if (next < ids.length && used + add > room) break;
      used += add;
      next = i;
    }
    setSeam(next);
  }, [page, rows, leftRows]);

  useLayoutEffect(() => {
    if (!enabled) {
      setSeam(0);
      heights.current.byId.clear();
      return;
    }
    measure();
  }, [enabled, ids, seam, measure]);

  // Content that grows (a tool's result, an expanded diff) or a page that
  // changes height (the composer grows) moves the seam
  useEffect(() => {
    if (!enabled) return;
    const ro = new ResizeObserver(measure);
    const content = rows.current?.parentElement;
    for (const el of [page.current, rows.current, content, leftRows.current]) {
      if (el) ro.observe(el);
    }
    return () => ro.disconnect();
  }, [enabled, measure, page, rows, leftRows]);

  return enabled ? seam : 0;
}
