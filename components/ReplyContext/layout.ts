import { postureStore } from "@/stores/posture";

/** The nearest ancestor that clips or scrolls: the view the composer is in */
function clippingParent(el: HTMLElement): HTMLElement | null {
  for (
    let p = el.parentElement;
    p && p !== document.body;
    p = p.parentElement
  ) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY !== "visible") return p;
  }
  return null;
}

/**
 * Room between the top of `el` and the top of what it can cover: its view
 * (`bounds`, else the nearest clipping ancestor), never above the visual
 * viewport (iOS Safari's keyboard scrolls it) nor across a horizontal fold
 * the box sits below.
 */
export function roomAbove(
  el: HTMLElement,
  bounds?: HTMLElement | null
): number {
  const box = el.getBoundingClientRect();
  const vv = window.visualViewport;
  let top = vv ? vv.offsetTop : 0;
  const host = bounds ?? clippingParent(el);
  if (host) top = Math.max(top, host.getBoundingClientRect().top);
  const fold = postureStore.fold;
  if (fold?.axis === "horizontal" && box.top >= fold.end)
    top = Math.max(top, fold.end);
  return Math.max(0, Math.round(box.top - top));
}
